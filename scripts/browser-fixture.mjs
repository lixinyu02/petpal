// Local, explicitly labelled browser acceptance fixture. Never contacts a real model.
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdir, writeFile } from 'node:fs/promises';
import { createPetServer } from '../server/app.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const evidence = path.join(root, 'evidence');
const privateDir = path.join(evidence, 'private');
const fixtureProvider = http.createServer(async (req, res) => {
  if (req.method !== 'POST' || !['/v1/chat/completions', '/v1/responses'].includes(req.url)) {
    res.writeHead(404, { 'Content-Type': 'application/json' }); res.end('{"error":{"message":"Local fixture endpoint only"}}'); return;
  }
  let raw = '';
  try {
    for await (const chunk of req) { raw += chunk; if (raw.length > 1024 * 1024) throw new Error('Fixture body too large'); }
    const body = JSON.parse(raw);
    const messages = body.messages ?? body.input ?? [];
    const prompt = [...messages].reverse().find(item => item.role === 'user')?.content ?? '';
    const text = typeof prompt === 'string' ? prompt : JSON.stringify(prompt);
    const responses = req.url === '/v1/responses';
    if (/fixture:error|\[error\]/i.test(text)) {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: '【浏览器验收 Fixture】主动返回的上游错误，未调用真实模型。' } })); return;
    }
    const truncated = /fixture:truncate|\[truncate\]/i.test(text);
    const slow = /fixture:slow|\[slow\]|测试停止/i.test(text);
    const testing = text === 'Reply with OK only.';
    const answer = testing ? '【Fixture】OK' : truncated
      ? '【浏览器验收 Fixture】这是一段用于验证断流提示的部分回复。'
      : `【浏览器验收 Fixture · ${responses ? 'Responses' : 'Chat Completions'}】\n喵，已经收到你的消息。这是本地固定测试回复，用于检查流式呈现、历史保存和停止按钮，没有调用真实大模型。${slow ? '\n慢速测试正在继续，你可以随时点击停止按钮。'.repeat(8) : '\n两个接口都会把完成状态交给后端，再保存到当前会话。'}`;
    const chunks = answer.match(/.{1,9}|\n/gu) ?? [answer];
    const delay = testing ? 10 : slow ? 700 : 70;
    res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache', 'X-PetPal-Fixture': 'true' });
    let index = 0;
    let timer;
    const emit = () => {
      if (res.destroyed) return;
      if (index < chunks.length) {
        const text = chunks[index++];
        res.write(responses
          ? `event: response.output_text.delta\ndata: ${JSON.stringify({ type: 'response.output_text.delta', delta: text })}\n\n`
          : `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`);
        timer = setTimeout(emit, delay); return;
      }
      if (!truncated) {
        res.write(responses
          ? 'event: response.completed\ndata: {"type":"response.completed","response":{"status":"completed"}}\n\n'
          : 'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n');
      }
      res.end();
    };
    res.on('close', () => clearTimeout(timer));
    emit();
  } catch {
    if (!res.headersSent) res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end('{"error":{"message":"Invalid local fixture request"}}');
  }
});

await mkdir(privateDir, { recursive: true, mode: 0o700 });
await new Promise((resolve, reject) => { fixtureProvider.once('error', reject); fixtureProvider.listen(0, '127.0.0.1', resolve); });
const app = await createPetServer({
  token: 'petpal-browser-acceptance-only-20260926',
  dataDir: path.join(privateDir, 'browser-data'),
  staticDir: path.join(root, 'dist'),
  allowedOrigins: [],
  codex: {
    async status() { return { available: false, running: false, authenticated: false, error: '浏览器 Fixture 未连接 Codex；真实 CLI 验收独立执行。' }; },
    async run() { throw new Error('浏览器 Fixture 不执行 Codex；请使用实际桌面服务。'); },
    approve() { throw new Error('Fixture 没有实际 Codex 审批。'); },
    async close() {},
  },
});
try {
  await new Promise((resolve, reject) => { app.server.once('error', reject); app.server.listen(4319, '127.0.0.1', resolve); });
} catch (error) { await app.close(); fixtureProvider.close(); throw error; }
await writeFile(path.join(privateDir, 'browser-token.txt'), `${app.token}\n`, { mode: 0o600 });
await writeFile(path.join(evidence, 'browser-fixture.json'), `${JSON.stringify({
  kind: 'local-browser-acceptance-fixture', generatedAt: new Date().toISOString(), processId: process.pid,
  appUrl: 'http://127.0.0.1:4319', baseUrl: `http://127.0.0.1:${fixtureProvider.address().port}/v1`,
  model: 'fixture-cat', apiKeyRequired: false, protocols: ['chat-completions', 'responses'],
  instructions: 'Add a model in the UI. Pairing token is stored only in evidence/private/browser-token.txt. Replies are labelled fixtures; this does not validate a real LLM.',
  prompts: { success: '你好，测试流式回复', stop: 'fixture:slow 测试停止', error: 'fixture:error', truncated: 'fixture:truncate' },
}, null, 2)}\n`);
console.log('PetPal browser fixture ready on http://127.0.0.1:4319; non-secret metadata: evidence/browser-fixture.json');
let closing = false;
async function close() {
  if (closing) return; closing = true;
  await app.close();
  fixtureProvider.closeAllConnections(); await new Promise(resolve => fixtureProvider.close(resolve));
}
process.once('SIGINT', close); process.once('SIGTERM', close);
