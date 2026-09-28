import test from 'node:test';
import assert from 'node:assert/strict';
import { createSpeechController, selectSpeechVoice, speechLanguage, splitSpeechText, SPEECH_SEGMENT_LIMIT } from '../src/avatar/speech.mjs';

const voices = [
  { name: 'Online Chinese', lang: 'zh-CN', localService: false, default: true },
  { name: 'Local Chinese', lang: 'zh-CN', localService: true, default: false },
  { name: 'Local English', lang: 'en-US', localService: true, default: true },
];
function harness(options = {}) {
  let time = 100, nextId = 1, cancellations = 0;
  const timers = new Map(), played = [], states = [];
  const synthesis = {
    speaking: false, paused: false,
    getVoices: () => voices,
    speak: utterance => played.push(utterance),
    cancel: () => { cancellations++; synthesis.speaking = false; },
    ...options.synthesis,
  };
  const engine = createSpeechController({ synthesis, createUtterance: text => ({ text }), now: () => time,
    schedule: (callback, delay) => { const id = nextId++; timers.set(id, { callback, due: time + delay }); return id; },
    unschedule: id => timers.delete(id), onState: state => states.push(state), ...options.controller });
  return { engine, played, states, synthesis, timers, get cancellations() { return cancellations; },
    start(index = played.length - 1) { synthesis.speaking = true; played[index].onstart?.(); },
    end(index = played.length - 1) { synthesis.speaking = false; played[index].onend?.(); },
    advance(milliseconds) {
      const end = time + milliseconds;
      for (;;) {
        const due = [...timers].filter(([, timer]) => timer.due <= end).sort((a, b) => a[1].due - b[1].due)[0];
        if (!due) break;
        timers.delete(due[0]); time = due[1].due; due[1].callback();
      }
      time = end;
    },
  };
}

test('sentence chunks preserve original UTF-16 positions, split English sentences and bound long text', () => {
  const text = '  你好，小伴！\nHello world. Good night!  ' + '猫'.repeat(158) + '😀' + '好'.repeat(200);
  const chunks = splitSpeechText(text);
  assert.deepEqual(chunks.slice(0, 3).map(chunk => chunk.text), ['你好，小伴！', 'Hello world.', 'Good night!']);
  assert.ok(chunks.length > 4);
  for (const chunk of chunks) {
    assert.equal(text.slice(chunk.start, chunk.end), chunk.text);
    assert.ok(chunk.text.length <= SPEECH_SEGMENT_LIMIT);
    assert.equal(/^[\uDC00-\uDFFF]|[\uD800-\uDBFF]$/u.test(chunk.text), false, 'must not cut a surrogate pair');
  }
  assert.equal(chunks.map(chunk => chunk.text).join('').replace(/\s/g, ''), text.replace(/\s/g, ''));
  assert.deepEqual(splitSpeechText('   \n'), []);
});

test('voice selection is local-only and language-aware with no remote or mismatched fallback', () => {
  assert.equal(selectSpeechVoice(voices, 'zh-TW').name, 'Local Chinese');
  assert.equal(selectSpeechVoice(voices, 'en').name, 'Local English');
  assert.equal(selectSpeechVoice(voices, 'ja'), null);
  assert.equal(selectSpeechVoice([voices[0]], 'zh'), null);
  assert.equal(speechLanguage('你好。Hello!'), 'zh');
  assert.equal(speechLanguage('こんにちは'), 'ja');
  assert.equal(speechLanguage('안녕하세요'), 'ko');
  assert.equal(speechLanguage('Hello'), 'en');
});

test('queued utterance does not animate before actual start; boundary progress maps to original text', () => {
  const h = harness();
  assert.equal(h.engine.speak({ utteranceId: 'one', text: '  你好世界。' }), true);
  assert.equal(h.played.length, 1);
  assert.equal(h.played[0].voice.name, 'Local Chinese');
  h.advance(2000);
  assert.equal(h.engine.snapshot().active, false);
  assert.equal(h.engine.snapshot().pending, true);
  assert.equal(h.engine.snapshot().charIndex, 2);
  h.start(); h.played[0].onboundary({ charIndex: 2 });
  assert.deepEqual([h.engine.snapshot().charIndex, h.engine.snapshot().active, h.engine.snapshot().progressBasis], [4, true, 'boundary']);
  h.advance(500);
  assert.equal(h.engine.snapshot().progressBasis, 'boundary');
  h.end();
  assert.equal(h.engine.snapshot().ended, true);
  assert.equal(h.engine.snapshot().active, false);
  assert.equal(h.timers.size, 0);
});

test('missing boundaries use bounded estimated progress only while the engine is speaking', () => {
  const h = harness(); h.engine.speak({ utteranceId: 'estimate', text: '这是较长的中文测试句子，用来检查进度。' });
  h.start(); h.advance(1000);
  assert.equal(h.engine.snapshot().progressBasis, 'estimated');
  assert.equal(h.engine.snapshot().charIndex, 4);
  h.synthesis.paused = true; h.advance(500);
  assert.equal(h.engine.snapshot().active, false);
  assert.equal(h.engine.snapshot().charIndex, 4);
  h.synthesis.paused = false; h.advance(500);
  assert.equal(h.engine.snapshot().active, true);
  assert.ok(h.engine.snapshot().charIndex >= 4);
  h.synthesis.speaking = false; h.advance(3300);
  assert.equal(h.engine.snapshot().ended, true);
  assert.match(h.engine.snapshot().error, /已停止/);
  assert.equal(h.timers.size, 0);
});

test('sentences play sequentially with original indexes and close between utterances', () => {
  const h = harness(); h.engine.speak({ utteranceId: 'sentences', text: '你好。  再见！' });
  h.start(); h.end();
  assert.deepEqual(h.played.map(utterance => utterance.text), ['你好。', '再见！']);
  assert.deepEqual([h.engine.snapshot().active, h.engine.snapshot().pending, h.engine.snapshot().charIndex], [false, true, 5]);
  h.start(); h.played[1].onboundary({ charIndex: 1 });
  assert.equal(h.engine.snapshot().charIndex, 6);
  h.end();
  assert.deepEqual([h.engine.snapshot().active, h.engine.snapshot().pending, h.engine.snapshot().ended], [false, false, true]);
  assert.equal(h.engine.snapshot().charIndex, 8);
});

test('stop and replacement invalidate old callbacks and do not resume queued sentences', () => {
  const h = harness(); h.engine.speak({ utteranceId: 'old', text: '第一句。第二句。' });
  const oldStart = h.played[0].onstart, oldEnd = h.played[0].onend, oldError = h.played[0].onerror;
  h.engine.stop();
  oldStart(); oldEnd(); oldError({ error: 'not-allowed' }); h.advance(20000);
  assert.equal(h.played.length, 1); assert.equal(h.timers.size, 0);
  assert.equal(h.engine.snapshot().active, false); assert.equal(h.engine.snapshot().error, '');
  assert.equal(h.cancellations, 1);
  h.engine.stop(); assert.equal(h.cancellations, 1, 'idle stop must not cancel another controller');
  h.engine.speak({ utteranceId: 'new', text: '新回复。' }); h.start(); oldEnd();
  assert.equal(h.engine.snapshot().utteranceId, 'new'); assert.equal(h.played.length, 2);
  h.engine.dispose(); assert.equal(h.timers.size, 0);
  assert.equal(h.engine.speak({ utteranceId: 'disposed', text: '不会再播放。' }), false);
});

test('unsupported services and missing local voices return explicit errors and never queue sound', () => {
  const unsupported = createSpeechController();
  assert.equal(unsupported.speak({ utteranceId: 'x', text: '你好' }), false);
  assert.match(unsupported.snapshot().error, /不支持/);
  const remoteOnly = harness({ synthesis: { getVoices: () => [voices[0]] } });
  assert.equal(remoteOnly.engine.speak({ utteranceId: 'x', text: '你好' }), false);
  assert.match(remoteOnly.engine.snapshot().error, /本地中文音色/);
  assert.equal(remoteOnly.played.length, 0);
  const throwing = harness({ synthesis: { speak() { throw new Error('unavailable'); } } });
  assert.equal(throwing.engine.speak({ utteranceId: 'x', text: '你好' }), false);
  assert.equal(throwing.engine.snapshot().active, false);
  assert.equal(throwing.timers.size, 0);
});

test('start timeout, browser gesture rejection and end timeout terminate cleanly', () => {
  const waiting = harness(); waiting.engine.speak({ utteranceId: 'wait', text: '你好。' }); waiting.advance(10000);
  assert.match(waiting.engine.snapshot().error, /未能启动/); assert.equal(waiting.timers.size, 0);
  const denied = harness(); denied.engine.speak({ utteranceId: 'denied', text: '你好。' }); denied.played[0].onerror({ error: 'not-allowed' });
  assert.match(denied.engine.snapshot().error, /直接点击/); assert.equal(denied.engine.snapshot().pending, false);
  const hung = harness(); hung.engine.speak({ utteranceId: 'hung', text: '你好。' }); hung.start(); hung.advance(35000);
  assert.match(hung.engine.snapshot().error, /没有正常结束/); assert.equal(hung.timers.size, 0);
});
