import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { listenFixture } from './helpers/loopback.mjs';

test('HTTP fixtures retry the additional Fetch-restricted ports 4190 and 6679', async () => {
  const server = new EventEmitter();
  const ports = [4190, 6679, 4539];
  const attempts = [];
  let port;
  let closes = 0;
  server.listen = (requestedPort, hostname) => {
    assert.equal(requestedPort, 0);
    assert.equal(hostname, '127.0.0.1');
    port = ports.shift();
    assert.ok(port, 'fixture exhausted the expected port sequence');
    attempts.push(port);
    queueMicrotask(() => server.emit('listening'));
  };
  server.address = () => ({ port });
  server.close = callback => { closes++; queueMicrotask(callback); };
  await listenFixture(server);
  assert.deepEqual(attempts, [4190, 6679, 4539]);
  assert.equal(port, 4539);
  assert.equal(closes, 2);
  assert.equal(server.listenerCount('error'), 0);
  assert.equal(server.listenerCount('listening'), 0);
});
