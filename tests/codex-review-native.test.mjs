import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyNativeReview } from '../scripts/codex-review-native.mjs';

for (const [model, scenario] of [['gpt-5.4', 'allow'], ['qwen3.8flash', 'allow'], ['qwen3.8flash', 'deny'], ['gpt-5.4', 'malformed'], ['qwen3.8flash', 'upstream-error']]) {
  test(`native guardian uses selected ${model} and ${scenario} is enforced before execution`, { timeout: 60000 }, async () => {
    const result = await verifyNativeReview({ model, scenario });
    assert.equal(result.passed, true); assert.equal(result.markerExecuted, scenario === 'allow');
    assert.equal(result.manualApprovals, 0); assert.ok(result.requests.some(request => request.guardian));
    assert.ok(result.requests.every(request => request.model === model));
  });
}

test('caller-provided guardian forwarding receives only guardian requests and keeps credentials out of receipts', { timeout: 60000 }, async () => {
  let calls = 0;
  const credential = 'closure-only-fixture-credential';
  const result = await verifyNativeReview({ model: 'gpt-6-luna', reasoningEffort: 'max', guardianFetch: async (body, { signal }) => {
    signal.throwIfAborted(); calls++;
    assert.equal(body.client_metadata?.['x-openai-subagent'], 'guardian'); assert.equal(body.model, 'gpt-6-luna');
    assert.ok(credential); // Only a real caller's closure uses its credentials for fetch.
    const item = { id: 'caller_msg', type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', annotations: [],
      text: JSON.stringify({ risk_level: 'low', user_authorization: 'high', outcome: 'allow', rationale: 'Local callback fixture only.' }) }] };
    const response = { id: 'caller_resp', object: 'response', model: body.model, status: 'completed', output: [item] };
    return new Response(`event: response.created\ndata: ${JSON.stringify({ type: 'response.created', response: { ...response, status: 'in_progress', output: [] } })}\n\n` +
      `event: response.completed\ndata: ${JSON.stringify({ type: 'response.completed', response })}\n\n`, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
  } });
  assert.equal(calls, 1); assert.equal(result.parentModel, 'synthetic-local'); assert.equal(result.guardianModel, 'caller-provided-upstream');
  assert.equal(result.markerExecuted, true); assert.equal(result.requests.filter(request => request.guardian)[0].responseStatus, 200);
  assert.ok(result.requests.filter(request => !request.guardian).every(request => request.effort === 'max'));
  assert.ok(!JSON.stringify(result).includes(credential));
});

for (const [model, reviewerModel, scenario, reviewReasoningEffort] of [['gpt-5.4', 'qwen3.8flash', 'allow', ''], ['qwen3.8flash', 'gpt-5.4', 'allow', 'low'], ['gpt-5.4', 'qwen3.8flash', 'deny', '']]) {
  test(`native ${model} independently routes guardian to ${reviewerModel} with ${scenario}`, { timeout: 60000 }, async () => {
    const result = await verifyNativeReview({ model, reviewerModel, scenario, reviewReasoningEffort, reasoningEffort: 'max' });
    assert.equal(result.passed, true); assert.equal(result.markerExecuted, scenario === 'allow'); assert.equal(result.manualApprovals, 0);
    const parents = result.requests.filter(request => !request.guardian), reviews = result.requests.filter(request => request.guardian);
    assert.ok(parents.length >= 2); assert.ok(reviews.length >= 1);
    assert.ok(parents.every(request => request.model === model && request.route === 'agent' && request.effort === 'max'));
    assert.ok(reviews.every(request => request.model === reviewerModel && request.route === 'review' && request.effort === (reviewReasoningEffort || null)));
    assert.doesNotMatch(JSON.stringify(result), /native-independent-review-fixture-key|127\.0\.0\.1|\/review\/responses/);
  });
}

test('native guardian 90-second deadline fails closed while SSE remains alive', { timeout: 125000, skip: process.env.PETPAL_TEST_GUARDIAN_TIMEOUT !== '1' }, async () => {
  const result = await verifyNativeReview({ model: 'qwen3.8flash', scenario: 'timeout' });
  assert.equal(result.passed, true); assert.equal(result.markerExecuted, false);
  assert.ok(result.elapsedMs >= 85000 && result.elapsedMs < 115000);
});
