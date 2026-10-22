import test from 'node:test';
import assert from 'node:assert/strict';
import {splitOpenUI, openUIActionText, isOpenUIMode} from '../src/openui/protocol.mjs';

test('only explicit supported output modes and top-level UI blocks activate', () => {
  assert.equal(isOpenUIMode(undefined), false); assert.equal(isOpenUIMode('markdown'), false); assert.equal(isOpenUIMode('auto'), true);
  const result = splitOpenUI('说明\n\n```openui\nroot = Panel("选择", [])\n```\n\n结束');
  assert.deepEqual(result.parts.map(p => p.type), ['markdown', 'openui', 'markdown']);
  assert.equal(result.parts[1].closed, true);
  for (const example of ['````text\n```openui\nroot = Panel("示例", [])\n```\n````', '> ```openui\n> root = Panel("示例", [])\n> ```', '    ```openui\n    root = Panel("示例", [])\n    ```', '`openui`', '```openui-extra\ntext\n```']) {
    assert.equal(splitOpenUI(example).parts.some(p => p.type === 'openui'), false, example);
  }
});
test('indented, list and quoted examples never activate even while streaming', () => {
  const examples = [
    '- 示例：\n  ```openui\n  root = Panel("示例", [])\n  ```',
    '1. 示例：\n   ```openui\n   root = Panel("示例", [])\n   ```',
    '- ```openui\n  root = Panel("示例", [])\n  ```',
    '1. ```openui\n   root = Panel("示例", [])\n   ```',
    '> ```openui\n> root = Panel("示例", [])\n> ```',
    '> - 示例：\n>   ```openui\n>   root = Panel("示例", [])\n>   ```',
    '````markdown\n```openui\nroot = Panel("示例", [])\n```\n````',
    '~~~~markdown\n~~~openui\nroot = Panel("示例", [])\n~~~\n~~~~',
    ...[1, 2, 3, 4].map(spaces => ['```openui', 'root = Panel("示例", [])', '```'].map(line => ' '.repeat(spaces) + line).join('\n')),
  ];
  for (const example of examples) for (const streaming of [false, true]) {
    const result = splitOpenUI(example, {streaming});
    assert.equal(result.error, undefined, example);
    assert.deepEqual(result.parts, [{type:'markdown', text:example}], example);
  }
});
test('an indented example does not consume a subsequent explicit top-level UI', () => {
  const example = '- 示例：\n  ```openui\n  root = Panel("示例", [])\n  ```';
  const result = splitOpenUI(example + '\n\n```openui\nroot = Panel("实际界面", [])\n```');
  assert.deepEqual(result.parts.map(part => part.type), ['markdown', 'openui']);
  assert.equal(result.parts[1].text, 'root = Panel("实际界面", [])');
});
test('streamed UI waits for its source and terminal truncation falls back', () => {
  const source = '正文\n```openui\nroot = Panel("进行中", [';
  assert.equal(splitOpenUI(source, {streaming:true}).parts[1].closed, false);
  assert.match(splitOpenUI(source).error, /完整/);
  assert.match(splitOpenUI('x'.repeat(262145)).error, /过长/);
  assert.match(splitOpenUI('```openui\nroot = Panel("", [])\n```\n'.repeat(9)).error, /过多/);
});
test('host actions are bounded JSON converted only to plain draft text', () => {
  assert.equal(openUIActionText({type:'UseInPrompt',params:{text:'继续'},formState:{city:'北蔡镇',rain:true}}), '继续\n\n表单内容：\n{\n  "city": "北蔡镇",\n  "rain": true\n}');
  for (const bad of [
    {type:'Navigate',params:{text:'https://example.com'}},
    {type:'UseInPrompt',params:{url:'https://example.com'}},
    {type:'UseInPrompt',params:{text:'中'.repeat(6000)}},
    {type:'UseInPrompt',params:{},formState:JSON.parse('{"__proto__":{"polluted":true}}')},
    {type:'UseInPrompt',params:{},formState:{x:Infinity}},
    {type:'UseInPrompt',params:{},formState:{x:()=>1}},
  ]) assert.equal(openUIActionText(bad),null);
  const form={};form.loop=form;assert.equal(openUIActionText({type:'UseInPrompt',params:{},formState:form}),null);
  assert.equal({}.polluted,undefined);
});
