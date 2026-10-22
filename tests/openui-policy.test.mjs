import test from 'node:test';
import assert from 'node:assert/strict';
import { OPENUI_AUTO_GUIDE, MARKDOWN_TURN_GUIDE, OUTPUT_PROMPT_LIMIT, prepareOutputRendering, withOutputGuide } from '../server/openui-policy.mjs';

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

test('the full user task has priority over the guide at both budget boundaries', () => {
  const task = '原'.repeat(OUTPUT_PROMPT_LIMIT - OPENUI_AUTO_GUIDE.length - 2);
  const fits = prepareOutputRendering(task, {outputRendering:'auto'});
  assert.equal(fits.outputRendering, 'auto'); assert.equal(withOutputGuide(task, fits).length, OUTPUT_PROMPT_LIMIT);
  const over = task + '完';
  const fallback = prepareOutputRendering(over, {outputRendering:'auto'});
  assert.equal(fallback.outputRendering, 'markdown');
  assert.ok(withOutputGuide(over, fallback).endsWith(over));
  assert.ok(withOutputGuide(over, fallback).length <= OUTPUT_PROMPT_LIMIT);
  const maximum = '用'.repeat(OUTPUT_PROMPT_LIMIT);
  assert.equal(withOutputGuide(maximum, prepareOutputRendering(maximum, {outputRendering:'auto'})), maximum);
});

test('missing optional guide falls back and inherited native guidance is explicitly disabled', () => {
  const fallback = prepareOutputRendering('原始任务', {outputRendering:'auto', guide:null, previousHasGuide:true});
  assert.equal(fallback.outputRendering, 'markdown'); assert.equal(fallback.guide, MARKDOWN_TURN_GUIDE); assert.equal(fallback.resetThread, false);
  const internal = prepareOutputRendering('只返回JSON', {previousHasGuide:true});
  assert.equal(internal.guide, MARKDOWN_TURN_GUIDE);
  const full = '整'.repeat(OUTPUT_PROMPT_LIMIT);
  const fresh = prepareOutputRendering(full, {outputRendering:'auto', previousHasGuide:true});
  assert.equal(fresh.resetThread, true); assert.equal(withOutputGuide(full, fresh), full);
});
