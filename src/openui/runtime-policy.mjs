// react-lang 1.0.1 auto-mounts an inspector in development, which in turn
// downloads a CDN script. PetPal's in-app renderer never needs that inspector.
// This module must evaluate before either import of react-lang. The flag is
// specific to the pinned SDK; verify it when upgrading the dependency.
if (typeof document !== 'undefined') {
  globalThis[Symbol.for('openui.devtools.autoMount')] = true;
}
