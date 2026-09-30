import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultVoiceSettings, publicVoiceSettings, patchVoiceSettings } from '../server/voice.mjs';

const remote = (section, extra = {}) => ({ [section]: { mode: 'remote', baseUrl: 'https://speech.example.com/v1', model: 'speech-model', ...extra } });
const badRequest = action => assert.throws(action, error => error.status === 400 && typeof error.message === 'string');

test('voice defaults are independent and public metadata does not enable remote runtimes', () => {
  const first = defaultVoiceSettings(), second = defaultVoiceSettings();
  assert.deepEqual(first, {
    tts: { mode: 'system', baseUrl: '', model: '', voice: '', speed: 1, apiKey: '', emotion: 'auto', emotionIntensity: 'natural' },
    asr: { mode: 'disabled', baseUrl: '', model: '', language: 'zh-CN', apiKey: '' },
  });
  first.tts.voice = 'changed'; assert.equal(second.tts.voice, '');
  const visible = publicVoiceSettings(patchVoiceSettings(first, remote('tts', { apiKey: 'private-token' })));
  assert.equal(visible.tts.mode, 'remote'); assert.equal(visible.tts.hasApiKey, true); assert.equal(visible.asr.hasApiKey, false);
  assert.equal('apiKey' in visible.tts, false); assert.equal('apiKey' in visible.asr, false);
  assert.deepEqual(visible.runtime, { tts: 'system', asr: 'not-connected', remoteConfiguredOnly: true });
});

test('patches are immutable, partial, and whitelist settings instead of user scope or private metadata', () => {
  const previous = defaultVoiceSettings(); Object.freeze(previous.tts); Object.freeze(previous.asr); Object.freeze(previous);
  const body = JSON.parse('{"userId":"other-user","tts":{"voice":" warm ","hasApiKey":true,"__proto__":{"polluted":true}},"runtime":{"tts":"remote"}}');
  const result = patchVoiceSettings(previous, body);
  assert.equal(result.tts.voice, 'warm'); assert.equal(previous.tts.voice, '');
  assert.notEqual(result.asr, previous.asr); assert.equal('userId' in result, false);
  assert.equal('hasApiKey' in result.tts, false); assert.equal({}.polluted, undefined);
  const visible = publicVoiceSettings({ ...result, userId: 'other-user', secret: 'hidden', tts: { ...result.tts, hiddenKey: 'secret' } });
  assert.equal(JSON.stringify(visible).includes('secret'), false); assert.equal('hiddenKey' in visible.tts, false);
  assert.deepEqual(patchVoiceSettings(undefined, {}), defaultVoiceSettings());
});

test('remote modes require URL and model but allow unauthenticated local services', () => {
  for (const section of ['tts', 'asr']) {
    badRequest(() => patchVoiceSettings(null, { [section]: { mode: 'remote' } }));
    badRequest(() => patchVoiceSettings(null, remote(section, { model: ' ' })));
    badRequest(() => patchVoiceSettings(null, remote(section, { baseUrl: '' })));
    const saved = patchVoiceSettings(null, remote(section, { baseUrl: 'http://127.0.0.1:7777/v1/' }));
    assert.equal(saved[section].baseUrl, 'http://127.0.0.1:7777/v1'); assert.equal(saved[section].apiKey, '');
  }
  assert.equal(patchVoiceSettings(null, { asr: { mode: 'browser', language: '' } }).asr.language, '');
});

test('both speech endpoints enforce HTTPS except literal local deployment addresses', () => {
  const valid = ['https://speech.example.com/v1', 'http://localhost:8181', 'http://voice.local/v1', 'http://child.localhost/v1', 'http://127.2.3.4', 'http://10.2.3.4', 'http://172.16.0.1', 'http://172.31.255.254', 'http://192.168.1.7', 'http://[::1]:8181/v1', 'http://[fd12::1]', 'http://[fe80::1]'];
  const invalid = ['http://speech.example.com', 'http://localhost.example.com', 'http://8.8.8.8', 'http://172.15.0.1', 'http://172.32.0.1', 'http://192.169.1.1', 'http://0.0.0.0', 'http://[2001:4860:4860::8888]', 'file:///tmp/voice', 'https://user:pass@example.com', 'https://example.com/?key=private', 'https://example.com/#secret', 'https://example.com/?', 'https://example.com/#', 'https://example.com/a b', 'https://example.com\\path', '/v1', 'https://example.com/\n'];
  for (const section of ['tts', 'asr']) {
    for (const baseUrl of valid) assert.ok(patchVoiceSettings(null, remote(section, { baseUrl }))[section].baseUrl, baseUrl);
    for (const baseUrl of invalid) badRequest(() => patchVoiceSettings(null, remote(section, { baseUrl })));
  }
});

test('keys are retained only at the same canonical endpoint; endpoint changes require deliberate rotation', () => {
  for (const section of ['tts', 'asr']) {
    const previous = patchVoiceSettings(null, remote(section, { apiKey: 'original-key' }));
    for (const apiKey of ['', '   ']) assert.equal(patchVoiceSettings(previous, { [section]: { apiKey } })[section].apiKey, 'original-key');
    assert.equal(patchVoiceSettings(previous, { [section]: { baseUrl: 'https://SPEECH.example.com:443/v1/', apiKey: '' } })[section].apiKey, 'original-key');
    for (const baseUrl of ['https://other.example.com/v1', 'https://speech.example.com/v2', 'https://speech.example.com:444/v1', '']) {
      badRequest(() => patchVoiceSettings(previous, { [section]: { mode: section === 'tts' ? 'system' : 'disabled', baseUrl, apiKey: '' } }));
    }
    const moved = { baseUrl: 'https://other.example.com/v1' };
    assert.equal(patchVoiceSettings(previous, { [section]: { ...moved, apiKey: 'new-key' } })[section].apiKey, 'new-key');
    assert.equal(patchVoiceSettings(previous, { [section]: { ...moved, clearApiKey: true } })[section].apiKey, '');
    assert.equal(patchVoiceSettings(previous, { [section]: { clearApiKey: true, apiKey: '' } })[section].apiKey, '');
    badRequest(() => patchVoiceSettings(previous, { [section]: { clearApiKey: true, apiKey: 'new-key' } }));
    assert.equal(previous[section].apiKey, 'original-key');
  }
});

test('invalid supplied field types, lengths, control characters and enums return 400', () => {
  for (const body of [null, [], 'voice', true, 1]) badRequest(() => patchVoiceSettings(null, body));
  for (const section of ['tts', 'asr']) {
    for (const value of [null, [], 'voice', true, 1]) badRequest(() => patchVoiceSettings(null, { [section]: value }));
    for (const mode of [null, [], true, 1, '', 'unknown']) badRequest(() => patchVoiceSettings(null, { [section]: { mode } }));
    for (const [field, limit] of [['baseUrl', 2048], ['model', 160], ['apiKey', 8192], [section === 'tts' ? 'voice' : 'language', section === 'tts' ? 160 : 35]]) {
      for (const value of [null, false, 1, {}, [], 'x'.repeat(limit + 1), 'value\n', 'value\0']) badRequest(() => patchVoiceSettings(null, { [section]: { [field]: value } }));
    }
    for (const clearApiKey of [null, 0, 1, '', 'true']) badRequest(() => patchVoiceSettings(null, { [section]: { clearApiKey } }));
    badRequest(() => patchVoiceSettings(null, { [section]: { apiKey: 'has space' } }));
    assert.equal(patchVoiceSettings(null, { [section]: { model: 'x'.repeat(160), apiKey: 'x'.repeat(8192) } })[section].apiKey.length, 8192);
  }
  for (const speed of [null, '1', true, NaN, Infinity, -Infinity, 0.2499, 4.0001]) badRequest(() => patchVoiceSettings(null, { tts: { speed } }));
  for (const speed of [0.25, 1, 4]) assert.equal(patchVoiceSettings(null, { tts: { speed } }).tts.speed, speed);
  badRequest(() => patchVoiceSettings(null, { asr: { speed: 1 } }));
  badRequest(() => patchVoiceSettings(null, { tts: { mode: 'browser' } }));
  badRequest(() => patchVoiceSettings(null, { asr: { mode: 'system' } }));
});

test('a rejected second section never mutates previously saved first-section data', () => {
  const previous = patchVoiceSettings(null, remote('tts', { apiKey: 'saved-key' }));
  const before = structuredClone(previous);
  badRequest(() => patchVoiceSettings(previous, { tts: { voice: 'changed', apiKey: 'replaced-key' }, asr: { mode: 'remote' } }));
  assert.deepEqual(previous, before);
});

test('legacy accounts receive automatic emotion defaults and only finite presets persist per user', () => {
  const old = { tts: { mode: 'cosyvoice', speed: 1, apiKey: 'private' } };
  assert.equal(publicVoiceSettings(old).tts.emotion, 'auto');
  assert.equal(publicVoiceSettings(old).tts.emotionIntensity, 'natural');
  for (const emotion of ['original', 'auto', 'neutral', 'happy', 'sad', 'angry', 'gentle']) {
    const saved = patchVoiceSettings(old, { tts: { emotion, emotionIntensity: 'strong' } });
    assert.equal(saved.tts.emotion, emotion);
    assert.equal(saved.tts.emotionIntensity, ['original', 'neutral', 'gentle'].includes(emotion) ? 'natural' : 'strong');
    assert.equal(old.tts.emotion, undefined);
    assert.equal(JSON.stringify(publicVoiceSettings(saved)).includes('private'), false);
  }
  for (const emotion of ['', 'manual', 'shy', null, [], 1, 'happy\n']) badRequest(() => patchVoiceSettings(old, { tts: { emotion } }));
  for (const emotionIntensity of ['', 'custom', null, 1]) badRequest(() => patchVoiceSettings(old, { tts: { emotionIntensity } }));
  badRequest(() => patchVoiceSettings(old, { asr: { emotion: 'happy' } }));
  badRequest(() => patchVoiceSettings(old, { asr: { emotionIntensity: 'strong' } }));
});

test('CosyVoice uses shared service without user URLs or models and validates its narrower speed range', () => {
  const settings = patchVoiceSettings(null, { tts: { mode: 'cosyvoice' } });
  assert.equal(settings.tts.baseUrl, ''); assert.equal(settings.tts.model, '');
  assert.deepEqual(publicVoiceSettings(settings).runtime, { tts: 'cosyvoice', asr: 'not-connected', remoteConfiguredOnly: false });
  for (const speed of [0.5, 1, 2]) assert.equal(patchVoiceSettings(settings, { tts: { speed } }).tts.speed, speed);
  for (const speed of [0.25, 0.49, 2.01, 4]) badRequest(() => patchVoiceSettings(settings, { tts: { speed } }));
  const legacy = patchVoiceSettings(null, remote('tts', { speed: 4, apiKey: 'legacy-key' }));
  badRequest(() => patchVoiceSettings(legacy, { tts: { mode: 'cosyvoice' } }));
  const switched = patchVoiceSettings(legacy, { tts: { mode: 'cosyvoice', speed: 1 } });
  assert.equal(switched.tts.apiKey, legacy.tts.apiKey); assert.equal(switched.tts.baseUrl, legacy.tts.baseUrl);
});
