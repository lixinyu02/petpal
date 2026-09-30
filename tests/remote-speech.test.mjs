import test from 'node:test';
import assert from 'node:assert/strict';
import { createRemoteSpeechController, REMOTE_SPEECH_TEXT_LIMIT } from '../src/avatar/remote-speech.mjs';

const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
const audioBlob = () => new Blob(['test audio'], { type: 'audio/mpeg' });
function harness(options = {}) {
  const requests = [], audios = [], urls = [], revoked = [], states = [], timers = new Map();
  let time = 0, nextTimer = 1;
  const controller = createRemoteSpeechController({
    requestAudio: (text, signal) => { const request = { text, signal, ...deferred() }; requests.push(request); return request.promise; },
    createAudio: () => {
      const playback = deferred();
      const audio = { src: '', preload: '', muted: false, paused: true, currentTime: 0, duration: 10,
        playback, played: 0, pauses: 0, loads: 0, sinks: [], audibleStarts: 0, playMutedStates: [],
        play() {
          this.played++;
          this.playMutedStates.push(this.muted);
          return playback.promise.then(() => {
            // Model a hostile late native start after stop() has already paused it.
            this.paused = false;
            if (!this.muted) this.audibleStarts++;
            this.onplaying?.();
          });
        },
        pause() { this.pauses++; this.paused = true; this.onpause?.(); },
        removeAttribute(name) { if (name === 'src') this.src = ''; },
        load() { this.loads++; },
        async setSinkId(id) { this.sinks.push(id); },
        ...options.audio,
      };
      audios.push(audio); return audio;
    },
    createObjectURL: blob => { const url = `blob:test-${urls.length + 1}`; urls.push({ url, blob }); return url; },
    revokeObjectURL: url => revoked.push(url),
    getSpeakerId: () => options.speakerId ?? 'default',
    onState: state => states.push(state),
    schedule: (callback, delay) => { const id = nextTimer++; timers.set(id, { callback, due: time + delay }); return id; },
    unschedule: id => timers.delete(id),
    ...options.controller,
  });
  return { controller, requests, audios, urls, revoked, states, timers,
    async synth(index = requests.length - 1, blob = audioBlob()) { requests[index].resolve(blob); await flush(); },
    async play(index = audios.length - 1) { audios[index].playback.resolve(); await flush(); },
    advance(milliseconds) {
      const end = time + milliseconds;
      for (;;) {
        const next = [...timers].filter(([, timer]) => timer.due <= end).sort((a, b) => a[1].due - b[1].due)[0];
        if (!next) break;
        timers.delete(next[0]); time = next[1].due; next[1].callback();
      }
      time = end;
    },
  };
}
const request = (utteranceId = 'one', text = '这是一段十个字的语音') => ({ utteranceId, text });
const assertReleased = (h, index = 0) => {
  const audio = h.audios[index];
  assert.equal(audio.paused, true);
  assert.equal(audio.muted, true);
  assert.equal(audio.src, '');
  for (const event of ['onplaying', 'onpause', 'onwaiting', 'onstalled', 'onended', 'onerror', 'ontimeupdate', 'onloadedmetadata']) assert.equal(audio[event] ?? null, null);
};

test('WAV emotion metadata stays silent until playback and clears on waiting, pause, end and stop', async () => {
  const h = harness(), metadata = { emotion: 'gentle', intensity: 'natural', source: 'rules' };
  h.controller.speak(request()); await h.synth(0, { blob: audioBlob(), emotion: metadata });
  assert.equal(h.controller.snapshot().emotion, null);
  metadata.emotion = 'angry'; await h.play();
  assert.deepEqual(h.controller.snapshot().emotion, { emotion: 'gentle', intensity: 'natural', source: 'rules' });
  assert.equal(Object.isFrozen(h.controller.snapshot().emotion), true);
  h.audios[0].onwaiting(); assert.equal(h.controller.snapshot().emotion, null);
  h.audios[0].onplaying(); assert.equal(h.controller.snapshot().emotion.emotion, 'gentle');
  h.audios[0].pause(); assert.equal(h.controller.snapshot().emotion, null);
  h.audios[0].paused = false; h.audios[0].onplaying(); assert.equal(h.controller.snapshot().emotion.emotion, 'gentle');
  h.audios[0].onended(); assert.equal(h.controller.snapshot().emotion, null);
  h.controller.stop(); assert.equal(h.controller.snapshot().emotion, null); assertReleased(h);
});

test('WAV cancellation drops late synthesis metadata and fails invalid metadata before play', async () => {
  const h = harness(), metadata = { emotion: 'happy', intensity: 'strong', source: 'manual' };
  h.controller.speak(request()); h.controller.stop();
  await h.synth(0, { blob: audioBlob(), emotion: metadata });
  assert.equal(h.controller.snapshot().emotion, null); assert.equal(h.audios[0].played, 0); assertReleased(h);
  h.controller.speak(request('next')); await h.synth(1, { blob: audioBlob(), emotion: { ...metadata, source: 'unknown' } });
  assert.equal(h.audios[1].played, 0); assert.equal(h.controller.snapshot().emotion, null);
  assert.match(h.controller.snapshot().error, /朗读语气/); assertReleased(h, 1);
});

test('WAV legacy Blob playback has no upstream expression and a rejected late play never restores metadata', async () => {
  const h = harness(); h.controller.speak(request()); await h.synth(); await h.play();
  assert.equal(h.controller.snapshot().emotion, null); h.controller.stop();
  h.controller.speak(request('selected')); await h.synth(1, { blob: audioBlob(), emotion: { emotion: 'sad', intensity: 'natural', source: 'choice' } });
  const captured = h.audios[1].onplaying; h.controller.stop();
  await h.play(1); captured(); assert.equal(h.controller.snapshot().emotion, null); assert.equal(h.audios[1].audibleStarts, 0);
  assertReleased(h, 1);
});

test('remote audio remains pending until real playback and reports estimated media progress', async () => {
  const h = harness();
  assert.equal(h.controller.speak(request()), true);
  assert.equal(h.requests[0].text, request().text);
  assert.deepEqual([h.controller.snapshot().active, h.controller.snapshot().pending], [false, true]);
  await h.synth();
  assert.equal(h.audios[0].src, 'blob:test-1');
  assert.equal(h.audios[0].played, 1);
  assert.equal(h.controller.snapshot().active, false);
  assert.deepEqual(h.audios[0].playMutedStates, [false], 'play must request audible output, not bypass autoplay with muted playback');
  assert.equal(h.audios[0].muted, false);
  await h.play();
  assert.deepEqual([h.controller.snapshot().active, h.controller.snapshot().pending, h.controller.snapshot().progressBasis], [true, false, 'estimated']);
  assert.equal(h.audios[0].muted, false);
  h.audios[0].currentTime = 5; h.advance(100);
  assert.equal(h.controller.snapshot().charIndex, Math.floor(request().text.length / 2));
  h.audios[0].currentTime = 1; h.audios[0].ontimeupdate();
  assert.equal(h.controller.snapshot().charIndex, Math.floor(request().text.length / 2), 'progress must remain monotonic');
  h.audios[0].currentTime = 99; h.audios[0].ontimeupdate();
  assert.equal(h.controller.snapshot().charIndex, request().text.length - 1, 'only ended may complete the last character');
  h.controller.dispose();
});

test('progress does not split surrogate pairs or claim boundaries without duration metadata', async () => {
  const h = harness(); h.controller.speak(request('emoji', '猫😀好'));
  await h.synth(); await h.play();
  h.audios[0].currentTime = 5; h.audios[0].ontimeupdate();
  assert.equal(h.controller.snapshot().charIndex, 1);
  h.audios[0].duration = NaN; h.audios[0].currentTime = 20; h.advance(100);
  assert.equal(h.controller.snapshot().charIndex, 1);
  assert.equal(h.controller.snapshot().progressBasis, 'estimated');
  h.controller.dispose();
});

test('buffering and pauses stop animation until actual playback resumes', async () => {
  const h = harness(); h.controller.speak(request()); await h.synth(); await h.play();
  h.audios[0].onwaiting();
  assert.deepEqual([h.controller.snapshot().active, h.controller.snapshot().pending], [false, true]);
  h.audios[0].currentTime = 5; h.advance(100);
  assert.equal(h.controller.snapshot().charIndex, 0);
  h.audios[0].onplaying();
  assert.equal(h.controller.snapshot().active, true);
  h.audios[0].onstalled();
  assert.equal(h.controller.snapshot().active, true, 'a stalled download can still be playing buffered audio');
  h.audios[0].pause();
  assert.deepEqual([h.controller.snapshot().active, h.controller.snapshot().pending], [false, false]);
  h.controller.dispose();
});

test('selected speaker is routed before synthesis/play; default needs no sink API', async () => {
  const sink = deferred();
  const h = harness({ speakerId: 'headphones-1', audio: { setSinkId(id) { this.sinks.push(id); return sink.promise; } } });
  h.controller.speak(request());
  assert.deepEqual(h.audios[0].sinks, ['headphones-1']);
  assert.equal(h.requests.length, 0);
  sink.resolve(); await flush(); await h.synth(); await h.play();
  assert.equal(h.audios[0].played, 1); h.controller.dispose();
  const defaults = harness({ audio: { setSinkId: undefined } }); defaults.controller.speak(request());
  await defaults.synth(); await defaults.play();
  assert.equal(defaults.controller.snapshot().active, true); defaults.controller.dispose();
});

test('unsupported or rejected selected speakers never silently play on the default output', async () => {
  for (const setSinkId of [undefined, async () => { throw new Error('device gone'); }]) {
    const h = harness({ speakerId: 'missing-speaker', audio: { setSinkId } });
    h.controller.speak(request()); await flush();
    assert.match(h.controller.snapshot().error, /扬声器/);
    assert.equal(h.controller.snapshot().ended, true);
    assert.equal(h.requests.length, 0); assert.equal(h.audios[0].played, 0);
    assert.equal(h.timers.size, 0); assertReleased(h);
  }
});

test('scope-switch stop during synthesis aborts request and discards a late successful response', async () => {
  const h = harness(); h.controller.speak(request());
  h.controller.stop(); // Caller invokes this on user/account/backend-scope changes.
  assert.equal(h.requests[0].signal.aborted, true);
  const stopped = h.controller.snapshot();
  await h.synth();
  assert.deepEqual(h.controller.snapshot(), stopped);
  assert.equal(h.urls.length, 0); assert.equal(h.audios[0].played, 0);
  assert.equal(h.timers.size, 0); assertReleased(h);
});

test('stop during speaker routing cannot issue a later synthesis request', async () => {
  const sink = deferred();
  const h = harness({ speakerId: 'headphones', audio: { setSinkId: () => sink.promise } });
  h.controller.speak(request()); h.controller.stop(); sink.resolve(); await flush();
  assert.equal(h.requests.length, 0); assert.equal(h.timers.size, 0); assertReleased(h);
});

test('late play resolution after cancellation stays muted and is paused again without restoring state', async () => {
  const h = harness(); h.controller.speak(request()); await h.synth();
  assert.deepEqual(h.audios[0].playMutedStates, [false]);
  const oldPlaying = h.audios[0].onplaying;
  h.controller.stop(); const stopped = h.controller.snapshot();
  assert.deepEqual(h.revoked, ['blob:test-1']); assertReleased(h);
  await h.play(); oldPlaying();
  assert.equal(h.audios[0].audibleStarts, 0);
  assert.ok(h.audios[0].pauses >= 2);
  assertReleased(h); assert.deepEqual(h.controller.snapshot(), stopped);
  assert.equal(h.timers.size, 0);
});

test('late play rejection after replacement cannot fail or mute the replacement', async () => {
  const h = harness(); h.controller.speak(request('old')); await h.synth();
  h.controller.speak(request('new', '新的回复。')); await h.synth(); await h.play(1);
  h.audios[0].playback.reject(new Error('old playback failed')); await flush();
  assert.equal(h.controller.snapshot().utteranceId, 'new');
  assert.equal(h.controller.snapshot().error, ''); assert.equal(h.controller.snapshot().active, true);
  assert.equal(h.audios[1].muted, false); assertReleased(h, 0);
  h.controller.dispose();
});

test('replacement ignores all captured callbacks from the previous player', async () => {
  const h = harness(); h.controller.speak(request('old')); await h.synth(); await h.play();
  const old = ['onplaying', 'onpause', 'onwaiting', 'onstalled', 'onended', 'onerror', 'ontimeupdate', 'onloadedmetadata'].map(event => h.audios[0][event]);
  h.controller.speak(request('new', '新的回复。')); await h.synth(); await h.play();
  const state = h.controller.snapshot(); old.forEach(callback => callback());
  assert.deepEqual(h.controller.snapshot(), state); assert.equal(h.audios[1].muted, false);
  assert.deepEqual(h.revoked, ['blob:test-1']); assertReleased(h, 0);
  h.controller.dispose(); assert.deepEqual(h.revoked, ['blob:test-1', 'blob:test-2']);
});

test('natural ending completes text and releases URL, handlers, timers, and abort signal exactly once', async () => {
  const h = harness(); h.controller.speak(request()); await h.synth(); await h.play();
  const ended = h.audios[0].onended; ended(); ended(); h.controller.stop();
  assert.deepEqual([h.controller.snapshot().active, h.controller.snapshot().pending, h.controller.snapshot().ended, h.controller.snapshot().charIndex], [false, false, true, request().text.length]);
  assert.deepEqual(h.revoked, ['blob:test-1']); assert.equal(h.requests[0].signal.aborted, true);
  assert.equal(h.timers.size, 0); assertReleased(h);
});

test('unmount-like dispose blocks late work and future speech, with no later notifications', async () => {
  const h = harness(); h.controller.speak(request()); await h.synth();
  const oldEnd = h.audios[0].onended; h.controller.dispose();
  const notifications = h.states.length;
  await h.play(); oldEnd(); h.controller.stop(); h.controller.dispose();
  assert.equal(h.controller.speak(request('after-unmount')), false);
  assert.equal(h.states.length, notifications); assert.equal(h.timers.size, 0);
  assert.deepEqual(h.revoked, ['blob:test-1']); assertReleased(h);
});

test('synthesis, empty audio, browser gesture, and media errors end with actionable failures', async () => {
  const synthesis = harness(); synthesis.controller.speak(request()); synthesis.requests[0].reject(new Error('请配置语音服务')); await flush();
  assert.match(synthesis.controller.snapshot().error, /请配置语音服务/);
  const empty = harness(); empty.controller.speak(request()); await empty.synth(0, new Blob());
  assert.match(empty.controller.snapshot().error, /空音频/); assert.equal(empty.urls.length, 0);
  const denied = harness({ audio: {
    play() {
      this.played++; this.playMutedStates.push(this.muted);
      // Simulate Chrome permitting muted autoplay but requiring user activation for audible media.
      return this.muted ? Promise.resolve() : Promise.reject(Object.assign(new Error('gesture required'), { name: 'NotAllowedError' }));
    },
  } }); denied.controller.speak(request()); await denied.synth();
  assert.deepEqual(denied.audios[0].playMutedStates, [false]);
  assert.match(denied.controller.snapshot().error, /直接点击/);
  const failed = harness(); failed.controller.speak(request()); await failed.synth(); await failed.play(); failed.audios[0].onerror();
  assert.match(failed.controller.snapshot().error, /未能播放/);
  for (const h of [synthesis, empty, denied, failed]) {
    assert.deepEqual([h.controller.snapshot().active, h.controller.snapshot().pending, h.controller.snapshot().ended], [false, false, true]);
    assert.equal(h.timers.size, 0); assertReleased(h);
  }
});

test('bounded timeouts abort hung synthesis and playback, ignoring their eventual completion', async () => {
  const synthesis = harness(); synthesis.controller.speak(request()); synthesis.advance(180000);
  assert.equal(synthesis.controller.snapshot().pending, true, 'backend cold starts may use the full 180-second budget');
  assert.equal(synthesis.requests[0].signal.aborted, false);
  synthesis.advance(20000);
  assert.match(synthesis.controller.snapshot().error, /生成超时/); await synthesis.synth();
  assert.equal(synthesis.urls.length, 0);
  const starting = harness(); starting.controller.speak(request()); await starting.synth(); starting.advance(15000);
  assert.match(starting.controller.snapshot().error, /未能启动/); await starting.play();
  const hanging = harness(); hanging.controller.speak(request()); await hanging.synth(); await hanging.play(); hanging.advance(30000);
  assert.match(hanging.controller.snapshot().error, /没有正常结束/);
  for (const h of [synthesis, starting, hanging]) { assert.equal(h.timers.size, 0); assert.equal(h.requests[0].signal.aborted, true); assertReleased(h); }
});

test('empty and oversized text are rejected without silent truncation or a network request', () => {
  const h = harness();
  for (const text of ['', ' \n ', '猫'.repeat(REMOTE_SPEECH_TEXT_LIMIT + 1)]) assert.equal(h.controller.speak(request('bad', text)), false);
  assert.match(h.controller.snapshot().error, /1000.*概括/);
  assert.equal(h.requests.length, 0); assert.equal(h.audios.length, 0); assert.equal(h.timers.size, 0);
  assert.equal(createRemoteSpeechController().speak(request()), false);
  assert.equal(h.controller.speak(request('limit', '猫'.repeat(REMOTE_SPEECH_TEXT_LIMIT))), true);
  assert.equal(h.requests[0].text.length, REMOTE_SPEECH_TEXT_LIMIT); h.controller.dispose();
});
