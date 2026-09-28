import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { CodexBridge } from '../server/codex.mjs';

const workspaceRoot = await mkdtemp(path.join(tmpdir(), 'petpal-codex-smoke-'));
const bridge = new CodexBridge({ workspaceRoot, command: process.env.PETPAL_CODEX_COMMAND || undefined });
try {
  const status = await bridge.status();
  console.log(JSON.stringify({ ...status, workspaceRoot: '[isolated temporary workspace]',
    verification: 'Real app-server initialize + initialized + account/read; no model request, no credential output' }, null, 2));
  if (!status.available) process.exitCode = 1;
} finally {
  await bridge.close();
  await rm(workspaceRoot, { recursive: true, force: true });
}
