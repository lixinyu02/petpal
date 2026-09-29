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

test('path restrictions apply case insensitively and source entry metadata remains bounded',()=>{
  for(const name of ['docs/PRIVATE.PEM','docs/auth.JSON','.RELEASE-PRIVATE/key.txt','NODE_MODULES/test.txt','docs/data.SQLITE'])assert.ok(reasons(inspect(name,'not-sensitive')).includes('runtime, credentials, or generated artifact path'));
  assert.ok(reasons(inspect('public/asset.png','relative-target','120000')).includes('non-regular source entry'));
  assert.deepEqual(inspect('public/asset.png',Buffer.from([137,80,78,71,0,255])),[]);
  assert.throws(()=>inspectSourceEntry({path:'test.txt'},'not a Buffer'),TypeError);
});

function fakeGit(entries,transform=value=>value){
  let count=0;
  return (_command,args,options)=>{
    count++;
    if(count===1){assert.deepEqual(args,['ls-files','--stage','-z']);return Buffer.from(entries.map((entry,index)=>`100644 ${String(index+1).repeat(40)} 0\t${entry.path}\0`).join(''));}
    assert.equal(count,2);assert.deepEqual(args,['cat-file','--batch']);
    assert.equal(options.input,entries.map((_entry,index)=>String(index+1).repeat(40)).join('\n')+'\n');
    return transform(Buffer.concat(entries.map((entry,index)=>{const body=Buffer.from(entry.content);return Buffer.concat([Buffer.from(`${String(index+1).repeat(40)} blob ${body.length}\n`),body,Buffer.from('\n')]);})));
  };
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
  for(const transform of [bytes=>bytes.subarray(0,-2),bytes=>Buffer.concat([bytes,Buffer.from('extra')]),bytes=>Buffer.from(bytes.toString().replace(' blob ',' tree ')),bytes=>Buffer.from(bytes.toString().replace('1'.repeat(40),'f'.repeat(40)))])assert.throws(()=>auditGitIndex(fakeGit(entries,transform)),/Git blob/);
  assert.throws(()=>auditGitIndex(()=>Buffer.from('')),/No staged/);
  assert.throws(()=>auditGitIndex(()=>Buffer.from(`100644 ${'1'.repeat(40)} 1\tsrc/conflict.ts\0`)),/Unmerged/);
});

test('the scanner and its tests contain no sensitive literals that bypass their own rules',async()=>{
  for(const name of ['scripts/audit-public-source.mjs','tests/public-source-audit.test.mjs'])assert.deepEqual(inspect(name,await readFile(new URL(`../${name}`,import.meta.url))),[],name);
});
