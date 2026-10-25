const fail = (message, code = 'cloud_platform_metadata_invalid', status = 409) => Object.assign(new Error(message), {status, code});
const flags = ['pidsConfigured','pidsVerifiedAtCreate','persistentStorage','graphical','gpu','publishedPorts'];
const plain = value => value && typeof value === 'object' && !Array.isArray(value);
export function cloudResources(value = {}) {
  if (!plain(value) || Object.keys(value).some(k => !['cpus','memoryMiB','pids'].includes(k))) throw fail('资源配置无效。','cloud_platform_resources_invalid',400);
  const {cpus = 2, memoryMiB = 4096, pids} = value;
  if (typeof cpus !== 'number' || !Number.isFinite(cpus) || cpus < .1 || cpus > 128 || !Number.isSafeInteger(memoryMiB) || memoryMiB < 256 || memoryMiB > 1048576 || pids !== undefined && (!Number.isSafeInteger(pids) || pids < 32 || pids > 8192)) throw fail('CPU、内存或进程限制超出支持范围。','cloud_platform_resources_invalid',400);
  return {cpus,memoryMiB,...(pids === undefined ? {} : {pids})};
}
export function platformNode(host) {
  const runtimeKind = host.runtimeKind ?? 'docker';
  if (!['docker','kubernetes'].includes(runtimeKind)) throw fail('执行平台返回了不支持的运行时类型。');
  const node = {id:host.id,name:String(host.name ?? '执行节点').slice(0,120),runtimeKind,available:host.status === 'online',templates:(Array.isArray(host.templates) ? host.templates : []).slice(0,32).filter(t => typeof t === 'string' || t?.available !== false).map(t => typeof t === 'string' ? {id:t,available:true} : {id:t.id,available:true})};
  if (runtimeKind === 'kubernetes') {
    const c = host.kubernetesConstraints;
    if (!plain(c) || !Number.isSafeInteger(c.pidsLimit) || c.pidsLimit < 32 || c.pidsLimit > 8192 || flags.some(k => typeof c[k] !== 'boolean')) throw fail('K3s 节点能力声明无效。');
    node.kubernetesConstraints = {pidsLimit:c.pidsLimit,...Object.fromEntries(flags.map(k => [k,c[k]]))};
    node.ready = node.available && c.pidsConfigured && c.pidsVerifiedAtCreate && c.persistentStorage && node.templates.some(t => t.id === 'full');
    if (!node.ready) node.message = !node.available ? 'K3s 节点离线或状态已过期。' : 'K3s 节点待配置：需确认进程限制、持久存储及完整 CLI 镜像。';
  } else node.ready = node.available;
  return node;
}
export function platformOptions(node, record, requested = {}) {
  const resources = cloudResources(requested);
  if (!node?.available) throw fail('所选执行节点不可用。','cloud_platform_node_unavailable');
  if (node.runtimeKind === 'kubernetes') {
    if (!record.nodeId) throw fail('K3s 需要明确选择执行节点。','cloud_kubernetes_node_required');
    if (record.bundle !== 'agent') throw fail('K3s 当前仅支持 Codex CLI 环境。','cloud_kubernetes_bundle_unsupported',400);
    if (!node.ready) throw fail(node.message,'cloud_kubernetes_not_ready');
    const pids = node.kubernetesConstraints.pidsLimit;
    if (resources.pids !== undefined && resources.pids !== pids) throw fail('进程数必须使用 K3s 节点的固定限制。','cloud_kubernetes_pids_unsupported',400);
    resources.pids = pids;
  }
  return {runtimeKind:node.runtimeKind,resources};
}
