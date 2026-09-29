// Audit index blobs, not potentially different working-tree files. No values are printed.
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

const syntheticSecrets = new Map([
  ['tests/asr-http.test.mjs', new Set(['asr-owner-fixture'])],
  ['tests/cosyvoice-stream.test.mjs', new Set(['fixture-private-key'])],
  ['tests/desktop-executor.test.mjs', new Set(['central-session-secret', 'replacement-session'])],
  ['tests/execution-hosts-integration.test.mjs', new Set(['integration-owner', 'integration-password'])],
  ['tests/executor-relay-redactor.test.mjs', new Set(['synthetic-private-upstream-key'])],
  ['tests/executor-relay.test.mjs', new Set(['fixture-central-private-key', 'fixture-owner-session'])],
  ['tests/executors.test.mjs', new Set(['never-send-this-key'])],
  ['tests/agent-access.test.mjs', new Set(['private-agent-key', 'isolated-agent-password', 'replacement-agent-password'])],
  ['tests/attachments.test.mjs', new Set(['isolated-attachment-password'])],
  ['tests/auth-entry.test.mjs', new Set(['isolated-provider-key', 'isolated-voice-key', 'isolated-fixture-password'])],
  ['tests/connection-targets.test.mjs', new Set(['native-owner-secret', 'explicit-remote-session', 'different-server-session', 'previous-local-member'])],
  ['tests/updates.test.mjs', new Set(['updates-owner-token','test-passphrase-123','owner-passphrase-123'])],
  ['tests/providers.test.mjs', new Set(['private-test-key'])],
  ['tests/backend.test.mjs', new Set(['backend-test-secret', 'secret-not-in-state-response'])],
  ['tests/codex.test.mjs', new Set(['supersecret'])],
  ['tests/codex-config.test.mjs', new Set(['nonstandard-provider-secret', 'config-owner-token', 'test-password-123'])],
  ['tests/codex-dynamic.test.mjs', new Set(['arbitrary-secret-value'])],
  ['tests/codex-real.test.mjs', new Set(['isolated-test-key'])],
  ['tests/desktop-service-settings.test.mjs', new Set(['desktop-settings-fixture-token'])],
  ['scripts/browser-fixture.mjs', new Set(['petpal-browser-acceptance-only-20260926'])],
  ['tests/auth-race.test.mjs', new Set(['original-race-password', 'replacement-race-password'])],
  ['tests/users.test.mjs', new Set(['isolated-test-owner-token', 'test-password-123', 'fixture-provider-private-key', 'new-desktop-bootstrap-token', 'alice-private-voice-key', 'alice-private-asr-key', 'replacement-password', 'owner-new-password', 'incorrect-password', 'replacement-local-owner-token'])],
]);
/** Pure inspection: diagnostics include only the path and fixed reason, never matched values. */
export function inspectSourceEntry(entry, content) {
  if(typeof entry?.path!=='string'||!Buffer.isBuffer(content))throw new TypeError('A source path and blob Buffer are required');
  const reasons=new Set(),reject=reason=>reasons.add(reason),size=content.length;
  if(!['100644','100755'].includes(entry.mode))reject('non-regular source entry');
  if(size>40*1024*1024)reject('unexpected large source file');
  if(/(?:^|\/)(?:\.data|\.tools|\.release-private|evidence|node_modules|dist|releases?|build|\.gradle|\.preview-data[^/]*)(?:\/|$)|(?:^|\/)(?:\.env(?:\..*)?|local\.properties|auth\.json|token(?:\..*)?)$|\.(?:pem|key|p12|pfx|jks|keystore|log|exe|apk|aab|zip|db|sqlite)$/.test(entry.path.toLowerCase()))reject('runtime, credentials, or generated artifact path');
  const text=content.toString('utf8'),allowed=syntheticSecrets.get(entry.path)||new Set();
  // Scan strong markers even in binary assets. PEM may be JSON-escaped or
  // embedded in a container; neither a newline nor a text extension is required.
  for(const [reason,pattern] of [
    ['private key material',/-----BEGIN (?:(?:ENCRYPTED|RSA|EC|DSA|OPENSSH) )?PRIVATE KEY-----/],
    ['provider key value',/\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{20,}\b/],
    ['GitHub credential',/\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,})\b/],
    ['JWT value',/\beyJ[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{10,}/],
  ])if(pattern.test(text))reject(reason);
  if(!/\.(?:png|gif|ico|jar|jpe?g|webp|woff2?|ttf)$/i.test(entry.path)){
    if(/[A-Za-z]:[\\/]+Users[\\/]+[^\s'"`]+|\/(?:home|Users)\/[A-Za-z0-9_.-]+\/(?:\.codex|\.config)/.test(text))reject('personal configuration path');
    // Quoted JSON keys and values must close with the same quote that opened them.
    for(const match of text.matchAll(/(?:(['"])(?:api[_-]?key|access[_-]?token|refresh[_-]?token|password|token|secret)\1|\b(?:api[_-]?key|access[_-]?token|refresh[_-]?token|password|token|secret)\b)\s*[:=]\s*(['"])([^'"\r\n]{16,})\2/gi)){
      if(!allowed.has(match[3])&&!/\$\{|^(?:Bearer |<|process\.)/.test(match[3]))reject('unreviewed literal credential');
    }
    for(const match of text.matchAll(/Bearer\s+([A-Za-z0-9_.-]{24,})/g))if(!allowed.has(match[1]))reject('literal bearer value');
  }
  return [...reasons].map(reason=>({path:entry.path,reason}));
}

export function auditGitIndex(runGit=execFileSync) {
  const staged = runGit('git',['ls-files','--stage','-z']).toString('utf8').split('\0').filter(Boolean).map(row=>{
    const match=/^(\d+) ([a-f0-9]+) (\d)\t(.+)$/.exec(row);
    if(!match||match[3]!=='0')throw new Error('Unmerged or malformed index entry');
    return {mode:match[1],hash:match[2],path:match[4]};
  });
  if(!staged.length)throw new Error('No staged or tracked source files');
  const blobs=runGit('git',['cat-file','--batch'],{input:staged.map(entry=>entry.hash).join('\n')+'\n',maxBuffer:128*1024*1024});
  let offset=0,bytes=0;const issues=[];
  for(const entry of staged){
    const end=blobs.indexOf(10,offset),header=end<0?null:/^([a-f0-9]+) blob (\d+)$/.exec(blobs.subarray(offset,end).toString()),size=Number(header?.[2]);
    if(!header||header[1]!==entry.hash||!Number.isSafeInteger(size)||size<0||end+size+1>=blobs.length||blobs[end+size+1]!==10)throw new Error('Unexpected Git blob response');
    const content=blobs.subarray(end+1,end+1+size);offset=end+size+2;bytes+=size;
    issues.push(...inspectSourceEntry(entry,content));
  }
  if(offset!==blobs.length)throw new Error('Unexpected trailing Git blob response');
  return {files:staged.length,bytes,pass:issues.length===0,issues};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
  try{
    const result=auditGitIndex();console.log(JSON.stringify(result,null,2));
    if(!result.pass)process.exitCode=1;
  }catch{
    // Child-process errors can contain captured blob bytes; never print the error object.
    console.error('Public source audit could not complete the Git index scan.');process.exitCode=1;
  }
}
