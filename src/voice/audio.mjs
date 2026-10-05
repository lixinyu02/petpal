export const VOICE_RATE = 24000;

/** Linear resampling keeps its phase between worklet blocks. Invalid samples become silence. */
export function createResampler(sourceRate, targetRate = 24000) {
  if (!Number.isFinite(sourceRate) || sourceRate < 8000 || sourceRate > 192000 || !Number.isFinite(targetRate) || targetRate < 8000 || targetRate > 48000) throw new Error('Unsupported audio sample rate.');
  const step = sourceRate / targetRate;
  let position = 0, next = 0, previous = 0;
  return {
    push(input) {
      if (!(input instanceof Float32Array) || input.length > 192000) throw new Error('Invalid audio block.');
      const output = new Float32Array(Math.ceil(input.length / step) + 2);
      let count = 0;
      for (const value of input) {
        const sample = Number.isFinite(value) ? Math.max(-1, Math.min(1, value)) : 0;
        while (next <= position + 1e-7) {
          output[count++] = position === 0 ? sample : previous + (sample - previous) * Math.max(0, Math.min(1, next - position + 1));
          next += step;
        }
        previous = sample; position++;
      }
      return output.slice(0, count);
    },
    reset() { position = next = previous = 0; },
  };
}

export function audioLevel(samples) {
  if (!(samples instanceof Float32Array) || samples.length > VOICE_RATE) throw new Error('Invalid audio frame.');
  let power = 0;
  for (const sample of samples) { if (!Number.isFinite(sample) || Math.abs(sample) > 1) throw new Error('Invalid audio sample.'); power += sample * sample; }
  return samples.length ? Math.sqrt(power / samples.length) : 0;
}

/** Silence only retains a 200 ms pre-roll; an utterance never exceeds 45 seconds. */
export function createVoiceGate({ threshold = .014, silenceMs = 900, preRollMs = 200, minSpeechMs = 0, maxSeconds = 45 } = {}) {
  if (!(threshold > 0 && threshold < 1 && silenceMs >= 250 && silenceMs <= 3000 && preRollMs >= 0 && preRollMs <= 500 && minSpeechMs >= 0 && minSpeechMs <= 1000 && maxSeconds > 0 && maxSeconds <= 45)) throw new Error('Invalid voice gate configuration.');
  let active = false, silence = 0, total = 0, voicedSamples = 0, onset = [], preRoll = new Float32Array(0);
  const preLimit = Math.floor(VOICE_RATE * preRollMs / 1000), maxSamples = Math.floor(VOICE_RATE * maxSeconds);
  const minSpeechSamples = Math.floor(VOICE_RATE * minSpeechMs / 1000);
  const reset = () => { active = false; silence = total = voicedSamples = 0; onset = []; preRoll = new Float32Array(0); };
  return {
    push(frame) {
      const level = audioLevel(frame), voiced = level >= threshold;
      if (!frame.length) return { started: false, ended: false, samples: [], level, reason: '' };
      if (!active && !voiced) {
        // A click or brief noise must not satisfy the sustained-speech gate.
        voicedSamples = 0; onset = [];
        const previous = preRoll; preRoll = new Float32Array(Math.min(preLimit, previous.length + frame.length));
        const fromCurrent = Math.min(preRoll.length, frame.length), fromPrevious = preRoll.length - fromCurrent;
        if (fromPrevious) preRoll.set(previous.subarray(previous.length - fromPrevious));
        preRoll.set(frame.subarray(frame.length - fromCurrent), fromPrevious);
        return { started: false, ended: false, samples: [], level, reason: '' };
      }
      const started = !active, samples = [];
      let incoming = [frame];
      if (started) {
        onset.push(frame.slice()); voicedSamples += frame.length;
        if (voicedSamples < minSpeechSamples) return { started:false, ended:false, samples:[], level, reason:'' };
        active = true; if (preRoll.length) samples.push(preRoll); total = preRoll.length; preRoll = new Float32Array(0);
        incoming = onset; onset = []; voicedSamples = 0;
      }
      let take = 0;
      for (const input of incoming) { const size = Math.min(input.length, maxSamples - total); if(size)samples.push(input.slice(0,size)); total += size; take += size; }
      silence = voiced ? 0 : silence + take / VOICE_RATE * 1000;
      const reason = total >= maxSamples ? 'limit' : silence >= silenceMs ? 'silence' : '';
      return { started, ended: Boolean(reason), samples, level, reason };
    },
    reset,
    get active() { return active; },
  };
}

export function pcmFloat32LE(samples) {
  audioLevel(samples);
  const buffer = new ArrayBuffer(samples.length * 4), view = new DataView(buffer);
  for (let i = 0; i < samples.length; i++) view.setFloat32(i * 4, samples[i], true);
  return buffer;
}

/** Worklet source is self-contained so Vite does not leave unresolved worklet imports. */
export function microphoneWorkletSource() {
  return `const resamplerFactory = ${createResampler.toString()};
class PetPalMicrophone extends AudioWorkletProcessor {
 constructor(){super();this.resampler=resamplerFactory(sampleRate,24000);this.frame=new Float32Array(6000);this.offset=0;}
 process(inputs,outputs){
  for(const output of outputs)for(const channel of output)channel.fill(0);
  const channels=inputs[0];if(!channels?.length)return true;
  const mono=new Float32Array(channels[0].length);
  for(const channel of channels)for(let i=0;i<mono.length;i++)mono[i]+=(Number.isFinite(channel[i])?channel[i]:0)/channels.length;
  const samples=this.resampler.push(mono);
  for(const sample of samples){this.frame[this.offset++]=sample;if(this.offset===this.frame.length){this.port.postMessage(this.frame,[this.frame.buffer]);this.frame=new Float32Array(6000);this.offset=0;}}
  return true;
 }
}
registerProcessor('petpal-microphone',PetPalMicrophone);`;
}
