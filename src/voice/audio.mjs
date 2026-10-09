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

/** Confirm speech in 20ms slices; retain its opening audio without uploading idle noise. */
export function createVoiceGate({ threshold = .028, silenceMs = 900, preRollMs = 200, minSpeechMs = 360, maxSeconds = 45, noiseRatio = 2 } = {}) {
  if (![threshold,silenceMs,preRollMs,minSpeechMs,maxSeconds,noiseRatio].every(Number.isFinite) || !(threshold > 0 && threshold < 1 && silenceMs >= 250 && silenceMs <= 3000 && preRollMs >= 0 && preRollMs <= 500 && minSpeechMs >= 0 && minSpeechMs <= 1000 && maxSeconds > 0 && maxSeconds <= 45 && noiseRatio >= 1 && noiseRatio <= 4)) throw new Error('Invalid voice gate configuration.');
  let active = false, silence = 0, total = 0, voicedSamples = 0, consecutiveVoiced = 0, candidateSpan = 0, quietGap = 0, history = [], noiseFloor = 0, onsetThreshold = threshold;
  const preLimit = Math.floor(VOICE_RATE * preRollMs / 1000), maxSamples = Math.floor(VOICE_RATE * maxSeconds);
  const minSpeechSamples = Math.floor(VOICE_RATE * minSpeechMs / 1000), gapLimit = Math.floor(VOICE_RATE * .12), sliceSize = Math.floor(VOICE_RATE * .02);
  const candidateLimit = Math.max(minSpeechSamples * 2, minSpeechSamples + gapLimit);
  // Reset per-utterance audio, not the room's learned noise floor.
  const reset = () => { active = false; silence = total = voicedSamples = consecutiveVoiced = candidateSpan = quietGap = 0; history = []; };
  function tail(chunks, limit) {
    const result = [];
    for (let i = chunks.length - 1; i >= 0 && limit > 0; i--) {
      const chunk = chunks[i], size = Math.min(limit, chunk.length);
      result.unshift(chunk.slice(chunk.length - size)); limit -= size;
    }
    return result;
  }
  return {
    push(frame, { learnNoise = true, noiseFloor: ambient = 0 } = {}) {
      const level = audioLevel(frame);
      if (!frame.length) return { started: false, ended: false, samples: [], level, reason: '' };
      const externalNoise = Number.isFinite(ambient) && ambient >= 0 && ambient <= 1 ? ambient : 0;
      let started = false, incoming = [];
      for (let offset = 0; offset < frame.length; offset += sliceSize) {
        const part = frame.subarray(offset, Math.min(frame.length, offset + sliceSize)), energy = audioLevel(part);
        const floor = Math.max(noiseFloor, externalNoise), startThreshold = Math.max(threshold, Math.min(.18, floor * noiseRatio));
        if (!active) {
          if (energy >= startThreshold) {
            candidateSpan += part.length; voicedSamples += part.length; consecutiveVoiced += part.length; quietGap = 0;
            if (candidateSpan > candidateLimit) { candidateSpan = voicedSamples = consecutiveVoiced; }
            if (voicedSamples >= minSpeechSamples) {
              started = active = true; onsetThreshold = startThreshold; silence = 0;
              // CandidateSpan includes this frame's consumed prefix. Only take
              // the needed earlier samples, then forward the original full frame.
              incoming = [...tail(history, Math.max(0, preLimit + candidateSpan - offset - part.length)), frame];
              history = []; voicedSamples = consecutiveVoiced = candidateSpan = quietGap = 0;
            }
          } else {
            consecutiveVoiced = 0;
            if (voicedSamples) {
              quietGap += part.length; candidateSpan += part.length;
              if (quietGap > gapLimit || candidateSpan > candidateLimit) voicedSamples = candidateSpan = quietGap = 0;
            }
            if (!voicedSamples && learnNoise && energy < threshold) {
              // Only idle, below-threshold audio can teach the floor. Never
              // train on an utterance or on the assistant's playback microphone.
              // A raised adaptive threshold must not teach louder signals back
              // into the floor, or progressively louder speech could be swallowed.
              const seconds = energy > noiseFloor ? .6 : 4;
              noiseFloor += (energy - noiseFloor) * (1 - Math.exp(-part.length / VOICE_RATE / seconds));
            }
          }
        } else {
          const releaseThreshold = Math.max(threshold * .75, onsetThreshold * .75, floor * 1.4);
          silence = energy >= releaseThreshold ? 0 : silence + part.length / VOICE_RATE * 1000;
        }
      }
      if (!active) {
        history = tail([...history, frame], preLimit + candidateSpan);
        return { started: false, ended: false, samples: [], level, reason: '' };
      }
      if (!started) incoming = [frame];
      const samples = [];
      for (const input of incoming) { const size = Math.min(input.length, maxSamples - total); if(size)samples.push(input.slice(0,size)); total += size; }
      const reason = total >= maxSamples ? 'limit' : silence >= silenceMs ? 'silence' : '';
      return { started, ended: Boolean(reason), samples, level, reason };
    },
    reset,
    get active() { return active; },
    get noiseFloor() { return noiseFloor; },
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
