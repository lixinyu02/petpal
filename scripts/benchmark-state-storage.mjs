import fs from 'node:fs';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { JsonStore } from '../server/store.mjs';

// Isolated synthetic data only. No live configuration or histories are read.
const repetitions = 3, calls = 32;
const directory = await mkdtemp(path.join(tmpdir(), 'petpal-storage-benchmark-'));
const originalRename = fs.promises.rename;
let writes = 0;
fs.promises.rename = async (...args) => {
  const result = await originalRename(...args);
  if (path.dirname(args[1]) === directory) writes++;
  return result;
};
syncBuiltinESMExports();
try {
  const store = await new JsonStore(directory).init();
  const makeConversation = index => ({ id: randomUUID(), userId: store.state.ownerId, mode: 'chat', title: `Synthetic ${index}`, providerId: null, messages: [{ id: randomUUID(), role: 'user', content: 'Synthetic benchmark content. '.repeat(4), status: 'complete', createdAt: '2026-01-01T00:00:00.000Z' }], createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', projectId: null, archivedAt: null });
  store.state.conversations = Array.from({ length: 1200 }, (_, index) => makeConversation(index));
  await store.save();
  const results = [];
  for (let repetition = 0; repetition < repetitions; repetition++) {
    for (const scenario of ['unchanged-sequential', 'unchanged-burst', 'changing-burst']) {
      const beforeWrites = writes, cpu = process.cpuUsage(), started = performance.now(), tasks = [];
      for (let index = 0; index < calls; index++) {
        if (scenario === 'changing-burst') store.state.benchmarkRevision = repetition * calls + index;
        const task = store.save();
        if (scenario === 'unchanged-sequential') await task;
        else tasks.push(task);
      }
      await Promise.all(tasks);
      const used = process.cpuUsage(cpu);
      results.push({ repetition: repetition + 1, scenario, calls, elapsedMs: Math.round(performance.now() - started), cpuMs: Math.round((used.user + used.system) / 1000), physicalWrites: writes - beforeWrites });
    }
  }
  const disk = JSON.parse(await readFile(store.file, 'utf8'));
  if (disk.benchmarkRevision !== repetitions * calls - 1 || disk.conversations.length !== 1200) throw new Error('Synthetic persisted result mismatch.');
  console.log(JSON.stringify({ synthetic: true, repetitions, conversations: disk.conversations.length, fileBytes: (await stat(store.file)).size, results }, null, 2));
} finally {
  fs.promises.rename = originalRename;
  syncBuiltinESMExports();
  const resolved = path.resolve(directory), temporaryRoot = `${path.resolve(tmpdir())}${path.sep}`;
  if (!resolved.startsWith(temporaryRoot) || !path.basename(resolved).startsWith('petpal-storage-benchmark-')) throw new Error('Unexpected temporary directory.');
  await rm(resolved, { recursive: true });
}
