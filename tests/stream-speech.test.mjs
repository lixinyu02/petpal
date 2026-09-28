import test from 'node:test';
import assert from 'node:assert/strict';
import { createStreamingSpeechController, STREAM_SPEECH_TEXT_LIMIT } from '../src/avatar/stream-speech.mjs';

const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
const format = { format: 'pcm_s16le', sampleRate: 24000, channels: 1 };
const request = (utteranceId = 'one', text = '小猫正在陪你聊天。') => ({ utteranceId, text });
function pcm(count, value = 8192) { const bytes = new Uint8Array(count * 2), view = new DataView(bytes.buffer); for (let i = 0; i < count; i++) view.setInt16(i * 2, value, true); return bytes; }
function harness(options = {}) {
  let time = 0, nextTimer = 1;
  const timers = new Map(), contexts = [], requests = [], states = [];
  const controller = createStreamingSpeechController({
    requestStream: (text, signal, handlers) => { const item = { text, signal, handlers, ...deferred() }; requests.push(item); return item.promise; },
    createContext: () => {
      const context = {
        state: 'suspended', currentTime: 0, sinkId: '', destination: {}, sources: [], buffers: [], gains: [], sinks: [], resumed: 0, closed: 0, frozen: false,
        resume() { this.resumed++; this.state = 'running'; return Promise.resolve(); },
        close() { this.closed++; this.state = 'closed'; return Promise.resolve(); },
        setSinkId(id) { this.sinks.push(id); this.sinkId = id; return Promise.resolve(); },
        createGain() { const gain = { gain: { value: 1 }, connected: false, connect() { this.connected = true; }, disconnect() { this.connected = false; } }; this.gains.push(gain); return gain; },
        createBuffer(channels, size, sampleRate) { const data = new Float32Array(size), buffer = { channels, size, sampleRate, data, getChannelData: () => data }; this.buffers.push(buffer); return buffer; },
        createBufferSource() { const node = { buffer: null, onended: null, starts: [], stops: 0, connected: false, connect() { this.connected = true; }, disconnect() { this.connected = false; }, start(at) { this.starts.push(at); }, stop() { this.stops++; } }; this.sources.push(node); return node; },
        ...options.context,
      };
      contexts.push(context); return context;
    },
    getSpeakerId: () => options.speaker ?? 'default', onState: state => states.push(state), now: () => time,
    schedule: (callback, delay) => { const id = nextTimer++; timers.set(id, { callback, due: time + delay }); return id; },
    unschedule: id => timers.delete(id), ...options.controller,
  });
  const move = at => { const delta = at - time; for (const context of contexts) if (context.state === 'running' && !context.frozen) context.currentTime += delta / 1000; time = at; };
  return { controller, contexts, requests, states, timers,
    async start(input = request()) { assert.equal(controller.speak(input), true); await flush(); if (requests.length) requests.at(-1).handlers.onFormat(format); },
    async audio(bytes, index = requests.length - 1) { await requests[index].handlers.onAudio(bytes); await flush(); },
    async end(index = requests.length - 1) { requests[index].resolve(); await flush(); },
    advance(milliseconds) {
      const end = time + milliseconds;
      for (;;) { const next = [...timers].filter(([, item]) => item.due <= end).sort((a, b) => a[1].due - b[1].due)[0]; if (!next) break; timers.delete(next[0]); move(next[1].due); next[1].callback(); }
      move(end);
    },
  };
}
function assertReleased(h, index = 0) {
  const context = h.contexts[index];
  assert.equal(context.gains[0].gain.value, 0); assert.equal(context.gains[0].connected, false); assert.equal(context.closed, 1);
  for (const node of context.sources) { assert.equal(node.connected, false); assert.equal(node.onended, null); }
  assert.equal(h.timers.size, 0);
}

test('PCM starts before synthesis EOF after prebuffering and uses one continuous 24kHz audio clock', async () => {
  const h = harness(); await h.start();
  await h.audio(pcm(2880)); assert.equal(h.contexts[0].sources.length, 0);
  await h.audio(pcm(2880)); const context = h.contexts[0];
  assert.equal(context.sources.length, 2); assert.deepEqual(context.buffers.map(item => item.sampleRate), [24000, 24000]);
  assert.equal(context.sources[0].starts[0], 0.035);
  assert.equal(context.sources[1].starts[0], context.sources[0].starts[0] + 0.12);
  assert.equal(h.controller.snapshot().pending, true);
  h.advance(80);
  assert.equal(h.controller.snapshot().active, true); assert.equal(h.controller.snapshot().streaming, true);
  assert.equal(h.controller.snapshot().audioLevel, 1);
  await h.audio(pcm(5760));
  assert.equal(context.sources[2].starts[0], context.sources[1].starts[0] + 0.12);
  await h.end(); h.advance(500);
  assert.equal(h.controller.snapshot().ended, true); assert.equal(h.controller.snapshot().charIndex, request().text.length);
  assert.equal(h.requests[0].signal.aborted, true); assertReleased(h);
});

test('odd network boundaries retain little-endian half samples without inserting silence or losing bytes', async () => {
  const h = harness(); await h.start();
  const bytes = new Uint8Array([0, 128, 255, 127, 0, 0, 0, 64]);
  await h.audio(bytes.subarray(0, 1)); await h.audio(bytes.subarray(1, 4)); await h.audio(bytes.subarray(4, 7)); await h.audio(bytes.subarray(7));
  assert.equal(h.contexts[0].sources.length, 0);
  await h.end();
  assert.deepEqual([...h.contexts[0].buffers[0].data], [-1, 32767 / 32768, 0, 0.5]);
  h.advance(80); assert.equal(h.controller.snapshot().ended, true); assertReleased(h);
});

test('ahead scheduling and live node count remain bounded and apply backpressure to transport', async () => {
  const h = harness(); await h.start();
  for (let i = 0; i < 5; i++) await h.audio(pcm(12288));
  let delivered = false;
  const pending = h.audio(pcm(12288)).then(() => { delivered = true; }); await flush();
  assert.equal(delivered, false, 'onAudio must stop the reader when the playback buffer is full');
  const context = h.contexts[0];
  assert.ok(context.sources.filter(node => node.connected).length <= 25);
  for (const node of context.sources) assert.ok(node.starts[0] + node.buffer.size / 24000 <= context.currentTime + 3 + 1e-8);
  assert.ok(h.timers.size <= 1, 'one pump timer owns playback and watchdogs');
  h.advance(400); await pending;
  assert.equal(delivered, true);
  assert.ok(context.sources.filter(node => node.connected).length <= 25);
  for (const node of context.sources.filter(node => node.connected)) assert.ok(node.starts[0] + node.buffer.size / 24000 <= context.currentTime + 3 + 1e-8);
  h.controller.stop(); assertReleased(h);
});

test('an underrun stops mouth motion and waits for a fresh prebuffer before restarting', async () => {
  const h = harness(); await h.start(); await h.audio(pcm(5760)); h.advance(320);
  assert.deepEqual([h.controller.snapshot().active, h.controller.snapshot().pending, h.controller.snapshot().audioLevel], [false, true, 0]);
  await h.audio(pcm(2880)); assert.equal(h.contexts[0].sources.length, 2);
  await h.audio(pcm(2880)); assert.equal(h.contexts[0].sources.length, 4);
  assert.ok(h.contexts[0].sources[2].starts[0] >= h.contexts[0].currentTime + 0.034);
  h.advance(80); assert.equal(h.controller.snapshot().active, true);
  h.controller.dispose(); assertReleased(h);
});

test('zero-valued PCM has zero audio energy and progress remains estimated without splitting emoji', async () => {
  const h = harness(); await h.start(request('emoji', '猫😀好')); await h.audio(pcm(9600, 0)); await h.end(); h.advance(240);
  assert.equal(h.controller.snapshot().progressBasis, 'estimated'); assert.equal(h.controller.snapshot().audioLevel, 0);
  assert.notEqual(h.controller.snapshot().charIndex, 2);
  const before = h.controller.snapshot().charIndex;
  h.contexts[0].currentTime -= 0.1; h.advance(40); assert.ok(h.controller.snapshot().charIndex >= before);
  h.controller.dispose(); assertReleased(h);
});

test('selected sink must settle before the network starts and unsupported/missing devices fail closed', async () => {
  const routing = deferred();
  const h = harness({ speaker: 'headset', context: { setSinkId(id) { this.sinks.push(id); this.sinkId = id; return routing.promise; } } });
  h.controller.speak(request()); await flush();
  assert.equal(h.requests.length, 0); assert.deepEqual(h.contexts[0].sinks, ['headset']);
  routing.resolve(); await flush(); assert.equal(h.requests.length, 1); h.controller.stop(); assertReleased(h);
  for (const setSinkId of [undefined, () => Promise.reject(new Error('gone')), () => Promise.resolve()]) {
    const fail = harness({ speaker: 'missing', context: { setSinkId } }); fail.controller.speak(request()); await flush();
    assert.equal(fail.requests.length, 0); assert.match(fail.controller.snapshot().error, /扬声器/); assertReleased(fail);
  }
  const defaults = harness({ context: { setSinkId: undefined } }); await defaults.start(); assert.equal(defaults.requests.length, 1); defaults.controller.dispose();
});

test('device removal or an unexpected sink switch stops queued audio instead of silently using default output', async () => {
  let listener, removals = 0;
  const devices = { addEventListener(name, callback) { listener = callback; }, removeEventListener() { removals++; }, enumerateDevices: async () => [] };
  const h = harness({ speaker: 'headset', controller: { mediaDevices: devices } }); await h.start(); await h.audio(pcm(5760));
  listener(); await flush(); assert.match(h.controller.snapshot().error, /扬声器已断开/); assert.equal(removals, 1); assertReleased(h);
  const switched = harness({ speaker: 'headset' }); await switched.start(); await switched.audio(pcm(5760)); switched.contexts[0].sinkId = ''; switched.advance(40);
  assert.match(switched.controller.snapshot().error, /扬声器已不可用/); assertReleased(switched);
});

test('stop cancels queued audio and blocked transport; captured callbacks and late EOF cannot revive it', async () => {
  const h = harness(); await h.start();
  for (let i = 0; i < 5; i++) await h.audio(pcm(12288));
  const waiting = h.requests[0].handlers.onAudio(pcm(12288));
  const capturedEnd = h.contexts[0].sources[0].onended;
  h.controller.stop(); const stopped = h.controller.snapshot();
  assert.equal(h.requests[0].signal.aborted, true);
  await assert.rejects(waiting, { name: 'AbortError' });
  await assert.rejects(h.requests[0].handlers.onAudio(pcm(10)), { name: 'AbortError' });
  assert.throws(() => h.requests[0].handlers.onFormat(format), { name: 'AbortError' });
  capturedEnd(); await h.end(); assert.deepEqual(h.controller.snapshot(), stopped); assertReleased(h);
  assert.ok(h.contexts[0].sources.every(node => node.stops === 1));
});

test('unlock synchronously resumes one reusable context, and late resume after stop is permanently silent', async () => {
  const h = harness(); const unlocking = h.controller.unlock();
  assert.equal(h.contexts[0].resumed, 1, 'resume runs inside the click stack'); assert.equal(h.requests.length, 0);
  assert.equal(await unlocking, true); await h.start(); assert.equal(h.contexts.length, 1); h.controller.dispose(); assertReleased(h);
  const resume = deferred();
  const late = harness({ context: { resume() { this.resumed++; return resume.promise.then(() => { this.state = 'running'; }); } } });
  const pending = late.controller.unlock(); late.controller.stop(); assert.equal(await pending, false);
  resume.resolve(); await flush(); assert.equal(late.requests.length, 0); assertReleased(late);
});

test('pending unlock remains successful when speak takes the same context before resume settles', async () => {
  const resume = deferred();
  const h = harness({ context: { resume() { this.resumed++; return resume.promise.then(() => { this.state = 'running'; }); } } });
  let unlockResult;
  const unlocking = h.controller.unlock().then(result => { unlockResult = result; return result; });
  assert.equal(h.controller.speak(request()), true);
  assert.equal(h.contexts.length, 1); assert.equal(h.requests.length, 0);
  resume.resolve(); assert.equal(await unlocking, true); await flush();
  assert.equal(unlockResult, true, 'handing the unlocked context to speech must not disable auto-read');
  assert.equal(h.requests.length, 1); h.requests[0].handlers.onFormat(format);
  await h.audio(pcm(5760)); h.advance(80); assert.equal(h.controller.snapshot().active, true);
  h.controller.dispose(); assertReleased(h);
});

test('stop during routing and replacing a pending unlock discard late callbacks without damaging replacement', async () => {
  const routing = deferred(); const h = harness({ speaker: 'headset', context: { setSinkId() { return routing.promise; } } });
  h.controller.speak(request()); await flush(); h.controller.stop(); routing.resolve(); await flush(); assert.equal(h.requests.length, 0); assertReleased(h);
  const resume = deferred(); let resumes = 0;
  const late = harness({ context: { resume() { this.resumed++; if (++resumes === 1) return resume.promise; this.state = 'running'; return Promise.resolve(); } } });
  late.controller.speak(request('old')); await flush(); assert.equal(late.requests.length, 0);
  await late.start(request('new')); await late.audio(pcm(5760)); late.advance(80); const before = late.controller.snapshot();
  resume.reject(new Error('old denied')); await flush();
  assert.deepEqual(late.controller.snapshot(), before); assert.equal(late.contexts[0].gains[0].gain.value, 0); assert.equal(late.contexts[1].gains[0].gain.value, 1); late.controller.dispose();
});

test('empty/truncated/malformed streams and transport errors are explicit failures with no fallback', async () => {
  for (const scenario of ['empty', 'odd', 'transport']) {
    const h = harness(); await h.start();
    if (scenario === 'odd') await h.audio(new Uint8Array([1]));
    if (scenario === 'transport') h.requests[0].reject(new Error('上游连接中断')); else await h.end();
    await flush(); assert.match(h.controller.snapshot().error, scenario === 'transport' ? /上游连接中断/ : /为空或不完整/); assertReleased(h);
  }
  const h = harness(); await h.start();
  await assert.rejects(h.requests[0].handlers.onAudio(new Uint8Array(24577)), /数据格式/);
  assert.throws(() => h.requests[0].handlers.onFormat(format), /格式不受支持/);
  h.controller.dispose();
  const early = harness(); early.controller.speak(request()); await flush();
  await assert.rejects(early.requests[0].handlers.onAudio(pcm(1)), /数据格式/);
  early.controller.dispose();
  const ended = harness(); await ended.start(); await ended.audio(pcm(5760)); await ended.end();
  await assert.rejects(ended.requests[0].handlers.onAudio(pcm(1)), /数据格式/); ended.controller.dispose();
});

test('bounded unlock, sink, first-audio, stalled-stream and audio-clock deadlines release resources', async () => {
  const denied = harness({ context: { resume: () => Promise.reject(Object.assign(new Error('denied'), { name: 'NotAllowedError' })) } }); denied.controller.speak(request()); await flush();
  assert.match(denied.controller.snapshot().error, /直接点击/); assertReleased(denied);
  const unlock = harness({ context: { resume: () => new Promise(() => {}) } }); unlock.controller.speak(request()); unlock.advance(15000); await flush();
  assert.match(unlock.controller.snapshot().error, /解锁/); assertReleased(unlock);
  const sink = harness({ speaker: 'headset', context: { setSinkId: () => new Promise(() => {}) } }); sink.controller.speak(request()); await flush(); sink.advance(15000);
  assert.match(sink.controller.snapshot().error, /扬声器超时/); assertReleased(sink);
  const synthesis = harness(); await synthesis.start(); synthesis.advance(200000); assert.match(synthesis.controller.snapshot().error, /生成超时/); assertReleased(synthesis);
  const stalled = harness(); await stalled.start(); await stalled.audio(pcm(5760)); stalled.advance(30000); assert.match(stalled.controller.snapshot().error, /长时间没有收到/); assertReleased(stalled);
  const frozen = harness(); await frozen.start(); await frozen.audio(pcm(5760)); frozen.contexts[0].frozen = true; frozen.advance(15000); assert.match(frozen.controller.snapshot().error, /未能继续/); assertReleased(frozen);
});

test('a peer that slowly drips valid audio cannot evade the total utterance deadline', async () => {
  const h = harness(); await h.start();
  for (let i = 0; i < 60; i++) { await h.audio(pcm(5760)); h.advance(10000); }
  assert.match(h.controller.snapshot().error, /没有正常结束/); assert.equal(h.requests[0].signal.aborted, true); assertReleased(h);
});

test('invalid input does not allocate audio or fetch; dispose stops notifications and all later work', async () => {
  const h = harness();
  for (const text of ['', ' \n', '猫'.repeat(STREAM_SPEECH_TEXT_LIMIT + 1)]) assert.equal(h.controller.speak(request('bad', text)), false);
  assert.equal(h.contexts.length, 0); assert.equal(h.requests.length, 0); assert.match(h.controller.snapshot().error, /1000/);
  await h.start(); h.controller.dispose(); const count = h.states.length;
  await h.end(); assert.equal(h.controller.speak(request()), false); assert.equal(await h.controller.unlock(), false);
  h.controller.stop(); h.controller.dispose(); assert.equal(h.states.length, count); assertReleased(h);
  assert.equal(createStreamingSpeechController().speak(request()), false);
});
