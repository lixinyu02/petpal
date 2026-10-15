import { HttpsProxyAgent } from 'https-proxy-agent';
import { createAppProxyNetwork, electronProxyConfiguration, isProxyBypassURL } from './app-proxy-network.mjs';

export const APP_PROXY_WORKER_VARIABLE = 'PETPAL_PRIVATE_APP_PROXY';
export const APP_PROXY_NO_PROXY = [
  'localhost', '.localhost', '.local', '127.0.0.1', '::1', '[::1]',
  '0.0.0.0/8', '10.0.0.0/8', '100.64.0.0/10', '127.0.0.0/8',
  '169.254.0.0/16', '172.16.0.0/12', '192.168.0.0/16', '198.18.0.0/15',
  '224.0.0.0/4', '240.0.0.0/4', '::/96', 'fc00::/7', 'fe80::/10', 'fec0::/10', 'ff00::/8',
].join(',');

let runtime = null;
const invalid = () => Object.assign(new Error('本应用代理上下文无效。'), { code: 'PETPAL_PROXY_CONTEXT_INVALID' });
function validatedAddress(value) {
  try { electronProxyConfiguration(value); return new URL(value).href; } catch { throw invalid(); }
}

/** Main-process runtime only. Never inherit host proxy variables or persist it. */
export function setAppProxyRuntime(url) {
  if (url !== null && typeof url !== 'string') throw invalid();
  runtime = url === null ? null : validatedAddress(url);
}

/** Only the local core's ephemeral credentials can enter isolated child envs. */
export function getAppProxyEnvironment() {
  if (!runtime) return {};
  return {
    HTTP_PROXY: runtime, HTTPS_PROXY: runtime, ALL_PROXY: runtime,
    http_proxy: runtime, https_proxy: runtime, all_proxy: runtime,
    NO_PROXY: APP_PROXY_NO_PROXY, no_proxy: APP_PROXY_NO_PROXY,
    [APP_PROXY_WORKER_VARIABLE]: runtime,
  };
}

/** Independent Node workers do not honor HTTP_PROXY through fetch by default. */
export async function configureAppProxyWorker(environment = process.env) {
  if (!environment || !Object.hasOwn(environment, APP_PROXY_WORKER_VARIABLE)) return null;
  const url = validatedAddress(environment[APP_PROXY_WORKER_VARIABLE]);
  const network = createAppProxyNetwork();
  try { network.install(); await network.enable({ url }); return network; }
  catch { await network.close().catch(() => {}); throw invalid(); }
}

/** Each ASR session owns and releases its agent; local voice traffic is direct. */
export function createAppProxyWebSocketAgent(target) {
  if (!runtime || isProxyBypassURL(target)) return undefined;
  return new HttpsProxyAgent(runtime);
}
