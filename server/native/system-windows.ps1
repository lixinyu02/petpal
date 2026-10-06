param(
  [ValidateSet('status', 'set-volume', 'adjust-volume', 'set-muted', 'open-settings')][string]$Action = 'status',
  [ValidateRange(0, 100)][double]$VolumePercent,
  [ValidateRange(-20, 20)][int]$Delta,
  [ValidateSet('true', 'false')][string]$Muted,
  [ValidateSet('sound', 'display')][string]$Section,
  # Optional read-only guard used by the restore harness. It cannot select a
  # different device: every call still captures only the current default output.
  [ValidateLength(1, 512)][string]$ExpectedEndpoint
)
$ErrorActionPreference = 'Stop'
$mutationAttempted = $false
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$required = switch ($Action) {
  'set-volume' { 'VolumePercent' }
  'adjust-volume' { 'Delta' }
  'set-muted' { 'Muted' }
  'open-settings' { 'Section' }
}
try {
  if ($required -and -not $PSBoundParameters.ContainsKey($required)) { throw 'Invalid fixed action parameters.' }
  foreach ($key in $PSBoundParameters.Keys) {
    if ($key -ne 'Action' -and $key -ne $required -and $key -ne 'ExpectedEndpoint') { throw 'Invalid fixed action parameters.' }
  }
  if ($PSBoundParameters.ContainsKey('ExpectedEndpoint') -and $Action -in @('status', 'open-settings')) { throw 'Invalid fixed action parameters.' }
  if ($Action -eq 'adjust-volume' -and $Delta -eq 0) { throw 'Invalid fixed action parameters.' }
  if ($Action -eq 'open-settings') {
    # The user's requested settings window is interactive; the helper is hidden.
    $uri = if ($Section -eq 'sound') { 'ms-settings:sound' } else { 'ms-settings:display' }
    Start-Process -FilePath $uri -WindowStyle Normal | Out-Null
    @{ ok = $true; section = $Section; requested = $true; verified = $false; message = 'Requested opening the system settings window; visible UI has not been verified.' } | ConvertTo-Json -Compress
    exit 0
  }
  Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

namespace PetPalSystemAudio {
    [ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")]
    public class MMDeviceEnumerator {}

    [ComImport, Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    public interface IMMDeviceEnumerator {
        [PreserveSig] int EnumAudioEndpoints(int flow, uint mask, out IntPtr devices);
        [PreserveSig] int GetDefaultAudioEndpoint(int flow, int role, out IMMDevice device);
        [PreserveSig] int GetDevice([MarshalAs(UnmanagedType.LPWStr)] string id, out IMMDevice device);
        [PreserveSig] int RegisterEndpointNotificationCallback(IntPtr client);
        [PreserveSig] int UnregisterEndpointNotificationCallback(IntPtr client);
    }

    [ComImport, Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    public interface IMMDevice {
        [PreserveSig] int Activate(ref Guid iid, uint context, IntPtr parameters, [MarshalAs(UnmanagedType.IUnknown)] out object value);
        [PreserveSig] int OpenPropertyStore(uint access, out IntPtr properties);
        [PreserveSig] int GetId([MarshalAs(UnmanagedType.LPWStr)] out string id);
        [PreserveSig] int GetState(out uint state);
    }

    [ComImport, Guid("5CDF2C82-841E-4546-9722-0CF74078229A"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    public interface IAudioEndpointVolume {
        [PreserveSig] int RegisterControlChangeNotify(IntPtr client);
        [PreserveSig] int UnregisterControlChangeNotify(IntPtr client);
        [PreserveSig] int GetChannelCount(out uint count);
        [PreserveSig] int SetMasterVolumeLevel(float level, ref Guid context);
        [PreserveSig] int SetMasterVolumeLevelScalar(float level, ref Guid context);
        [PreserveSig] int GetMasterVolumeLevel(out float level);
        [PreserveSig] int GetMasterVolumeLevelScalar(out float level);
        [PreserveSig] int SetChannelVolumeLevel(uint channel, float level, ref Guid context);
        [PreserveSig] int SetChannelVolumeLevelScalar(uint channel, float level, ref Guid context);
        [PreserveSig] int GetChannelVolumeLevel(uint channel, out float level);
        [PreserveSig] int GetChannelVolumeLevelScalar(uint channel, out float level);
        [PreserveSig] int SetMute([MarshalAs(UnmanagedType.Bool)] bool muted, ref Guid context);
        [PreserveSig] int GetMute([MarshalAs(UnmanagedType.Bool)] out bool muted);
        [PreserveSig] int GetVolumeStepInfo(out uint step, out uint count);
        [PreserveSig] int VolumeStepUp(ref Guid context);
        [PreserveSig] int VolumeStepDown(ref Guid context);
        [PreserveSig] int QueryHardwareSupport(out uint mask);
        [PreserveSig] int GetVolumeRange(out float minimum, out float maximum, out float step);
    }

    public sealed class Audio : IDisposable {
        private IMMDeviceEnumerator enumerator;
        private IMMDevice device;
        private IAudioEndpointVolume volume;
        private string endpoint;
        public Audio() {
            try {
                enumerator = (IMMDeviceEnumerator)new MMDeviceEnumerator();
                // Render output, eMultimedia: the user's default playback device.
                Marshal.ThrowExceptionForHR(enumerator.GetDefaultAudioEndpoint(0, 1, out device));
                Marshal.ThrowExceptionForHR(device.GetId(out endpoint));
                Guid iid = typeof(IAudioEndpointVolume).GUID;
                object active;
                Marshal.ThrowExceptionForHR(device.Activate(ref iid, 23, IntPtr.Zero, out active));
                volume = (IAudioEndpointVolume)active;
            } catch { Dispose(); throw; }
        }
        public string Endpoint { get { return endpoint; } }
        public double VolumePercent {
            get {
                float level;
                Marshal.ThrowExceptionForHR(volume.GetMasterVolumeLevelScalar(out level));
                if (float.IsNaN(level) || float.IsInfinity(level) || level < 0 || level > 1) throw new InvalidOperationException();
                return level * 100.0;
            }
        }
        public bool Muted {
            get { bool muted; Marshal.ThrowExceptionForHR(volume.GetMute(out muted)); return muted; }
        }
        public bool DefaultEndpointChanged() {
            IMMDevice current = null;
            try {
                Marshal.ThrowExceptionForHR(enumerator.GetDefaultAudioEndpoint(0, 1, out current));
                string id; Marshal.ThrowExceptionForHR(current.GetId(out id)); return id != endpoint;
            } finally { if (current != null) Marshal.ReleaseComObject(current); }
        }
        public void SetVolume(double percent) {
            if (percent < 0 || percent > 100 || double.IsNaN(percent) || double.IsInfinity(percent)) throw new ArgumentOutOfRangeException();
            Guid context = Guid.Empty;
            Marshal.ThrowExceptionForHR(volume.SetMasterVolumeLevelScalar((float)(percent / 100.0), ref context));
        }
        public void SetMuted(bool muted) {
            Guid context = Guid.Empty; Marshal.ThrowExceptionForHR(volume.SetMute(muted, ref context));
        }
        public void Dispose() {
            if (volume != null) { Marshal.ReleaseComObject(volume); volume = null; }
            if (device != null) { Marshal.ReleaseComObject(device); device = null; }
            if (enumerator != null) { Marshal.ReleaseComObject(enumerator); enumerator = null; }
        }
    }
}
'@
  $audio = New-Object PetPalSystemAudio.Audio
  try {
    $before = @{ endpoint = $audio.Endpoint; volumePercent = $audio.VolumePercent; muted = $audio.Muted }
    if (($ExpectedEndpoint -and $ExpectedEndpoint -ne $audio.Endpoint) -or $audio.DefaultEndpointChanged()) {
      @{ ok = $false; available = $true; code = 'default_endpoint_changed'; defaultEndpointChanged = $true; message = 'Default audio device changed; no mutation was sent.' } | ConvertTo-Json -Compress
      exit 0
    }
    switch ($Action) {
      'set-volume' { $mutationAttempted = $true; $audio.SetVolume($VolumePercent) }
      'adjust-volume' { $mutationAttempted = $true; $audio.SetVolume([Math]::Min(100, [Math]::Max(0, $before.volumePercent + $Delta))) }
      'set-muted' { $mutationAttempted = $true; $audio.SetMuted($Muted -eq 'true') }
    }
    $after = @{ endpoint = $audio.Endpoint; volumePercent = $audio.VolumePercent; muted = $audio.Muted }
    $changed = $audio.DefaultEndpointChanged()
    $expectedVolume = switch ($Action) {
      'set-volume' { $VolumePercent }
      'adjust-volume' { [Math]::Min(100, [Math]::Max(0, $before.volumePercent + $Delta)) }
      default { $before.volumePercent }
    }
    $expectedMute = if ($Action -eq 'set-muted') { $Muted -eq 'true' } else { $before.muted }
    $verified = ([Math]::Abs($after.volumePercent - $expectedVolume) -le 0.5) -and ($after.muted -eq $expectedMute)
    $result = @{ ok = $verified -and -not $changed; available = $true; backend = 'coreaudio'; endpoint = $after.endpoint; volumePercent = $after.volumePercent; muted = $after.muted; verified = $verified; defaultEndpointChanged = $changed }
    if ($Action -ne 'status') { $result.before = $before }
    if ($changed) { $result.code = 'default_endpoint_changed'; $result.message = 'Default audio device changed; only the original endpoint was addressed. No automatic retry.' }
    elseif (-not $verified) { $result.code = 'readback_mismatch'; $result.message = 'System volume readback did not match. No automatic retry.' }
    $result | ConvertTo-Json -Depth 4 -Compress
  } finally { $audio.Dispose() }
} catch {
  # Do not expose arbitrary COM/PowerShell stacks, paths, or machine data.
  $result = @{ ok = $false; available = $false; code = 'system_control_unavailable'; message = 'Windows CoreAudio is unavailable; check the selected computer user audio session. No automatic retry.' }
  if ($mutationAttempted) { $result.mutationOutcome = 'unknown'; $result.message = 'System volume mutation could not be verified; outcome is unknown. Check the output device. No automatic retry.' }
  $result | ConvertTo-Json -Compress
}
