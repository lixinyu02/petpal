import test from 'node:test';
import assert from 'node:assert/strict';
import { OPENUI_AUTO_GUIDE, MARKDOWN_TURN_GUIDE, prepareOutputRendering, withOutputGuide } from '../server/openui-policy.mjs';

test('automatic presentation is optional in the original response and describes draft-only actions', () => {
  const policy = prepareOutputRendering('帮我整理可填写的计划', { outputRendering: 'auto' });
  assert.equal(policy.outputRendering, 'auto');
  assert.match(policy.guide, /same response/);
  assert.match(policy.guide, /Preserve any exact text, code, JSON/);
  assert.match(policy.guide, /opening at column zero/);
  assert.match(policy.guide, /UseInPrompt only fills the user's draft/);
  assert.match(policy.guide, /Panel\(title: string, children:/);
  assert.ok(withOutputGuide('帮我整理可填写的计划', policy).endsWith('\n\n帮我整理可填写的计划'));
  assert.deepEqual(prepareOutputRendering('内部结构化任务'), {outputRendering:undefined, guide:'', resetThread:false});
});

test('long tasks and component guides stay complete and automatic without a presentation budget', () => {
  const task = '原'.repeat(50000) + '任务末尾';
  const guide = OPENUI_AUTO_GUIDE + '\n' + '组件参考'.repeat(10000) + '说明末尾';
  assert.ok(task.length > 32000); assert.ok(guide.length > 32000);
  for (const previousHasGuide of [false, true]) {
    const policy = prepareOutputRendering(task, {outputRendering:'auto', previousHasGuide, guide});
    assert.equal(policy.outputRendering, 'auto'); assert.equal(policy.resetThread, false);
    assert.equal(policy.guide, guide); assert.equal(withOutputGuide(task, policy), `${guide}\n\n${task}`);
  }
  const full = '用'.repeat(32000), policy = prepareOutputRendering(full, {outputRendering:'auto'});
  assert.equal(policy.outputRendering, 'auto');
  assert.equal(withOutputGuide(full, policy), `${OPENUI_AUTO_GUIDE}\n\n${full}`);
});

test('automatic presentation honors read-only card requests without replacing them with a form', () => {
  const policy = prepareOutputRendering('请用卡片展示上海和杭州的出行安排，不需要输入表单', {outputRendering:'auto'});
  assert.equal(policy.outputRendering, 'auto');
  assert.match(policy.guide, /Honor an explicit request to display or render visual cards/);
  assert.match(policy.guide, /read-only cards with no controls/);
  assert.match(policy.guide, /A card is a Panel component; there is no Card component/);
  assert.match(policy.guide, /rather than substituting an empty data-entry form/);
  assert.match(policy.guide, /requests to explain or show interface source code remain code/);
  assert.doesNotMatch(policy.guide, /Choose OpenUI only when interactive controls/);
});

test('missing optional guide falls back and inherited native guidance is explicitly disabled', () => {
  const fallback = prepareOutputRendering('原始任务', {outputRendering:'auto', guide:null, previousHasGuide:true});
  assert.equal(fallback.outputRendering, 'markdown'); assert.equal(fallback.guide, MARKDOWN_TURN_GUIDE); assert.equal(fallback.resetThread, false);
  const internal = prepareOutputRendering('只返回JSON', {previousHasGuide:true});
  assert.equal(internal.guide, MARKDOWN_TURN_GUIDE);
  const full = '整'.repeat(50000);
  const unavailable = prepareOutputRendering(full, {outputRendering:'auto', guide:null, previousHasGuide:true});
  assert.equal(unavailable.outputRendering, 'markdown'); assert.equal(unavailable.resetThread, false);
  assert.equal(withOutputGuide(full, unavailable), `${MARKDOWN_TURN_GUIDE}\n\n${full}`);
  const explicit = prepareOutputRendering(full, {outputRendering:'markdown', previousHasGuide:true});
  assert.equal(explicit.outputRendering, 'markdown'); assert.equal(explicit.resetThread, false);
  assert.equal(withOutputGuide(full, explicit), `${MARKDOWN_TURN_GUIDE}\n\n${full}`);
});
