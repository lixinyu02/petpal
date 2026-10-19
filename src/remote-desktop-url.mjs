/** A ticket can only reach this instance's same service. Never accept a proxy
 * URL or reuse the normal account bearer as WebSocket authentication. */
export function remoteDesktopUrl(baseUrl,hostId,value,now=Date.now()){
  const expected=`/api/cloud-docker/${encodeURIComponent(hostId)}/desktop/ws`;
  if(!value||value.path!==expected||typeof value.ticket!=='string'||!/^[a-zA-Z0-9_-]{16,512}$/.test(value.ticket))throw new Error('远程桌面票据无效，请重新连接。');
  const expires=typeof value.expiresAt==='number'?value.expiresAt:Date.parse(value.expiresAt);
  if(!Number.isFinite(expires)||expires<=now||expires>now+180000)throw new Error('远程桌面票据已失效，请重新连接。');
  const base=new URL(baseUrl);
  if(!['http:','https:'].includes(base.protocol)||base.username||base.password||base.search||base.hash)throw new Error('个人服务地址无效。');
  const target=new URL(`${base.origin}${base.pathname.replace(/\/$/,'')}${expected}`);
  target.protocol=base.protocol==='https:'?'wss:':'ws:';
  target.searchParams.set('ticket',value.ticket);
  return target.href;
}
