import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeSpeechEmotion, emotionExpression } from '../src/avatar/speech-emotion.mjs';

test('upstream emotion metadata is copied, frozen and mapped without interpreting text', () => {
  const mappings = { neutral: 'neutral', happy: 'happy', sad: 'sad', angry: 'pout', gentle: 'tender' };
  for (const [emotion, expression] of Object.entries(mappings)) {
    for (const intensity of ['natural', 'strong']) for (const source of ['rules', 'choice', 'manual']) {
      if (['neutral', 'gentle'].includes(emotion) && intensity === 'strong') continue;
      const original = { emotion, intensity, source }, normalized = normalizeSpeechEmotion(original);
      assert.deepEqual(normalized, original); assert.notEqual(normalized, original); assert.equal(Object.isFrozen(normalized), true);
      assert.equal(emotionExpression(normalized), expression);
      original.emotion = 'sad'; assert.equal(normalized.emotion, emotion);
    }
  }
  for (const missing of [null, undefined]) { assert.equal(normalizeSpeechEmotion(missing), null); assert.equal(emotionExpression(missing), null); }
});

test('emotion metadata rejects incomplete, extra and unrecognized fields instead of silently falling back', () => {
  const valid = { emotion: 'happy', intensity: 'natural', source: 'rules' };
  for (const value of [false, '', 'happy', [], {}, { ...valid, extra: true }, { ...valid, emotion: 'auto' },
    { ...valid, emotion: 'original' }, { ...valid, emotion: '__proto__' }, { ...valid, emotion: new String('happy') },
    { ...valid, intensity: 'custom' }, { ...valid, source: 'audio' }, { ...valid, emotion: 'neutral', intensity: 'strong' }, { ...valid, emotion: 'gentle', intensity: 'strong' },
    { emotion: 'happy', intensity: 'natural' }, Object.assign(Object.create({ source: 'rules' }), { emotion: 'happy', intensity: 'natural' })]) {
    assert.throws(() => normalizeSpeechEmotion(value), /朗读语气/); assert.throws(() => emotionExpression(value), /朗读语气/);
  }
});
