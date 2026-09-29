import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';

const source = await readFile(new URL('../desktop/main.cjs', import.meta.url), 'utf8');
const parsed = ts.createSourceFile('main.cjs', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const names = new Set(['isBrowserSafePort', 'listenDesktopBackend']);
const helpers = parsed.statements.filter(item => ts.isFunctionDeclaration(item) && names.has(item.name?.text));
assert.equal(helpers.length, 2);
const context = vm.createContext({});
vm.runInContext(helpers.map(item => item.getText(parsed)).join('\n'), context);
const { isBrowserSafePort, listenDesktopBackend } = context;

class ControlledServer extends EventEmitter {
  constructor(ports, failure = {}) { super(); this.ports = ports; this.failure = failure; this.calls = []; this.openPort = null; }
  listen(port, host) {
    assert.equal(port, 0); assert.equal(host, '127.0.0.1');
    assert.equal(this.openPort, null, 'a rejected listener must close before retrying');
    const next = this.ports[this.calls.filter(call => call.type === 'listen').length];
    this.calls.push({type:'listen',port:next});
    if (this.failure.synchronous) throw this.failure.synchronous;
    queueMicrotask(() => {
      if (this.failure.listen) this.emit('error', this.failure.listen);
      else { this.openPort = next; this.emit('listening'); }
    });
    return this;
  }
  address() { return this.openPort === null ? null : {address:'127.0.0.1',family:'IPv4',port:this.openPort}; }
  close(callback) {
    this.calls.push({type:'close',port:this.openPort});
    queueMicrotask(() => { if (!this.failure.close) this.openPort = null; callback(this.failure.close); });
    return this;
  }
}

test('desktop port filter rejects browser-blocked and malformed ports', () => {
  for (const port of [0, 21, 554, 2049, 5060, 6000, 6566, 6665, 6666, 6667, 6668, 6669, 6697, 10080, -1, 65536, 4318.5, NaN, Infinity, '4318', null, undefined]) {
    assert.equal(isBrowserSafePort(port), false, String(port));
  }
  for (const port of [80,443,4318,8080,49152,65535]) assert.equal(isBrowserSafePort(port), true, String(port));
});

test('desktop backend closes blocked listeners before choosing the next port', async () => {
  const server = new ControlledServer([6667,10080,54321]);
  assert.equal(await listenDesktopBackend(server), 54321);
  assert.deepEqual(server.calls, [{type:'listen',port:6667},{type:'close',port:6667},{type:'listen',port:10080},{type:'close',port:10080},{type:'listen',port:54321}]);
  assert.equal(server.openPort, 54321);
  assert.equal(server.listenerCount('error'), 0);
  assert.equal(server.listenerCount('listening'), 0);
});

test('desktop port selection exhausts a bounded number of attempts and leaves no rejected socket', async () => {
  const server = new ControlledServer(Array(20).fill(6667));
  await assert.rejects(listenDesktopBackend(server), /未能分配浏览器可访问的本机端口/);
  assert.equal(server.calls.filter(call => call.type === 'listen').length, 20);
  assert.equal(server.calls.filter(call => call.type === 'close').length, 20);
  assert.equal(server.openPort, null);
  assert.equal(server.listenerCount('error'), 0);
  assert.equal(server.listenerCount('listening'), 0);
  await assert.rejects(listenDesktopBackend(server, Infinity), /attempt limit/);
  assert.equal(server.calls.length, 40);
});

test('real listening errors propagate without retries or leaked event listeners', async () => {
  for (const type of ['listen','synchronous']) {
    const error = Object.assign(new Error('fixture address unavailable'), {code:'EADDRNOTAVAIL'});
    const server = new ControlledServer([54321], {[type]:error});
    await assert.rejects(listenDesktopBackend(server), actual => actual === error);
    assert.deepEqual(server.calls, [{type:'listen',port:54321}]);
    assert.equal(server.listenerCount('error'), 0);
    assert.equal(server.listenerCount('listening'), 0);
  }
});

test('failure to close a rejected port is surfaced before any second bind', async () => {
  const error = new Error('fixture close failure');
  const server = new ControlledServer([6667,54321], {close:error});
  await assert.rejects(listenDesktopBackend(server), actual => actual === error);
  assert.deepEqual(server.calls, [{type:'listen',port:6667},{type:'close',port:6667}]);
});

test('desktop listener serves a real Node fetch request over its selected loopback port', async t => {
  const server = createServer((request, response) => { response.setHeader('Connection','close'); response.end('desktop-ready'); });
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const port = await listenDesktopBackend(server);
  assert.equal(server.address().address, '127.0.0.1');
  const response = await fetch(`http://127.0.0.1:${port}`, {signal:AbortSignal.timeout(3000)});
  assert.equal(response.status, 200);
  assert.equal(await response.text(), 'desktop-ready');
});
