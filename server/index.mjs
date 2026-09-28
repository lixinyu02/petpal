import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPetServer } from './app.mjs';

export async function main() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const host = process.env.PETPAL_HOST || '127.0.0.1';
  const port = Number(process.env.PETPAL_PORT || 4318);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('PETPAL_PORT 必须为 0 到 65535 的整数。');
  const app = await createPetServer({
    dataDir: process.env.PETPAL_DATA_DIR || path.join(root, '.data'),
    staticDir: path.join(root, 'dist'),
    workspaceRoot: path.resolve(process.env.PETPAL_WORKSPACE || root),
    allowedOrigins: (process.env.PETPAL_ALLOWED_ORIGINS || '').split(',').map(value => value.trim()).filter(Boolean),
  });
  await new Promise((resolve, reject) => { app.server.once('error', reject); app.server.listen(port, host, resolve); });
  const address = app.server.address();
  const displayHost = ['0.0.0.0', '::'].includes(host) ? '127.0.0.1' : host.includes(':') ? `[${host}]` : host;
  const url = `http://${displayHost}:${address.port}`;
  console.log(`小伴 PetPal 已启动：${url}`);
  console.log(`仅在自己的设备打开此配对链接（包含访问令牌）：${url}/#token=${encodeURIComponent(app.token)}`);
  if (host !== '127.0.0.1' && host !== 'localhost' && host !== '::1') console.log('网络监听已启用。跨设备请通过可信 HTTPS 反向代理连接，并配置 PETPAL_ALLOWED_ORIGINS。');
  let exiting = false;
  const shutdown = async () => { if (exiting) return; exiting = true; await app.close(); };
  process.once('SIGINT', shutdown); process.once('SIGTERM', shutdown);
  return app;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(`启动失败：${error.message}`); process.exitCode = 1; });
}
