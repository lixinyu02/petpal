import { isIP } from 'node:net';
import { Agent, Dispatcher, ProxyAgent, getGlobalDispatcher, setGlobalDispatcher } from 'undici';

// Keep Chromium and Node's literal-address bypass policy aligned. No system
// proxy is changed, and Chromium's implicit loopback bypass is never removed.
export const ELECTRON_PROXY_BYPASS_RULES = [
  '<local>', 'localhost', '*.localhost', '*.local',
  '0.0.0.0/8', '10.0.0.0/8', '100.64.0.0/10', '127.0.0.0/8',
  '169.254.0.0/16', '172.16.0.0/12', '192.168.0.0/16', '198.18.0.0/15',
  '224.0.0.0/4', '240.0.0.0/4', '[::]/96', '[::1]',
  '[::ffff:0:0]/104', '[::ffff:a00:0]/104', '[::ffff:6440:0]/106',
  '[::ffff:7f00:0]/104', '[::ffff:a9fe:0]/112', '[::ffff:ac10:0]/108',
  '[::ffff:c0a8:0]/112', '[::ffff:c612:0]/111', '[::ffff:e000:0]/100', '[::ffff:f000:0]/100',
  '[fc00::]/7', '[fe80::]/10', '[fec0::]/10', '[ff00::]/8',
].join(';');

const failure = (code, message) => Object.assign(new Error(message), { code });
const stopped = () => failure('PETPAL_PROXY_STOPPED', '小伴代理已停用，本次请求已结束；请按需重新提交。');
const invalid = () => failure('PETPAL_PROXY_ADDRESS', '小伴代理必须使用受保护的本机回环地址。');

function ipv4Number(host) {
  return host.split('.').reduce((number, part) => (number << 8n) | BigInt(part), 0n);
}
function ipv4Private(number) {
  return [[0x00000000n, 8n], [0x0a000000n, 8n], [0x64400000n, 10n],
    [0x7f000000n, 8n], [0xa9fe0000n, 16n], [0xac100000n, 12n],
    [0xc0a80000n, 16n], [0xc6120000n, 15n], [0xe0000000n, 4n], [0xf0000000n, 4n]]
    .some(([base, bits]) => number >> (32n - bits) === base >> (32n - bits));
}
function ipv6Number(host) {
  let value = host;
  if (value.includes('.')) {
    const split = value.lastIndexOf(':'), ipv4 = ipv4Number(value.slice(split + 1));
    value = `${value.slice(0, split)}:${(ipv4 >> 16n).toString(16)}:${(ipv4 & 65535n).toString(16)}`;
  }
  const halves = value.split('::'), left = halves[0] ? halves[0].split(':') : [], right = halves[1] ? halves[1].split(':') : [];
  const groups = halves.length === 2 ? [...left, ...Array(8 - left.length - right.length).fill('0'), ...right] : left;
  return groups.reduce((number, part) => (number << 16n) | BigInt(`0x${part || '0'}`), 0n);
}

/** Pure URL policy: no DNS lookup, configuration reads, or network request. */
export function isProxyBypassURL(input) {
  let url;
  try { url = input instanceof URL ? input : new URL(input); } catch { return true; }
  if (!['http:', 'https:', 'ws:', 'wss:'].includes(url.protocol)) return true;
  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase().replace(/\.$/, '');
  if (!host || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) return true;
  const family = isIP(host);
  if (family === 4) return ipv4Private(ipv4Number(host));
  if (family === 6) {
    const number = ipv6Number(host);
    if (number >> 32n === 0n || number >> 120n === 255n || number >> 121n === 126n ||
        number >> 118n === 1018n || number >> 118n === 1019n) return true;
    // IPv4-mapped literals must not route a private IPv4 address through a proxy.
    if (number >> 32n === 65535n) return ipv4Private(number & 0xffffffffn);
    return false;
  }
  return !host.includes('.');
}

function proxyAddress(input) {
  if (typeof input !== 'string' || input.length > 1024) throw invalid();
  let url;
  try { url = new URL(input); } catch { throw invalid(); }
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !url.port ||
      url.pathname !== '/' || url.search || url.hash || !/^[A-Za-z0-9_-]{1,128}$/.test(url.username) ||
      !/^[A-Za-z0-9_-]{16,256}$/.test(url.password)) throw invalid();
  return url;
}

/** Chromium auth is provided by the main-process login handler, never rules. */
export function electronProxyConfiguration(input) {
  if (input === undefined || input === null) return { mode: 'direct' };
  const url = proxyAddress(typeof input === 'object' ? input.url : input);
  return { mode: 'fixed_servers', proxyRules: `http=${url.host};https=${url.host}`, proxyBypassRules: ELECTRON_PROXY_BYPASS_RULES };
}

function safeProxyError(error) {
  if (error?.code === 'PETPAL_PROXY_STOPPED') return stopped();
  if (error?.name === 'AbortError' || error?.code === 'UND_ERR_ABORTED')
    return Object.assign(failure('UND_ERR_ABORTED', '小伴代理请求已取消。'), { name: 'AbortError' });
  return failure('PETPAL_PROXY_REQUEST_FAILED', '小伴代理连接失败，请检查代理配置或网络。');
}
function protectedHandler(handler, state, finish) {
  // Preserve handler receiver identity (including Undici's private fields),
  // while ensuring proxy exceptions cannot disclose its authenticated URI.
  return new Proxy(handler, { get(target, key) {
    if (key === 'onError') return error => { finish(); return target.onError(state.cancelling ? stopped() : safeProxyError(error)); };
    if (key === 'onComplete' || key === 'onUpgrade') return (...args) => { finish(); return target[key]?.(...args); };
    const value = Reflect.get(target, key, target);
    return typeof value === 'function' ? value.bind(target) : value;
  } });
}

/**
 * Stable process-local dispatcher. forceProxy is dependency injection for local
 * CONNECT fixtures only; no renderer or persisted setting can change the policy.
 */
export function createAppProxyNetwork({ applyProxy = async () => {}, forceProxy,
  getDispatcher = getGlobalDispatcher, setDispatcher = setGlobalDispatcher } = {}) {
  if (typeof applyProxy !== 'function' || forceProxy !== undefined && typeof forceProxy !== 'function' ||
      typeof getDispatcher !== 'function' || typeof setDispatcher !== 'function') throw invalid();
  const direct = new Agent(), proxies = new Set();
  let original, active = null, installed = false, closed = false, transition = Promise.resolve();
  const serialize = operation => {
    const pending = transition.then(operation); transition = pending.catch(() => {}); return pending;
  };
  const retire = async (state, cancelActive) => {
    if (!state) return;
    if (state.disposal) return state.disposal;
    if (!cancelActive && state.requests.size) await new Promise(resolve => state.idle.add(resolve));
    if (state.disposal) return state.disposal;
    state.cancelling = cancelActive;
    // Waiting for idle ourselves keeps a later forced close possible. Undici 6
    // cannot reliably interrupt ProxyAgent.close() with a concurrent destroy().
    state.disposal = (cancelActive ? state.agent.destroy(stopped()) : state.agent.close())
      .finally(() => { proxies.delete(state); for (const resolve of state.idle) resolve(); state.idle.clear(); });
    return state.disposal;
  };
  class Router extends Dispatcher {
    dispatch(options, handler) {
      if (closed) { queueMicrotask(() => handler.onError(stopped())); return false; }
      if (!active) return original.dispatch(options, handler);
      let target;
      try { target = new URL(options.origin); } catch { queueMicrotask(() => handler.onError(invalid())); return false; }
      const useProxy = forceProxy ? forceProxy(target) : !isProxyBypassURL(target);
      if (!useProxy) return direct.dispatch(options, handler);
      const state = active, request = {};
      state.requests.add(request);
      const finish = () => {
        state.requests.delete(request);
        if (!state.requests.size) { for (const resolve of state.idle) resolve(); state.idle.clear(); }
      };
      try { return state.agent.dispatch(options, protectedHandler(handler, state, finish)); }
      catch (error) { finish(); throw safeProxyError(error); }
    }
    close(callback) { const promise = close({ cancelActive: false }); if (callback) { promise.then(() => callback(null), callback); return; } return promise; }
    destroy(_error, callback) { if (typeof _error === 'function') callback = _error; const promise = close(); if (callback) { promise.then(() => callback(null), callback); return; } return promise; }
  }
  const router = new Router();
  function install() {
    if (closed) throw stopped();
    if (!installed) { original = getDispatcher(); setDispatcher(router); installed = true; }
    return status();
  }
  function status() { return { installed, enabled: Boolean(active), closed }; }
  function enable({ url, cancelActive = true } = {}) {
    let address;
    try { address = proxyAddress(url); } catch { return Promise.reject(invalid()); }
    if (typeof cancelActive !== 'boolean') return Promise.reject(invalid());
    return serialize(async () => {
      if (closed) throw stopped();
      install();
      const candidate = { requests: new Set(), idle: new Set(), disposal: null, cancelling: false,
        agent: new ProxyAgent({ uri: address.origin,
          token: `Basic ${Buffer.from(`${address.username}:${address.password}`).toString('base64')}` }) };
      proxies.add(candidate);
      try { await applyProxy(electronProxyConfiguration(url)); }
      catch { await retire(candidate, true); throw failure('PETPAL_PROXY_APPLY_FAILED', '无法应用小伴代理设置。'); }
      const previous = active; active = candidate;
      return { retirement: retire(previous, cancelActive), result: status() };
    }).then(async ({ retirement, result }) => { await retirement; return result; });
  }
  function disable({ cancelActive = true } = {}) {
    if (typeof cancelActive !== 'boolean') return Promise.reject(invalid());
    return serialize(async () => {
      if (closed) return { result: status() };
      try { await applyProxy(electronProxyConfiguration()); }
      catch { throw failure('PETPAL_PROXY_APPLY_FAILED', '无法停用小伴代理设置。'); }
      const previous = active; active = null;
      // Do not hold the transition queue while draining. A subsequent close
      // can still cancel a stalled stream rather than waiting indefinitely.
      return { retirement: retire(previous, cancelActive), result: status() };
    }).then(async ({ retirement, result }) => { await retirement; return result; });
  }
  function close({ cancelActive = true } = {}) {
    if (typeof cancelActive !== 'boolean') return Promise.reject(invalid());
    return serialize(async () => {
      if (closed) return;
      closed = true; active = null;
      if (installed && getDispatcher() === router) setDispatcher(original);
      installed = false;
      try { await applyProxy(electronProxyConfiguration()); } catch { /* App shutdown must still release owned sockets. */ }
      await Promise.allSettled([...proxies].map(agent => retire(agent, cancelActive)));
      if (cancelActive) await direct.destroy(stopped()); else await direct.close();
    });
  }
  return Object.freeze({ install, enable, disable, close, status });
}
