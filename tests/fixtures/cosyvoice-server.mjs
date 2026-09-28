// Loopback-only browser acceptance fixture. Returns a supplied synthetic WAV;
// this does not load CosyVoice, run a GPU model, or prove real synthesis.
import http from 'node:http';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { validatePcmWav, REFERENCE_LIMIT } from '../../server/cosyvoice.mjs';

const args = process.argv.slice(2), options = {};
for (let i = 0; i < args.length; i += 2) {
  if (!['--wav', '--port'].includes(args[i]) || !args[i + 1] || Object.hasOwn(options, args[i])) throw new Error('Usage: node tests/fixtures/cosyvoice-server.mjs --wav <synthetic.wav> [--port 0]');
  options[args[i]] = args[i + 1];
}
if (!options['--wav']) throw new Error('An explicitly selected synthetic WAV is required.');
const audio = await readFile(options['--wav']);
const audioFormat = validatePcmWav(audio);
let pcm;
for (let offset = 12; offset < audio.length;) {
  const size = audio.readUInt32LE(offset + 4), start = offset + 8;
  if (audio.toString('ascii', offset, offset + 4) === 'data') pcm = audio.subarray(start, start + size);
  offset = start + size + size % 2;
}
const port = Number(options['--port'] ?? 0); if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Invalid fixture port.');
const jobs = new Map(), cache = '/tmp/gradio/' + 'a'.repeat(64);
const json = (res, value, status = 200) => { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(value)); };
const server = http.createServer(async (req, res) => {
  try {
    let body = Buffer.alloc(0);
    for await (const chunk of req) { if (body.length + chunk.length > REFERENCE_LIMIT + 65536) { json(res, { error: 'Fixture input too large' }, 413); return; } body = Buffer.concat([body, chunk]); }
    if (req.method === 'POST' && req.url === '/api/tts/stream') {
      const form = await new Request('http://127.0.0.1/api/tts/stream', { method: 'POST', headers: { 'Content-Type': req.headers['content-type'] || '' }, body }).formData();
      if (form.get('mode') !== 'zero_shot' || !form.get('tts_text')?.trim() || !form.get('prompt_text')?.trim() || !(form.get('prompt_wav') instanceof Blob) || form.get('seed') !== '0') { json(res, { error: 'Invalid PCM fixture request' }, 422); return; }
      validatePcmWav(Buffer.from(await form.get('prompt_wav').arrayBuffer()), { reference: true });
      if (audioFormat.sampleRate !== 24000 || audioFormat.channels !== 1 || audioFormat.bits !== 16) { json(res, { error: 'Streaming fixture requires PCM16 / 24 kHz / mono WAV input' }, 422); return; }
      res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'X-Audio-Format': 'pcm_s16le', 'X-Audio-Sample-Rate': '24000', 'X-Audio-Channels': '1', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no' });
      res.flushHeaders();
      // Deliberately odd, paced chunks exercise byte carry and progressive
      // playback. These are supplied synthetic samples, never GPU inference.
      for (let offset = 0; offset < pcm.length; offset += 9601) {
        if (res.destroyed) return;
        if (!res.write(pcm.subarray(offset, offset + 9601))) await new Promise(resolve => {
          const done = () => { res.off('drain', done); res.off('close', done); resolve(); };
          res.once('drain', done); res.once('close', done);
        });
        if (offset + 9601 < pcm.length) await new Promise(resolve => setTimeout(resolve, 30));
      }
      if (!res.destroyed) res.end(); return;
    }
    if (req.method === 'POST' && req.url === '/gradio_api/upload') { json(res, [`${cache}/reference.wav`]); return; }
    if (req.method === 'POST' && req.url === '/gradio_api/call/generate_audio') {
      const value = JSON.parse(body.toString());
      if (Object.hasOwn(value, 'session_hash') || !Array.isArray(value.data) || value.data.length !== 10 || value.data[1] !== '3s极速复刻' || value.data[8] !== false) { json(res, { error: 'Invalid fixture request' }, 400); return; }
      const id = randomBytes(16).toString('hex'); jobs.set(id, id); json(res, { event_id: id }); return;
    }
    if (req.method === 'GET' && req.url.startsWith('/gradio_api/call/generate_audio/')) {
      const session = jobs.get(req.url.split('/').at(-1)); if (!session) { json(res, {}, 404); return; }
      const streamPath = `${session}/1/21/playlist.m3u8`;
      const data = [{ path: streamPath, url: `http://127.0.0.1:${server.address().port}/gradio_api/stream/${streamPath}`, is_stream: true, orig_name: 'audio-stream.mp3', meta: { _type: 'gradio.FileData' } }];
      res.writeHead(200, { 'Content-Type': 'text/event-stream' }); res.end(`event: generating\ndata: ${JSON.stringify(data)}\n\nevent: complete\ndata: ${JSON.stringify(data)}\n\n`); return;
    }
    const stream = /^\/gradio_api\/stream\/([a-f0-9]{32})\/1\/21\/playlist-file$/.exec(req.url);
    if (req.method === 'GET' && stream && [...jobs.values()].includes(stream[1])) { res.writeHead(200, { 'Content-Type': 'audio/wav', 'Content-Length': audio.length, 'Cache-Control': 'no-store' }); res.end(audio); return; }
    json(res, { error: 'Fixture route not found' }, 404);
  } catch { if (!res.headersSent) json(res, { error: 'Fixture request failed' }, 400); else res.end(); }
});
server.requestTimeout = 30000; server.headersTimeout = 15000;
await new Promise(resolve => server.listen(port, '127.0.0.1', resolve));
console.log(JSON.stringify({ fixture: true, gpuSynthesis: false, baseUrl: `http://127.0.0.1:${server.address().port}`, audioBytes: audio.length }));
const close = () => { server.close(); server.closeAllConnections(); };
process.once('SIGINT', close); process.once('SIGTERM', close);
