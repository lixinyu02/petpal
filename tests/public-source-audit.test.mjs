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

test('account settings fixture password is allowed only for its reviewed file and value',async()=>{
  const name='tests/accounts-settings-ui.test.mjs',value=['synthetic','password'].join('-');
  assert.deepEqual(inspect(name,await readFile(new URL(`../${name}`,import.meta.url))),[]);
  assert.ok(reasons(inspect(name,JSON.stringify({password:credential()}))).includes('unreviewed literal credential'));
  assert.ok(reasons(inspect('docs/config.json',JSON.stringify({password:value}))).includes('unreviewed literal credential'));
});

test('desktop proxy, official account and device role fixtures stay scoped to exact reviewed files',async()=>{
  for(const stem of ['app-preferences-ipc','app-proxy-context','app-proxy-download','app-proxy-remote','app-proxy-ipc','app-proxy-network','app-proxy-ui','executors','official-account-api','official-account-ipc','official-account-ui','official-account','user-device-roles']){
    const name=`tests/${stem}.test.mjs`;
    assert.deepEqual(inspect(name,await readFile(new URL(`../${name}`,import.meta.url))),[],name);
    assert.ok(reasons(inspect(name,JSON.stringify({token:credential()}))).includes('unreviewed literal credential'),name);
  }
  const bearer=['access','secret','alice','refreshed'].join('-');
  assert.ok(reasons(inspect('docs/config.txt',`Bearer ${bearer}`)).includes('literal bearer value'));
  const downloadFixture=['fixture','private','token'].join('-');
  assert.ok(reasons(inspect('docs/config.json',JSON.stringify({token:downloadFixture}))).includes('unreviewed literal credential'));
  const callbackFixture=['http://127.0.0.1:1455/auth/callback?code=private-oauth-code','state=private-oauth-state'].join('&');
  assert.deepEqual(inspect('tests/official-account-ui.test.mjs',JSON.stringify({secret:callbackFixture})),[]);
  assert.ok(reasons(inspect('docs/config.json',JSON.stringify({secret:callbackFixture}))).includes('unreviewed literal credential'));
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

test('reviewed cloud, memory and lifecycle credentials require their exact file and literal',async()=>{
  const reviewed=[
  [
    "tests/android-official-root-ready.test.mjs",
    [
      "synthetic-restored-session"
    ]
  ],
  [
    "tests/app-proxy-profiles-http.test.mjs",
    [
      "isolated-shared-password-123"
    ]
  ],
  [
    "tests/cloud-api.test.mjs",
    [
      "cloud-fixture-password"
    ]
  ],
  [
    "tests/cloud-docker-ui.test.mjs",
    [
      "never-include-permanent-token"
    ]
  ],
  [
    "tests/cloud-docker.test.mjs",
    [
      "upstream-private-fixture",
      "private-loopback"
    ]
  ],
  [
    "tests/companion-routines-api.test.mjs",
    [
      "companion-api-owner-fixture",
      "SyntheticDaily123a"
    ]
  ],
  [
    "tests/desktop-memory.test.mjs",
    [
      "private-login-token"
    ]
  ],
  [
    "tests/memobase-client.test.mjs",
    [
      "synthetic-only-memory-key"
    ]
  ],
  [
    "tests/memobase-runtime.test.mjs",
    [
      "private-model-key"
    ]
  ],
  [
    "tests/memory-api.test.mjs",
    [
      "synthetic-memory-model-key",
      "synthetic-memory-password",
      "synthetic-memobase-key",
      "synthetic-remote-token"
    ]
  ],
  [
    "tests/memory-service.test.mjs",
    [
      "synthetic-private-token-123",
      "synthetic-secret-key",
      "synthetic-login-token",
      "private-test-token",
      "private-original",
      "must-not-be-written",
      "synthetic-private-provider-key",
      "private-runtime-token",
      "local-synthetic-only",
      "synthetic-account-token"
    ]
  ],
  [
    "tests/task-notification-controller.test.mjs",
    [
      "new-session-token"
    ]
  ]
];
  for(const [name,values] of reviewed){
    assert.deepEqual(inspect(name,await readFile(new URL(`../${name}`,import.meta.url))),[],name);
    for(const value of values){
      const text=JSON.stringify({token:value});
      assert.deepEqual(inspect(name,text),[],name);
      for(const other of ['tests/unreviewed-fixture.test.mjs',`docs/${name}`,`Tests/${name.slice(6)}`]){
        assert.ok(reasons(inspect(other,text)).includes('unreviewed literal credential'),other);
      }
      assert.ok(reasons(inspect(name,JSON.stringify({token:value+'-changed'}))).includes('unreviewed literal credential'),name);
    }
    for(const key of ['apiKey','password','refreshToken'])assert.ok(reasons(inspect(name,JSON.stringify({[key]:credential()}))).includes('unreviewed literal credential'),name);
    assert.ok(reasons(inspect(name,privateSample('RSA'))).includes('private key material'),name);
    const provider=['sk','proj','z'.repeat(32)].join('-');
    assert.ok(reasons(inspect(name,JSON.stringify({apiKey:provider}))).includes('provider key value'),name);
  }
});

test('reviewed connection fixtures require exact files and literals without bypassing credential or path rules',async()=>{
  const reviewed=[
    ['scripts/android-fluidity-fixture.mjs',['synthetic-local-key','synthetic-performance-bootstrap']],
    ['scripts/android-session-fixture.mjs',['synthetic-session-bootstrap-never-production']],
    ['tests/android-login-gate-ui.test.mjs',['synthetic-session','synthetic-restored','synthetic-old-account','synthetic-original','synthetic-late-network','synthetic-stale-read','synthetic-committed']],
    ['tests/android-login-session.test.mjs',['synthetic-remembered','synthetic-login-password','synthetic-pairing','synthetic-normal','synthetic-new-account','synthetic-current-account','synthetic-pairing-candidate','synthetic-too-late','synthetic-committed-new','synthetic-write-candidate','synthetic-write-to-revoke','synthetic-after-read-timeout']],
    ['tests/api-request-lifecycle.test.mjs',['synthetic-session','synthetic-replacement']],
    ['tests/api-session.test.mjs',['original-session','synthetic-candidate']],
    ['tests/auth-session-renewal.test.mjs',['isolated-fixture-password','incorrect-fixture-password','synthetic-unknown-token']],
    ['tests/initial-state-warmup.test.mjs',['synthetic-member-token','synthetic-new-token']],
    ['tests/model-settings-save.test.mjs',['synthetic-provider-session']],
    ['tests/openui-api.test.mjs',['synthetic-ui-key','synthetic-ui-agent-key']],
    ['tests/state-response-compression.test.mjs',['isolated-compression-owner','private-provider-key']],
  ];
  for(const [name,values] of reviewed){
    const contents=await readFile(new URL(`../${name}`,import.meta.url));
    assert.deepEqual(inspect(name,contents),[],name);
    for(const value of values){
      assert.ok(contents.includes(value),'Reviewed literal must still occur in its fixture');
      for(const key of ['apiKey','accessToken','refreshToken','password','token','secret'])assert.deepEqual(inspect(name,JSON.stringify({[key]:value})),[],name);
      const text=JSON.stringify({token:value});
      for(const other of ['tests/unreviewed-connection-fixture.test.mjs',`docs/${name}`,name[0].toUpperCase()+name.slice(1)])assert.ok(reasons(inspect(other,text)).includes('unreviewed literal credential'),other);
      assert.ok(reasons(inspect(name,JSON.stringify({token:value+'-changed'}))).includes('unreviewed literal credential'),name);
      if(value.length>=24){
        assert.deepEqual(inspect(name,`Bearer ${value}`),[],name);
        assert.ok(reasons(inspect(name,`Bearer ${value}-changed`)).includes('literal bearer value'),name);
        assert.ok(reasons(inspect('docs/config.txt',`Bearer ${value}`)).includes('literal bearer value'),name);
      }
      assert.ok(reasons(inspect(`.data/${name}`,text)).includes('runtime, credentials, or generated artifact path'),name);
      assert.ok(reasons(inspect(name,text,'120000')).includes('non-regular source entry'),name);
    }
    for(const key of ['apiKey','password','refreshToken'])assert.ok(reasons(inspect(name,JSON.stringify({[key]:credential()}))).includes('unreviewed literal credential'),name);
    assert.ok(reasons(inspect(name,privateSample('RSA'))).includes('private key material'),name);
    const provider=['sk','proj','z'.repeat(32)].join('-');
    assert.ok(reasons(inspect(name,JSON.stringify({apiKey:provider}))).includes('provider key value'),name);
  }
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
