// Real bundled app-server with synthetic loopback Responses; never calls an upstream model.
import assert from 'node:assert/strict';
import http from 'node:http';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { CodexBridge, resolveBundledCodex } from '../server/codex.mjs';
import { defaultCodexConfig, patchCodexConfig } from '../server/codex-config.mjs';

const frame = value => `event: ${value.type}\ndata: ${JSON.stringify(value)}\n\n`;
const present = file => stat(file).then(() => true, error => { if (error.code === 'ENOENT') return false; throw error; });

export async function verifyNativeReview({ model = 'gpt-5.4', scenario = 'allow', reasoningEffort = '', guardianFetch } = {}) {
  assert.ok(['allow', 'deny', 'malformed', 'upstream-error', 'timeout'].includes(scenario));
  assert.ok(guardianFetch === undefined || typeof guardianFetch === 'function');
  const directory = await mkdtemp(path.join(tmpdir(), 'petpal-native-review-'));
  const marker = path.join(directory, 'approved-marker.txt'), requests = [], notifications = [], fixtureErrors = [];
  const started = Date.now(); let sequence = 0, manualApprovals = 0, bridge;
  const server = http.createServer(async (req, res) => {
    try {
      assert.equal(req.method, 'POST'); assert.equal(req.url, '/v1/responses');
      assert.equal(req.headers.authorization, 'Bearer native-review-fixture-key');
      const chunks = []; for await (const chunk of req) chunks.push(chunk);
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      const guardian = body.client_metadata?.['x-openai-subagent'] === 'guardian' || Boolean(body.text?.format?.schema?.properties?.risk_level);
      const request = { model: body.model, guardian, atMs: Date.now() - started, effort: body.reasoning?.effort ?? null };
      requests.push(request);
      assert.equal(body.model, model, 'both parent and guardian must use the explicitly selected active model');
      if (guardian && guardianFetch) {
        // The caller supplies credentials in a closure, never as logged arguments.
        // No helper retry: only the native guardian's existing retry policy applies.
        const controller = new AbortController(), stop = () => controller.abort();
        req.once('aborted', stop); res.once('close', stop);
        try {
          const response = await guardianFetch(body, { signal: controller.signal });
          assert.ok(response && Number.isInteger(response.status) && response.headers && !response.redirected);
          request.responseStatus = response.status;
          res.writeHead(response.status, { 'Content-Type': response.headers.get('content-type') || 'application/octet-stream', 'Cache-Control': 'no-store' });
          if (response.body) for await (const chunk of response.body) {
            if (!res.write(chunk)) await new Promise((resolve, reject) => {
              const abort = () => { clean(); reject(new Error('Guardian stream closed')); };
              const done = () => { clean(); resolve(); };
              const clean = () => { controller.signal.removeEventListener('abort', abort); res.removeListener('drain', done); };
              controller.signal.addEventListener('abort', abort, { once: true }); res.once('drain', done);
              if (controller.signal.aborted) abort();
            });
          }
          res.end();
        } finally { req.removeListener('aborted', stop); res.removeListener('close', stop); controller.abort(); }
        return;
      }
      if (guardian && scenario === 'upstream-error') { res.writeHead(503, { 'Content-Type': 'application/json' }); res.end('{"error":{"message":"synthetic fixture failure"}}'); return; }
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store' });
      if (guardian && scenario === 'timeout') {
        res.write(': synthetic guardian heartbeat\n\n');
        const heartbeat = setInterval(() => res.write(': synthetic guardian heartbeat\n\n'), 2000);
        res.once('close', () => clearInterval(heartbeat)); return;
      }
      const id = `resp_native_review_${++sequence}`;
      const afterTool = body.input?.some(item => ['function_call_output', 'custom_tool_call_output'].includes(item.type));
      let item;
      if (guardian) {
        const text = scenario === 'malformed' ? 'synthetic malformed review output' : JSON.stringify({
          risk_level: scenario === 'allow' ? 'low' : 'high', user_authorization: 'high',
          outcome: scenario === 'allow' ? 'allow' : 'deny', rationale: 'Synthetic local fixture assessment; no real model was invoked.',
        });
        item = { type: 'message', id: `msg_${sequence}`, role: 'assistant', status: 'completed', content: [{ type: 'output_text', text, annotations: [] }] };
      } else if (afterTool) {
        item = { type: 'message', id: `msg_${sequence}`, role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: 'Native review fixture finished.', annotations: [] }] };
      } else {
        assert.ok(body.tools?.some(tool => tool.name === 'exec_command'), 'fixture requires the real native execution tool');
        const cmd = process.platform === 'win32'
          ? `[System.IO.File]::WriteAllText('${marker.replaceAll("'", "''")}', 'guardian-approved')`
          : `printf guardian-approved > '${marker.replaceAll("'", "'\\''")}'`;
        item = { type: 'function_call', id: `fc_${sequence}`, call_id: `call_${sequence}`, name: 'exec_command', status: 'completed',
          arguments: JSON.stringify({ cmd, yield_time_ms: 1000, sandbox_permissions: 'require_escalated', justification: 'Run an isolated native fixture marker command.' }) };
      }
      res.end(frame({ type: 'response.created', response: { id, object: 'response', model: body.model, status: 'in_progress', output: [] } }) +
        frame({ type: 'response.completed', response: { id, object: 'response', model: body.model, status: 'completed', output: [item], usage: { input_tokens: 10, output_tokens: 10, total_tokens: 20 } } }));
    } catch (error) {
      fixtureErrors.push(guardianFetch ? 'Guardian forwarding failed; raw upstream diagnostic withheld.' : error.message);
      if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'application/json' }); res.end('{}');
    }
  });
  try {
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    const config = patchCodexConfig(defaultCodexConfig(), { mode: 'api', model: 'fixture-unselected-default', reasoningEffort, baseUrl: `http://127.0.0.1:${server.address().port}/v1`, apiKey: 'native-review-fixture-key' });
    const command = await resolveBundledCodex(); assert.ok(command?.file);
    const version = (await promisify(execFile)(command.file, ['--version'], { windowsHide: true, timeout: 10000 })).stdout.trim();
    assert.equal(version, 'codex-cli 0.143.0', 'native fixture requires the pinned actual CLI');
    bridge = new CodexBridge({ dataDir: directory, config, command: command.file });
    const receive = bridge._message.bind(bridge);
    bridge._message = message => {
      if (['item/autoApprovalReview/started', 'item/autoApprovalReview/completed', 'guardianWarning'].includes(message.method)) notifications.push({ method: message.method, params: message.params });
      receive(message);
    };
    const status = await bridge.status(); assert.equal(status.available, true, status.error); assert.equal(requests.length, 0);
    const result = await bridge.run({ model, ...(reasoningEffort ? { effort: reasoningEffort } : {}), prompt: 'Local synthetic test: perform the fixture marker operation, then report the result.',
      permissions: { access: 'workspace-write', approval: 'review' }, signal: AbortSignal.timeout(scenario === 'timeout' || guardianFetch ? 115000 : 45000),
      onEvent(type) { if (type === 'approval') { manualApprovals++; throw new Error('Native review must not request manual approval in this fixture'); } } });
    assert.equal(result.text, 'Native review fixture finished.'); assert.equal(manualApprovals, 0);
    assert.ok(requests.some(request => request.guardian), 'a real native guardian request must reach the local fixture');
    const review = notifications.find(item => item.method === 'item/autoApprovalReview/completed')?.params?.review;
    const expected = scenario === 'allow' ? 'approved' : scenario === 'timeout' ? 'timedOut' : 'denied';
    if (guardianFetch) assert.ok(['approved', 'denied', 'timedOut'].includes(review?.status), 'real guardian must report its actual terminal decision');
    else assert.equal(review?.status, expected, 'native guardian lifecycle must finish explicitly');
    const markerExecuted = review?.status === 'approved';
    assert.equal(await present(marker), markerExecuted, 'review failures must prevent the actual native marker command');
    if (markerExecuted) assert.equal(await readFile(marker, 'utf8'), 'guardian-approved');
    assert.deepEqual(fixtureErrors, []);
    const receipt = { passed: true, codexVersion: version.slice('codex-cli '.length), scenario, selectedModel: model, defaultModel: config.model,
      parentModel: 'synthetic-local', guardianModel: guardianFetch ? 'caller-provided-upstream' : 'synthetic-local',
      requests, notifications, manualApprovals, markerExecuted, elapsedMs: Date.now() - started,
      verification: guardianFetch
        ? 'Real bundled native app-server; parent Responses are synthetic. Only guardian uses the caller-provided upstream. Actual native temporary marker executes only after the reported allow. No desktop setting or global Codex config was changed.'
        : 'Real bundled native app-server and guardian; synthetic local HTTP Responses only. Actual native marker command executes only after allow. No real upstream, desktop setting, credential or global Codex config was used.' };
    return receipt;
  } catch (error) {
    error.fixtureEvidence = { scenario, model, requests, notifications, manualApprovals, fixtureErrors, markerExists: await present(marker), elapsedMs: Date.now() - started };
    throw error;
  } finally {
    await bridge?.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
    assert.equal(path.dirname(directory), path.resolve(tmpdir())); assert.ok(path.basename(directory).startsWith('petpal-native-review-'));
    await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [scenario = 'allow', model = 'gpt-5.4', output] = process.argv.slice(2);
  try {
    const receipt = await verifyNativeReview({ model, scenario });
    if (output) await writeFile(path.resolve(output), JSON.stringify(receipt, null, 2) + '\n', { flag: 'wx' });
    console.log(JSON.stringify(receipt));
  } catch (error) { console.error(JSON.stringify({ error: error.message, ...error.fixtureEvidence })); process.exitCode = 1; }
}
