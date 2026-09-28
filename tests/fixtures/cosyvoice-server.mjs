// Loopback-only browser acceptance fixture. Returns a supplied synthetic WAV;
// this does not load CosyVoice, run a GPU model, or prove real synthesis.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { validatePcmWav, REFERENCE_LIMIT } from '../../server/cosyvoice.mjs';

const args = process.argv.slice(2), options = {};
for (let i = 0; i < args.length; i += 2) {
  if (!['--wav', '--port'].includes(args[i]) || !args[i + 1] || Object.hasOwn(options, args[i])) throw new Error('Usage: node tests/fixtures/cosyvoice-server.mjs --wav <synthetic.wav> [--port 0]');
  options[args[i]] = args[i + 1];
}
if (!options['--wav']) throw new Error('An explicitly selected synthetic WAV is required.');
const audio = await readFile(options['--wav']); validatePcmWav(audio);
const port = Number(options['--port'] ?? 0); if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Invalid fixture port.');
const jobs = new Map(), cache = '/tmp/gradio/' + 'a'.repeat(64);
const json = (res, value, status = 200) => { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(value)); };
const server = http.createServer(async (req, res) => {
  try {
    let body = Buffer.alloc(0);
    for await (const chunk of req) { if (body.length + chunk.length > REFERENCE_LIMIT + 65536) { json(res, { error: 'Fixture input too large' }, 413); return; } body = Buffer.concat([body, chunk]); }
    if (req.method === 'POST' && req.url === '/gradio_api/upload') { json(res, [`${cache}/reference.wav`]); return; }
    if (req.method === 'POST' && req.url === '/gradio_api/call/generate_audio') {
      const value = JSON.parse(body.toString());
      if (!/^[a-f0-9-]{36}$/.test(value.session_hash) || !Array.isArray(value.data) || value.data.length !== 10 || value.data[1] !== '3s极速复刻' || value.data[8] !== false) { json(res, { error: 'Invalid fixture request' }, 400); return; }
      const id = `job-${jobs.size + 1}`; jobs.set(id, value.session_hash); json(res, { event_id: id }); return;
    }
    if (req.method === 'GET' && req.url.startsWith('/gradio_api/call/generate_audio/')) {
      const session = jobs.get(req.url.split('/').at(-1)); if (!session) { json(res, {}, 404); return; }
      const streamPath = `${session}/1/21/playlist.m3u8`;
      const data = [{ path: streamPath, url: `http://127.0.0.1:${server.address().port}/gradio_api/stream/${streamPath}`, is_stream: true, orig_name: 'audio-stream.mp3', meta: { _type: 'gradio.FileData' } }];
      res.writeHead(200, { 'Content-Type': 'text/event-stream' }); res.end(`event: generating\ndata: ${JSON.stringify(data)}\n\nevent: complete\ndata: ${JSON.stringify(data)}\n\n`); return;
    }
    const stream = /^\/gradio_api\/stream\/([a-f0-9-]{36})\/1\/21\/playlist-file$/.exec(req.url);
    if (req.method === 'GET' && stream && [...jobs.values()].includes(stream[1])) { res.writeHead(200, { 'Content-Type': 'audio/wav', 'Content-Length': audio.length, 'Cache-Control': 'no-store' }); res.end(audio); return; }
    json(res, { error: 'Fixture route not found' }, 404);
  } catch { if (!res.headersSent) json(res, { error: 'Fixture request failed' }, 400); else res.end(); }
});
server.requestTimeout = 30000; server.headersTimeout = 15000;
await new Promise(resolve => server.listen(port, '127.0.0.1', resolve));
console.log(JSON.stringify({ fixture: true, gpuSynthesis: false, baseUrl: `http://127.0.0.1:${server.address().port}`, audioBytes: audio.length }));
const close = () => { server.close(); server.closeAllConnections(); };
process.once('SIGINT', close); process.once('SIGTERM', close);
