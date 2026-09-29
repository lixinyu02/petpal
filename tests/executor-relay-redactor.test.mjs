import test from 'node:test';
import assert from 'node:assert/strict';
import { createExecutorRelayRedactor } from '../server/executor-relay.mjs';
import { ResponsesStreamNormalizer } from '../server/codex-transport.mjs';

const secret = 'synthetic-private-upstream-key';
const mask = '[已隐藏]';
const frame = value => `event: ${value.type}\ndata: ${JSON.stringify(value)}\n\n`;
const delta = (text, extra = {}) => ({ type: 'response.output_text.delta', item_id: 'msg_fixture', output_index: 0, content_index: 0, delta: text, ...extra });
const message = (text, id = 'msg_fixture') => ({ id, type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text, annotations: [] }] });
const completed = (output = []) => ({ type: 'response.completed', response: { id: 'response_fixture', status: 'completed', output } });
const done = (text, extra = {}) => ({ ...delta(undefined, extra), type: 'response.output_text.done', text });
const parse = text => text.split(/\r?\n\r?\n/).filter(Boolean).flatMap(raw => {
  const data = raw.split(/\r?\n/).filter(line => line.startsWith('data:')).map(line => line.slice(5).replace(/^ /, '')).join('\n');
  return data && data !== '[DONE]' ? [JSON.parse(data)] : [];
});
function transform(values, { chunkSize = 17, ...options } = {}) {
  const redactor = createExecutorRelayRedactor({ secret, ...options });
  const bytes = Buffer.from(typeof values === 'string' ? values : values.map(frame).join(''));
  const output = [];
  for (let offset = 0; offset < bytes.length; offset += chunkSize) output.push(...redactor.push(bytes.subarray(offset, offset + chunkSize)));
  output.push(...redactor.finish());
  return output.join('');
}
const joined = (events, type = 'response.output_text.delta') => events.filter(value => value.type === type).map(value => value.delta).join('');

test('every credential split and single-byte UTF-8 network chunks redact both deltas and final snapshots', () => {
  for (let split = 1; split < secret.length; split++) {
    const text = `你好 ${secret} 再见。`;
    const output = transform([delta(`你好 ${secret.slice(0, split)}`), delta(`${secret.slice(split)} 再见。`), done(text), completed([message(text)])], { chunkSize: 1 });
    const events = parse(output);
    assert.equal(joined(events), `你好 ${mask} 再见。`, `split ${split}`);
    assert.equal(events.at(-1).response.output[0].content[0].text, `你好 ${mask} 再见。`);
    assert.ok(!output.includes(secret));
  }
});

test('safe text streams immediately, unresolved prefixes wait and false prefixes flush unchanged', () => {
  const redactor = createExecutorRelayRedactor({ secret });
  assert.equal(joined(parse(redactor.push(Buffer.from(frame(delta('Hello.')))).join(''))), 'Hello.');
  assert.deepEqual(redactor.push(Buffer.from(frame(delta('synthetic-')))), []);
  assert.equal(joined(parse(redactor.push(Buffer.from(frame(delta('not-a-key')))).join(''))), 'synthetic-not-a-key');
  assert.deepEqual(redactor.push(Buffer.from(frame(delta('synthetic')))), []);
  const final = redactor.push(Buffer.from(frame(done('Hello.synthetic-not-a-keysynthetic')) + frame(completed()))).concat(redactor.finish());
  assert.equal(joined(parse(final.join(''))), 'synthetic');
});

test('interleaved streams preserve each text, sequence numbers and SSE IDs in original order', () => {
  const a = { item_id: 'msg_a', output_index: 0 }, b = { item_id: 'msg_b', output_index: 1 };
  const events = [delta(secret.slice(0, 10), a), delta('other message', b), delta(secret.slice(10), a), done(secret, a), done('other message', b), completed([message(secret, 'msg_a'), message('other message', 'msg_b')])].map((value, index) => ({ ...value, sequence_number: index + 11 }));
  const output = transform(events.map((value, index) => `id: fixture-${index}\n${frame(value)}`).join(''));
  const actual = parse(output);
  assert.equal(joined(actual.filter(value => value.item_id === 'msg_a')), mask);
  assert.equal(joined(actual.filter(value => value.item_id === 'msg_b')), 'other message');
  assert.deepEqual(actual.map(value => value.sequence_number), events.map(value => value.sequence_number));
  assert.deepEqual(output.match(/^id: .*$/gm), events.map((_, index) => `id: fixture-${index}`));
});

test('optional response IDs and irrelevant indices cannot split one text stream into unsafe aliases', () => {
  const output = parse(transform([delta(secret.slice(0, 10)), delta(secret.slice(10), { response_id: 'response_fixture', summary_index: 9 }), done(secret), completed([message(secret)])]));
  assert.equal(joined(output), mask);
  for (const extra of [{ item_id: 'different' }, { response_id: 'different' }]) {
    assert.throws(() => transform([delta(secret.slice(0, 10), { response_id: 'response_fixture' }), delta(secret.slice(10), extra), completed()]));
  }
});

test('tool arguments/input, refusal and reasoning deltas redact before their done snapshots', () => {
  for (const [name, field, scope] of [
    ['function_call_arguments', 'arguments', {}], ['custom_tool_call_input', 'input', {}],
    ['refusal', 'refusal', { content_index: 0 }], ['reasoning_text', 'text', { content_index: 0 }],
    ['reasoning_summary_text', 'text', { summary_index: 0 }],
  ]) {
    const type = `response.${name}.delta`, base = { item_id: 'fixture', output_index: 0, ...scope };
    const actual = parse(transform([
      { type, ...base, delta: `prefix ${secret.slice(0, 10)}` }, { type, ...base, delta: `${secret.slice(10)} suffix` },
      { type: `response.${name}.done`, ...base, [field]: `prefix ${secret} suffix` }, completed(),
    ]));
    assert.equal(joined(actual, type), `prefix ${mask} suffix`);
    assert.equal(actual.at(-2)[field], `prefix ${mask} suffix`);
  }
});

test('item and content completion flush only matching pending streams', () => {
  const redactor = createExecutorRelayRedactor({ secret });
  const partial = secret.slice(0, 4);
  redactor.push(Buffer.from(frame(delta(partial))));
  assert.deepEqual(redactor.push(Buffer.from(frame({ type: 'response.output_item.done', output_index: 1, item: { id: 'other' } }))), []);
  const flushed = redactor.push(Buffer.from(frame({ type: 'response.content_part.done', output_index: 0, item_id: 'msg_fixture', content_index: 0, part: { type: 'output_text', text: partial } })));
  assert.equal(joined(parse(flushed.join(''))), partial);
  assert.throws(() => redactor.push(Buffer.from(frame(delta('late')))));
});

test('nested snapshots, object keys, metadata, comments and JSON Unicode escapes redact exact credentials', () => {
  const payload = completed([{ [secret]: [{ text: secret, arguments: `{"key":"${secret}"}` }] }]);
  const snapshot = { type: 'response.output_item.done', output_index: 0, item: { id: 'fixture', type: 'function_call', name: 'tool', call_id: 'call', arguments: secret, description: `line 1\n${secret}\nline 3` } };
  const raw = `: ${secret}\n\nid: ${secret}\n${frame(snapshot)}${frame(payload)}`;
  const output = transform(raw);
  assert.ok(!output.includes(secret));
  assert.equal(parse(output)[0].item.arguments, mask);
  assert.equal(parse(output)[0].item.description, `line 1\n${mask}\nline 3`);
  assert.deepEqual(parse(output)[1].response.output[0][mask][0], { text: mask, arguments: `{"key":"${mask}"}` });
  const encoded = frame({ type: 'error', error: { message: secret } }).replace(secret, [...secret].map(character => `\\u${character.charCodeAt(0).toString(16).padStart(4, '0')}`).join(''));
  assert.equal(parse(transform(encoded))[0].error.message, mask);
});

test('conventional no-match SSE and empty-secret streams remain unchanged, including valid empty completion', () => {
  const raw = frame(completed());
  assert.equal(transform(raw), raw);
  const normal = [delta('A normal message.'), done('A normal message.'), completed([message('A normal message.')])].map(frame).join('');
  assert.equal(transform(normal), normal);
  assert.equal(transform(normal, { secret: '' }), normal);
  assert.equal(transform(raw + 'data: [DONE]\n\n'), raw + 'data: [DONE]\n\n');
});

test('redacted text/tool streams remain consistent through the desktop Responses normalizer', () => {
  for (const kind of ['text', 'function_call', 'custom_tool_call']) {
    const text = `before ${secret} after`;
    const item = kind === 'text' ? message(text) : { type: kind, id: 'tool_fixture', name: 'fixture_tool', call_id: 'fixture_call', status: 'completed', [kind === 'function_call' ? 'arguments' : 'input']: text };
    const type = kind === 'text' ? 'response.output_text' : kind === 'function_call' ? 'response.function_call_arguments' : 'response.custom_tool_call_input';
    const field = kind === 'text' ? 'text' : kind === 'function_call' ? 'arguments' : 'input';
    const scope = { item_id: item.id, output_index: 0, ...(kind === 'text' ? { content_index: 0 } : {}) };
    const transformed = parse(transform([
      { type: `${type}.delta`, ...scope, delta: `before ${secret.slice(0, 11)}` },
      { type: `${type}.delta`, ...scope, delta: `${secret.slice(11)} after` },
      { type: `${type}.done`, ...scope, [field]: text }, completed([item]),
    ]));
    const normalizer = new ResponsesStreamNormalizer();
    const result = parse(transformed.flatMap(value => normalizer.accept(value)).concat(normalizer.finish()).join(''));
    assert.equal(joined(result, `${type}.delta`), `before ${mask} after`);
    const finalItem = result.find(value => value.type === 'response.output_item.done').item;
    assert.equal(kind === 'text' ? finalItem.content[0].text : finalItem[field], `before ${mask} after`);
    if (kind !== 'text') assert.equal(finalItem.call_id, item.call_id);
  }
});

test('invalid/truncated SSE, post-terminal data, malformed scope and invalid UTF-8 fail with safe errors', () => {
  const bad = [
    'data: {bad}\n\n', frame(delta('unfinished')), frame(completed()).trimEnd(),
    `event: wrong\ndata: ${JSON.stringify(completed())}\n\n`, 'data: [DONE]\n\n',
    frame(completed()) + frame(delta('late')), frame(completed()) + 'data: [DONE]\n\ndata: [DONE]\n\n',
    frame({ type: 'response.done', response: completed().response }),
    frame({ ...delta('x'), content_index: undefined }) + frame(completed()),
    frame({ ...delta('x'), item_id: undefined }) + frame(completed()),
    frame({ ...delta('x'), output_index: -1 }) + frame(completed()),
    frame({ ...delta('x'), delta: {} }) + frame(completed()),
  ];
  for (const raw of bad) assert.throws(() => transform(raw), error => error.message === '中央模型流不完整或格式无效。');
  for (const bytes of [Buffer.from([0xc3, 0x28]), Buffer.from([0xf0, 0x9f])]) {
    const redactor = createExecutorRelayRedactor({ secret });
    assert.throws(() => { redactor.push(bytes); redactor.finish(); }, /中央模型流/);
  }
});

test('frame/input/output expansion/depth/stream bounds fail closed', () => {
  assert.throws(() => transform([completed()], { maxFrameBytes: 16 }));
  assert.throws(() => transform([completed()], { maxOutputBytes: 16 }));
  const expanded = frame({ type: 'error', message: 'a'.repeat(20) });
  assert.throws(() => transform(expanded, { secret: 'a', maxOutputBytes: Buffer.byteLength(expanded) + 1 }));
  let nested = 'value'; for (let i = 0; i < 66; i++) nested = { nested };
  assert.throws(() => transform([{ type: 'error', nested }]));
  const events = Array.from({ length: 513 }, (_, i) => delta('x', { item_id: `item_${Math.floor(i / 512)}`, output_index: Math.floor(i / 512), content_index: i % 512 }));
  assert.throws(() => transform([...events, completed()]));
  for (const options of [{ secret: 'x'.repeat(8193) }, { maxFrameBytes: 0 }, { maxOutputBytes: 0 }, { secret: 3 }]) assert.throws(() => createExecutorRelayRedactor(options));
});

test('overlapping prefixes and pathological short credentials never recreate the secret with the mask', () => {
  for (const key of ['aba', '[', '已', 'x', 'aaaa', '💛猫']) {
    const value = `${key}${key}tail`, values = [...value].map(character => delta(character));
    const actual = parse(transform([...values, done(value), completed([message(value)])], { secret: key, chunkSize: 1 }));
    // A deliberately tiny key can also match protocol field names/types;
    // exact-redaction takes precedence and the downstream validator rejects it.
    const text = actual.filter(event => typeof event.delta === 'string').map(event => event.delta).join('');
    const part = actual.at(-1).response.output[0].content[0];
    const snapshot = Object.entries(part).find(([name, field]) => name !== 'type' && typeof field === 'string')[1];
    assert.ok(!text.includes(key), key);
    assert.equal(text, snapshot);
  }
});

test('overlapping credential prefixes match whole-string redaction for many deterministic segmentations', () => {
  let seed = 17;
  const next = n => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % n; };
  for (const key of ['abab', 'aaaab', 'ababa', 'synthetic-key']) {
    for (let attempt = 0; attempt < 50; attempt++) {
      const text = Array.from({ length: 12 }, () => ['a', 'ab', key, key.slice(0, -1), '!', '中'][next(6)]).join('');
      const pieces = []; for (let offset = 0; offset < text.length;) { const size = 1 + next(9); pieces.push(delta(text.slice(offset, offset + size))); offset += size; }
      const actual = parse(transform([...pieces, done(text), completed([message(text)])], { secret: key, chunkSize: 1 + next(30) }));
      assert.equal(joined(actual), text.split(key).join(mask), `${key}: attempt ${attempt}`);
    }
  }
});
