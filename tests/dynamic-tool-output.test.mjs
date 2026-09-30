import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeComputerUseContent, dynamicToolContentItems, COMPUTER_USE_IMAGE_BYTES, COMPUTER_USE_TOTAL_IMAGE_BYTES, DYNAMIC_TOOL_TEXT_BYTES } from '../server/dynamic-tool-output.mjs';
import { CodexBridge } from '../server/codex.mjs';
import { computerUsePng, computerUseImage } from './helpers/computer-use-images.mjs';

const image = computerUseImage();
const output = content => ({ kind: 'computer-use-mcp', ok: true, tool: 'captureWindow', content });

test('Computer Use content retains only canonical inline text and PNG images', () => {
  const content = [{ type: 'text', text: 'window ready', annotations: { audience: ['assistant'] }, _meta: { ignored: true } }, { ...image, _meta: { ignored: true } }];
  assert.deepEqual(normalizeComputerUseContent(content), [{ type: 'text', text: 'window ready' }, image]);
  assert.equal(Object.hasOwn(content[0], '_meta'), true, 'upstream result is not mutated');
});

test('Computer Use rejects resource, audio, URLs, unsupported image types and malformed blocks', () => {
  for (const item of [null, 'text', { type: 'audio', mimeType: 'audio/wav', data: 'AAAA' }, { type: 'resource', resource: { uri: 'file:///private.png' } }, { type: 'resource_link', uri: 'https://other.invalid/image.png' }, { type: 'inputImage', imageUrl: 'https://other.invalid/image.png' }, { ...image, url: 'https://other.invalid/image.png' }, { ...image, mimeType: 'image/webp' }, { type: 'text', text: 1 }, { type: 'text', text: 'safe', data: image.data }]) {
    assert.throws(() => normalizeComputerUseContent([item]), { status: 502, code: 'invalid_output' });
  }
  for (const content of [undefined, {}, Array(129).fill({ type: 'text', text: '' })]) assert.throws(() => normalizeComputerUseContent(content), { code: 'invalid_output' });
});

test('Computer Use requires strict canonical base64 and matching valid PNG/JPEG bytes', () => {
  for (const data of ['', image.data + '\n', image.data.replace(/.$/, '_'), 'AB==', 'AAAA=', 'data:image/png;base64,' + image.data, computerUsePng().subarray(0, -1).toString('base64')]) assert.throws(() => normalizeComputerUseContent([{ ...image, data }]), { code: 'invalid_output' });
  assert.throws(() => normalizeComputerUseContent([{ ...image, mimeType: 'image/jpeg' }]), { code: 'invalid_output' });
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x08, 0x08, 0x00, 0x01, 0x00, 0x01, 0x01, 0xff, 0xda, 0x00, 0x02, 0x00, 0xff, 0xd9]);
  assert.deepEqual(normalizeComputerUseContent([computerUseImage(jpeg, 'image/jpeg')]), [computerUseImage(jpeg, 'image/jpeg')]);
  const corrupt = computerUsePng(); corrupt[32] ^= 1;
  assert.throws(() => normalizeComputerUseContent([computerUseImage(corrupt)]), { code: 'invalid_output' });
});

test('Computer Use bounds decoded image count, per-image bytes and combined bytes', () => {
  assert.throws(() => normalizeComputerUseContent([image, image, image]), { code: 'output_limit' });
  assert.throws(() => normalizeComputerUseContent([computerUseImage(Buffer.alloc(COMPUTER_USE_IMAGE_BYTES + 1))]), { code: 'output_limit' });
  const padded = computerUsePng(Math.floor(COMPUTER_USE_TOTAL_IMAGE_BYTES / 2));
  assert.ok(padded.length < COMPUTER_USE_IMAGE_BYTES);
  assert.throws(() => normalizeComputerUseContent([computerUseImage(padded), computerUseImage(padded)]), { code: 'output_limit' });
  assert.equal(normalizeComputerUseContent([computerUseImage(computerUsePng(COMPUTER_USE_IMAGE_BYTES - computerUsePng().length - 12))])[0].data.length, Math.ceil(COMPUTER_USE_IMAGE_BYTES / 3) * 4);
});

test('Computer Use text budget counts UTF-8 bytes across all blocks', () => {
  assert.equal(normalizeComputerUseContent([{ type: 'text', text: 'a'.repeat(DYNAMIC_TOOL_TEXT_BYTES) }])[0].text.length, DYNAMIC_TOOL_TEXT_BYTES);
  assert.throws(() => normalizeComputerUseContent([{ type: 'text', text: 'a'.repeat(DYNAMIC_TOOL_TEXT_BYTES) }, { type: 'text', text: 'b' }]), { code: 'output_limit' });
  assert.throws(() => normalizeComputerUseContent([{ type: 'text', text: '猫'.repeat(Math.floor(DYNAMIC_TOOL_TEXT_BYTES / 3) + 1) }]), { code: 'output_limit' });
});

test('dynamic Computer Use output emits actual inputImage and redacted text without duplicating base64', () => {
  const contentItems = dynamicToolContentItems(output([{ type: 'text', text: 'synthetic-sensitive-value' }, image]), text => text.replaceAll('synthetic-sensitive-value', '[hidden]'));
  assert.deepEqual(contentItems, [{ type: 'inputText', text: '{"ok":true,"tool":"captureWindow"}' }, { type: 'inputText', text: '[hidden]' }, { type: 'inputImage', imageUrl: `data:image/png;base64,${image.data}` }]);
  assert.equal(contentItems.filter(item => item.type === 'inputText').some(item => item.text.includes(image.data)), false);
  assert.throws(() => dynamicToolContentItems(output([{ type: 'text', text: 'a'.repeat(DYNAMIC_TOOL_TEXT_BYTES) }])), { code: 'output_limit' });
});

test('legacy desktop outputs retain JSON text shape, redaction and original text size limit', () => {
  assert.deepEqual(dynamicToolContentItems({ ok: false, error: 'private-value' }, text => text.replaceAll('private-value', '[hidden]')), [{ type: 'inputText', text: '{"ok":false,"error":"[hidden]"}' }]);
  assert.throws(() => dynamicToolContentItems({ data: 'a'.repeat(DYNAMIC_TOOL_TEXT_BYTES) }), /超过大小限制/);
});

test('Codex dynamic reply rejects invalid images and preserves explicit tool failure', () => {
  const bridge = new CodexBridge(), sent = []; bridge.child = {}; bridge._send = value => sent.push(value);
  const call = () => ({ rpcId: 'fixture-call', run: { child: bridge.child }, replied: false });
  bridge._replyDynamic(call(), true, { ...output([image]), ok: false });
  assert.equal(sent[0].result.success, false); assert.equal(sent[0].result.contentItems[1].type, 'inputImage');
  bridge._replyDynamic(call(), true, output([{ type: 'image', mimeType: 'image/png', data: 'AB==' }]));
  assert.equal(sent[1].result.success, false); assert.match(sent[1].result.contentItems[0].text, /格式无效/); assert.equal(sent[1].result.contentItems.length, 1);
  const circular = {}; circular.circular = circular; bridge._replyDynamic(call(), true, circular);
  assert.equal(sent[2].result.success, false); assert.equal(sent[2].result.contentItems[0].text, '工具返回了不可序列化的数据。');
});
