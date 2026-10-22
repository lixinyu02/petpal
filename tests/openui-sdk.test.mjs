import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { OPENUI_LIMITS, openUIExample, openUIPrompt } from '../src/openui/library.mjs';
import { copyBoundedData, validateOpenUI } from '../src/openui/validate.mjs';

// Actual official parser and PetPal's controlled library; no parser or model doubles.
test('the server prompt is exactly the guide generated from the frontend library', () => {
  assert.equal(readFileSync(new URL('../server/openui/prompt.txt', import.meta.url), 'utf8'), openUIPrompt);
});
test('the generated model guide describes the same restricted PetPal library', () => {
  assert.match(openUIPrompt, /existing PetPal conversation/);
  assert.match(openUIPrompt, /Panel\(title: string, children:/);
  assert.match(openUIPrompt, /```openui fenced block/);
  assert.match(openUIPrompt, /@UseInPrompt\(text\?\)/);
  assert.match(openUIPrompt, /Never emit only a patch/);
  assert.doesNotMatch(openUIPrompt, /Example — simple nav|@OpenUrl\(url:|@ToAssistant\(message:/);
});

test("official SDK validates the published library example and all component types", () => {
  assert.deepEqual(validateOpenUI(openUIExample), { valid: true, errors: [] });
  const source = '$choice = "A"\nroot = Panel("检查", [Heading("结果", 2), Stack([Text("证据"), Field("note", "备注", "", true), Select("choice", "方案", ["A", "B"], $choice), Checkbox("ok", "确认", false)]), Table(["项目", "结果"], [["引脚", true], ["数值", 12], ["空值", null]]), Button("重置", @Reset($choice))])';
  assert.deepEqual(validateOpenUI(source), { valid: true, errors: [] });
});

test("strict final validation rejects dropped nodes, unsafe calls and invalid data", () => {
  const cases = [
    'root = Panel("坏节点", [Unknown("隐藏")])',
    'unused = Unknown("隐藏")\nroot = Panel("ok", [])',
    'unused = Text("隐藏")\nroot = Panel("ok", [])',
    'root = Text("需要Panel根")',
    'root = Panel("未闭合", [Text("x")',
    'root = Panel("未定义", [missing])',
    'root = Panel("坏属性", [Heading("x", 9)])',
    'root = Panel("坏表格", [Table(["a"], [[1, 2]])])',
    'root = Panel("重复字段", [Field("x", "A"), Field("x", "B")])',
    'root = Panel("缺状态", [Field("x", "X", $x)])',
    'root = Panel("跳转", [Button("go", @OpenUrl("https://example.invalid"))])',
    'root = Panel("跳转", [Button("go", {type:"open_url",url:"https://example.invalid"})])',
    'root = Panel("发消息", [Button("go", @ToAssistant("send"))])',
    'q = Query("read", {})\nroot = Panel("查询", [Text(q)])',
    'm = Mutation("write")\nroot = Panel("修改", [Button("go", @Run(m))])',
    '$x = ""\nroot = Panel("状态膨胀", [Button("go", @Set($x, $x + $x))])',
    '$x = ""\nroot = Panel("类型", [Button("go", @UseInPrompt(123))])',
    'root = Panel("继承", [Field("__proto__", "X")])',
    'root = Panel("继承", [Text("".constructor)])',
    'root = Panel("继承", [Text(""["__proto__"])])',
    'a = b\nb = a\nroot = Panel("循环", [a])',
    'root = Panel("重复根", [])\nroot = Panel("覆盖根", [])',
  ];
  for (const source of cases) assert.equal(validateOpenUI(source).valid, false, source);
});

test("complexity limits apply before official tree expansion", () => {
  const cases = [
    `root = Panel("x", [Text("${"x".repeat(12001)}")])`,
    `root = Panel("x", [${Array.from({ length: 251 }, () => 'Text("x")').join(",")}])`,
    `root = Panel("x", [${"Stack([".repeat(25)}Text("x")${"])".repeat(25)}])`,
    `root = Panel("x", [Text("${"中".repeat(30000)}")])`,
    'leaf = Text("x")\na = Stack([leaf, leaf])\nb = Stack([a, a])\nc = Stack([b, b])\nd = Stack([c, c])\ne = Stack([d, d])\nf = Stack([e, e])\ng = Stack([f, f])\nroot = Panel("膨胀", [g, g])',
  ];
  for (const source of cases) assert.equal(validateOpenUI(source).valid, false);
  const half = '$x = ""\nroot = Panel("流中", [Field("x", "X", $x),';
  assert.equal(validateOpenUI(half, { streaming: true }).valid, true);
  assert.equal(validateOpenUI(half).valid, false);
});

test('partial streaming syntax still rejects unsafe calls and excessive expansion', () => {
  for (const source of [
    'root = Panel("查询", [Query("read", {}),',
    'root = Panel("跳转", [Button("go", @OpenUrl("https://example.invalid")),',
    'root = Panel("调用", [Text("".constructor),',
    `root = Panel("深度", [${'Stack(['.repeat(25)}Text("x")`,
    'a = b\nb = a\nroot = Panel("循环", [a,',
  ]) assert.equal(validateOpenUI(source, { streaming: true }).valid, false, source);
  const partial = '$topic = ""\nroot = Panel("目标", [Field("topic", "目标", $topic),';
  assert.equal(validateOpenUI(partial, { streaming: true }).valid, true);
  assert.equal(validateOpenUI(partial).valid, false);
  assert.equal(validateOpenUI(partial + 'Button("加入输入框", @UseInPrompt())])').valid, true);
});

test('only bounded local actions and declared scalar state are accepted', () => {
  const prefix = '$topic = "初始"\n$confirmed = false\n';
  for (const action of [
    '@Set($topic, "新的目标")', '@Set($confirmed, true)', '@Reset($topic, $confirmed)',
    'Action([@Set($topic, "新目标"), @Reset($confirmed), @UseInPrompt("继续分析")])',
  ]) assert.equal(validateOpenUI(prefix + `root = Panel("本地动作", [Button("操作", ${action})])`).valid, true, action);
  for (const action of [
    '@Set($topic, ["不是标量"])', '@Set($missing, "值")', '@Reset($missing)',
    '@Reset()', '@Set($topic, $topic + $topic)', '@UseInPrompt(123)',
    `Action([${Array.from({ length: 21 }, () => '@Set($topic, "x")').join(',')}])`,
  ]) assert.equal(validateOpenUI(prefix + `root = Panel("坏动作", [Button("操作", ${action})])`).valid, false, action);
});

test('state snapshots clone finite JSON and reject prototype, cycles and size abuse', () => {
  const original = { $topic: '浦东天气', nested: { confirmed: true, count: 3 }, choices: ['A', null] };
  const copy = copyBoundedData(original);
  assert.deepEqual(copy, original);
  assert.notEqual(copy, original);
  assert.notEqual(copy.nested, original.nested);
  copy.nested.confirmed = false;
  assert.equal(original.nested.confirmed, true);
  const cyclic = {}; cyclic.self = cyclic;
  for (const value of [
    cyclic, { x: Number.NaN }, { x: Infinity }, { x: undefined }, { x: () => {} },
    { x: new Date() }, JSON.parse('{"safe":{"__proto__":{"polluted":true}}}'),
    JSON.parse('{"constructor":{}}'), { x: 'x'.repeat(OPENUI_LIMITS.text + 1) },
  ]) assert.throws(() => copyBoundedData(value));
  assert.throws(() => copyBoundedData({ x: '中'.repeat(80) }, 128), /size/);
  let deep = {};
  for (let i = 0; i < OPENUI_LIMITS.depth + 1; i++) deep = { child: deep };
  assert.throws(() => copyBoundedData(deep), /complexity/);
});

