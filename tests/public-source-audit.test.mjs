import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {inspectSourceEntry,auditGitIndex} from '../scripts/audit-public-source.mjs';

const inspect=(name,value,mode='100644')=>inspectSourceEntry({path:name,mode},Buffer.isBuffer(value)?value:Buffer.from(value));
const marker=kind=>['-----','BEGIN ',kind?`${kind} `:'','PRIVATE',' KEY-----'].join('');
const privateSample=kind=>`${marker(kind)}\n${'a'.repeat(48)}\n`;
const credential=()=>['synthetic','secret','value',123456789].join('-');
const reasons=issues=>issues.map(issue=>issue.reason);

test('private markers are rejected in raw, serialized and binary named assets for every supported key type',()=>{
  for(const kind of ['', 'ENCRYPTED','RSA','EC','DSA','OPENSSH']){
    const sample=privateSample(kind);
    for(const [name,body] of [
      ['docs/key.txt',sample],
      ['docs/key.json',JSON.stringify({privateKey:sample})],
      ['public/avatar.png',Buffer.concat([Buffer.from([137,80,78,71,0,255]),Buffer.from(sample)])],
      ['android/wrapper.jar',sample],
    ])assert.ok(reasons(inspect(name,body)).includes('private key material'),name);
  }
});

test('provider, GitHub and JWT shaped values are checked even in binary assets without returning their values',()=>{
  const samples=[['provider key value',['sk','proj', 'a'.repeat(32)].join('-')],['GitHub credential',['ghp','b'.repeat(36)].join('_')],['GitHub credential',['github','pat','c'.repeat(50)].join('_')],['JWT value',['eyJ'+'d'.repeat(20),'e'.repeat(20),'f'.repeat(20)].join('.')]];
  for(const [reason,value] of samples){
    const issues=inspect('public/avatar.PNG',Buffer.concat([Buffer.from([0,255]),Buffer.from(value),Buffer.from([0])]));
    assert.ok(reasons(issues).includes(reason));
    assert.equal(JSON.stringify(issues).includes(value),false);
    assert.deepEqual(Object.keys(issues[0]),['path','reason']);
  }
});

test('literal credentials detect quoted JSON keys, JavaScript keys and environment assignments',()=>{
  const value=credential();
  for(const key of ['apiKey','api_key','api-key','accessToken','refresh_token','password','token','secret']){
    for(const text of [JSON.stringify({[key]:value}),`${key} = "${value}"`,`'${key}': '${value}'`]){
      assert.ok(reasons(inspect('docs/config.json',text)).includes('unreviewed literal credential'));
      assert.equal(JSON.stringify(inspect('docs/config.json',text)).includes(value),false);
    }
  }
  const unrelated=JSON.stringify({tokenDescription:value,passwordPolicy:value});
  assert.deepEqual(inspect('docs/config.json',unrelated),[]);
});

test('reviewed synthetic credentials remain allowed only in their exact fixture file',()=>{
  const fixture=['updates','owner','token'].join('-'),text=JSON.stringify({token:fixture});
  assert.deepEqual(inspect('tests/updates.test.mjs',text),[]);
  for(const name of ['tests/other.test.mjs','docs/updates.test.mjs','Tests/updates.test.mjs'])assert.ok(reasons(inspect(name,text)).includes('unreviewed literal credential'));
  for(const value of ['<insert-your-secret-here>', '${process.env.KEY}', 'process.env.EXAMPLE_KEY'])assert.deepEqual(inspect('docs/config.json',JSON.stringify({apiKey:value})),[]);
});

test('ASR and Agent fixture credentials use the shared exact-file policy without exempting other values',async()=>{
  for(const name of ['tests/asr-http.test.mjs','tests/asr.test.mjs','tests/agent-access.test.mjs']){
    assert.deepEqual(inspect(name,await readFile(new URL(`../${name}`,import.meta.url))),[],name);
    assert.ok(reasons(inspect(name,JSON.stringify({token:credential()}))).includes('unreviewed literal credential'));
  }
  const asrFixture=['asr','owner','fixture'].join('-');
  assert.ok(reasons(inspect('tests/other.test.mjs',JSON.stringify({token:asrFixture}))).includes('unreviewed literal credential'));
});

test('central server synthetic fixtures remain scoped to the reviewed test file and value',async()=>{
  const names=['tests/central-hosting.test.mjs','tests/central-server-integration.test.mjs','tests/central-server-ipc.test.mjs','tests/central-server-settings.test.mjs'];
  for(const name of names){
    assert.deepEqual(inspect(name,await readFile(new URL(`../${name}`,import.meta.url))),[],name);
    assert.ok(reasons(inspect(name,JSON.stringify({token:credential()}))).includes('unreviewed literal credential'));
  }
  const fixture=['secret','must','not','be','rendered'].join('-');
  for(const name of ['tests/other.test.mjs','docs/central-server.md',names[0]])assert.ok(reasons(inspect(name,JSON.stringify({token:fixture}))).includes('unreviewed literal credential'));
});

test('path restrictions apply case insensitively and source entry metadata remains bounded',()=>{
  for(const name of ['docs/PRIVATE.PEM','docs/auth.JSON','.RELEASE-PRIVATE/key.txt','NODE_MODULES/test.txt','docs/data.SQLITE'])assert.ok(reasons(inspect(name,'not-sensitive')).includes('runtime, credentials, or generated artifact path'));
  assert.ok(reasons(inspect('public/asset.png','relative-target','120000')).includes('non-regular source entry'));
  assert.deepEqual(inspect('public/asset.png',Buffer.from([137,80,78,71,0,255])),[]);
  assert.throws(()=>inspectSourceEntry({path:'test.txt'},'not a Buffer'),TypeError);
});

function fakeGit(entries,{transform=value=>value,metadataTransform=value=>value,onBatch=()=>{}}={}){
  const objects=entries.map((entry,index)=>({...entry,hash:entry.hash||(index+1).toString(16).padStart(40,'0'),size:entry.metadataSize??Buffer.byteLength(entry.content)}));
  let indexed=false,checked=false;
  const run=(_command,args,options)=>{
    if(!indexed){indexed=true;assert.deepEqual(args,['ls-files','--stage','-z']);return Buffer.from(objects.map(entry=>`100644 ${entry.hash} 0\t${entry.path}\0`).join(''));}
    if(!checked){
      checked=true;assert.deepEqual(args,['cat-file','--batch-check']);
      assert.equal(options.input,objects.map(entry=>entry.hash).join('\n')+'\n');
      return metadataTransform(Buffer.from(objects.map(entry=>`${entry.hash} blob ${entry.size}\n`).join('')));
    }
    assert.deepEqual(args,['cat-file','--batch']);
    assert.ok(options.input.endsWith('\n'));
    const batch=options.input.slice(0,-1).split('\n').map(hash=>{const entry=objects.find(entry=>entry.hash===hash);assert.ok(entry,'Only frozen index hashes may be read');return entry;});
    run.batches.push(batch.map(entry=>entry.path));onBatch(batch,options);
    return transform(Buffer.concat(batch.map(entry=>{const body=Buffer.isBuffer(entry.content)?entry.content:Buffer.from(entry.content);return Buffer.concat([Buffer.from(`${entry.hash} blob ${body.length}\n`),body,Buffer.from('\n')]);})));
  };
  run.batches=[];
  return run;
}

test('index audit inspects exact batch blobs and emits only fixed diagnostics',()=>{
  const entries=[{path:'src/clean.ts',content:'export const ready = true;'}, {path:'docs/sample.json',content:JSON.stringify({privateKey:privateSample('')})}];
  const result=auditGitIndex(fakeGit(entries));
  assert.equal(result.files,2);assert.equal(result.bytes,entries.reduce((sum,entry)=>sum+Buffer.byteLength(entry.content),0));
  assert.equal(result.pass,false);assert.deepEqual(result.issues,[{path:'docs/sample.json',reason:'private key material'}]);
  assert.equal(JSON.stringify(result).includes(marker('')),false);
  assert.equal(auditGitIndex(fakeGit(entries.slice(0,1))).pass,true);
});

test('malformed, truncated and extra Git blob responses fail closed',()=>{
  const entries=[{path:'src/clean.ts',content:'export const ready = true;'}];
  for(const transform of [bytes=>bytes.subarray(0,-2),bytes=>Buffer.concat([bytes,Buffer.from('extra')]),bytes=>Buffer.from(bytes.toString().replace(' blob ',' tree ')),bytes=>Buffer.from(bytes.toString().replace('1'.padStart(40,'0'),'f'.repeat(40)))])assert.throws(()=>auditGitIndex(fakeGit(entries,{transform})),/Git blob/);
  assert.throws(()=>auditGitIndex(()=>Buffer.from('')),/No staged/);
  assert.throws(()=>auditGitIndex(()=>Buffer.from(`100644 ${'1'.repeat(40)} 1\tsrc/conflict.ts\0`)),/Unmerged/);
});

test('32 MiB batches preserve exact boundary bytes and still detect a secret in the last batch',()=>{
  const mib=1024*1024,large=Buffer.alloc(16*mib,32),value=credential();
  const entries=[{path:'public/first.png',content:large},{path:'public/second.png',content:large},{path:'docs/last.json',content:JSON.stringify({token:value})},{path:'src/empty.ts',content:''}];
  const git=fakeGit(entries,{onBatch:(batch,options)=>{
    const size=batch.reduce((sum,entry)=>sum+entry.size,0);
    assert.ok(size<=32*mib);assert.ok(options.maxBuffer>=size&&options.maxBuffer<33*mib,'stdout capacity must be per batch');
  }});
  const result=auditGitIndex(git);
  assert.deepEqual(git.batches,[['public/first.png','public/second.png'],['docs/last.json','src/empty.ts']]);
  assert.equal(result.files,4);assert.equal(result.bytes,32*mib+Buffer.byteLength(entries[2].content));
  assert.equal(result.pass,false);assert.deepEqual(result.issues,[{path:'docs/last.json',reason:'unreviewed literal credential'}]);
  assert.equal(JSON.stringify(result).includes(value),false);
});

test('a source larger than the target batch is read alone without truncation',()=>{
  const mib=1024*1024,body=Buffer.alloc(33*mib,32);
  const git=fakeGit([{path:'public/large.png',content:body},{path:'src/after.ts',content:'export {};'}],{onBatch:(batch,options)=>{
    if(batch[0].path==='public/large.png'){assert.equal(batch.length,1);assert.ok(options.maxBuffer>body.length&&options.maxBuffer<34*mib);}
  }});
  const result=auditGitIndex(git);
  assert.equal(result.pass,true);assert.equal(result.bytes,body.length+10);
  assert.deepEqual(git.batches,[['public/large.png'],['src/after.ts']]);
});

test('every metadata row must match the immutable index hash, blob type and safe size before any body is read',()=>{
  const entries=[{path:'src/first.ts',content:'first'},{path:'src/last.ts',content:'last'}];
  const malformed=[
    bytes=>bytes.subarray(0,-1),
    bytes=>Buffer.concat([bytes,Buffer.from('\n')]),
    bytes=>Buffer.from(bytes.toString().split('\n').slice(0,1).join('\n')+'\n'),
    bytes=>Buffer.from(bytes.toString().replace('2'.padStart(40,'0'),'f'.repeat(40))),
    bytes=>Buffer.from(bytes.toString().replace(' blob 4',' tree 4')),
    bytes=>Buffer.from(bytes.toString().replace(' blob 4',' missing')),
    ...['-1','1.5','NaN','Infinity','04','9007199254740992'].map(size=>bytes=>Buffer.from(bytes.toString().replace(' blob 4',` blob ${size}`))),
    bytes=>{const value=Buffer.from(bytes);value[value.indexOf('blob')]=0xe2;return value;},
  ];
  for(const metadataTransform of malformed){
    const git=fakeGit(entries,{metadataTransform});
    assert.throws(()=>auditGitIndex(git),/^Error: Unexpected Git blob metadata$/);
    assert.deepEqual(git.batches,[],'even a malformed last row must prevent all blob reads');
  }
  // The body response must agree with the preflight, not just have valid framing.
  assert.throws(()=>auditGitIndex(fakeGit([{path:'src/drift.ts',content:'actual',metadataSize:5}])),/Unexpected Git blob response/);
});

test('objects over 40 MiB are rejected without reading their bodies while remaining files are scanned',()=>{
  const size=40*1024*1024+1,value=privateSample('');
  const git=fakeGit([{path:'public/oversized.png',content:null,metadataSize:size},{path:'docs/after.txt',content:value}],{onBatch:batch=>assert.ok(batch.every(entry=>entry.content!==null),'oversized object must never be requested')});
  const result=auditGitIndex(git);
  assert.deepEqual(git.batches,[['docs/after.txt']]);
  assert.equal(result.files,2);assert.equal(result.bytes,size+Buffer.byteLength(value));assert.equal(result.pass,false);
  assert.deepEqual(result.issues,[{path:'public/oversized.png',reason:'unexpected large source file'},{path:'docs/after.txt',reason:'private key material'}]);
  assert.equal(JSON.stringify(result).includes(value),false);
});

test('Git process failures never propagate captured secret stdout through the audit API',()=>{
  const value=credential();
  for(const failAt of [1,2,3]){
    const fixture=fakeGit([{path:'src/clean.ts',content:'export {};'}]);let calls=0;
    assert.throws(()=>auditGitIndex((...args)=>{
      if(++calls===failAt)throw Object.assign(new Error(value),{stdout:Buffer.from(value),stderr:Buffer.from(value)});
      return fixture(...args);
    }),error=>error.message==='Unable to read Git source audit data'&&!JSON.stringify(error).includes(value)&&error.stdout===undefined&&error.stderr===undefined&&error.cause===undefined);
  }
});

test('the scanner and its tests contain no sensitive literals that bypass their own rules',async()=>{
  for(const name of ['scripts/audit-public-source.mjs','tests/public-source-audit.test.mjs'])assert.deepEqual(inspect(name,await readFile(new URL(`../${name}`,import.meta.url))),[],name);
});
