import readline from 'node:readline';
import { appendFileSync } from 'node:fs';

const args = process.argv.slice(2), player = args[args.indexOf('--player') + 1], eventFile = args[args.indexOf('--events') + 1];
const mode = args[args.indexOf('--mode') + 1];
const input = readline.createInterface({ input: process.stdin });
const log = message => appendFileSync(eventFile, `${JSON.stringify(message)}\n`);
const reply = (id, result) => process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id, result })}\n`);
const text = value => ({ content: [{ type: 'text', text: value }] });
const schema = (properties = {}, required = []) => ({ type: 'object', properties, required });
const tool = (name, inputSchema) => ({ name, description: `Fixture ${name}`, inputSchema });
const tools = player === 'netease' ? [
  tool('get_netease_status', schema()),
  tool('search_music', schema({ query: { type: 'string', minLength: 1 }, kind: { type: 'string', enum: ['song', 'playlist'] }, limit: { type: 'integer', minimum: 1, maximum: 10 } }, ['query'])),
  tool('set_netease_volume', schema({ percent: { type: 'integer', minimum: 0, maximum: 100 } }, ['percent'])),
  tool('control_netease', schema({ action: { type: 'string' } }, ['action'])), tool('send_netease_shortcut', schema()), tool('run_shell', schema()),
] : [
  tool('search', schema({ keyword: { type: 'string', minLength: 1 }, size: { type: 'integer', minimum: 1, maximum: 50 } }, ['keyword'])),
  tool('url', schema({ mid: { type: 'string', minLength: 1 }, quality: { type: 'string', enum: ['standard', 'high', 'lossless'] } }, ['mid'])),
  tool('detail', schema({ type: { type: 'string' }, id: { type: 'string' } }, ['type', 'id'])), tool('run_shell', schema()),
];

input.on('line', line => {
  const message = JSON.parse(line); log(message);
  if (message.method === 'initialize') {
    if (mode === 'initialize-hang') return;
    reply(message.id, { protocolVersion: message.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: 'music-stdio-fixture', version: '1.0' } });
  } else if (message.method === 'tools/list') {
    reply(message.id, { tools: mode === 'bad-schema' ? [tool('search', { type: 'object', properties: { keyword: { type: 'invalid' } } })] : tools });
  } else if (message.method === 'tools/call') {
    const value = message.params.arguments.keyword || message.params.arguments.query || message.params.arguments.mid;
    if (value === 'hang') return;
    if (value === 'die') { process.stderr.write('OPENAI_API_KEY=secret-from-stderr\n'); process.exit(8); }
    if (value === 'large') { reply(message.id, text('x'.repeat(300000))); return; }
    if (value === 'stderr-large') { process.stderr.write('x'.repeat(300000)); return; }
    if (value === 'error') { reply(message.id, text('错误: RuntimeError: 未登录')); return; }
    if (value === 'protocol-error') { reply(message.id, { ...text('request failed'), isError: true }); return; }
    if (value === 'structured-error') { reply(message.id, { ...text('{"success":false}'), structuredContent: { success: false } }); return; }
    if (message.params.name === 'url') { reply(message.id, text('播放链接：https://stream.example.test/song.mp3?token=public-stream')); return; }
    reply(message.id, { ...text(JSON.stringify({ success: true, value: value || null })), structuredContent: { success: true } });
  }
});
input.on('close', () => process.exit(0));
