import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, cp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const project = new URL('../', import.meta.url);
async function removeFixture(root) {
  const resolved = path.resolve(root);
  assert.equal(path.dirname(resolved), path.resolve(tmpdir()));
  assert.match(path.basename(resolved), /^petpal-android-build-/);
  await rm(resolved, { recursive: true, force: true });
}

test('Android Bash build passes the chosen output to Vite and the verifier directly', async () => {
  const source = await readFile(new URL('scripts/build-android.sh', project), 'utf8');
  assert.match(source, /npx --no-install tsc --noEmit\s+npx --no-install vite build --outDir "\$PETPAL_ANDROID_WEB_DIR"\s+node scripts\/verify-openui-web-build\.mjs "\$PETPAL_ANDROID_WEB_DIR"/);
  assert.doesNotMatch(source, /npm run build -- --outDir/);
  assert.match(source, /set -euo pipefail/);
});

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'petpal-android-build-'));
  const scripts = path.join(root, 'scripts'), jdk = path.join(root, 'jdk'), sdk = path.join(root, 'sdk');
  const commands = path.join(root, 'commands'), web = path.join(root, 'chosen web'), output = path.join(root, 'qa packages');
  await Promise.all([scripts, path.join(jdk, 'bin'), path.join(sdk, 'platform-tools'), commands,
    path.join(root, 'android', 'app'), path.join(root, 'dist')].map(folder => mkdir(folder, { recursive: true })));
  await Promise.all([
    cp(new URL('scripts/build-android.ps1', project), path.join(scripts, 'build-android.ps1')),
    writeFile(path.join(root, 'android', 'app', 'build.gradle'), 'versionName "0.9.14"'),
    writeFile(path.join(jdk, 'release'), 'JAVA_VERSION="21.0.8"'),
    writeFile(path.join(jdk, 'bin', 'java.exe'), ''), writeFile(path.join(jdk, 'bin', 'javac.exe'), ''),
    writeFile(path.join(root, 'dist', 'index.html'), 'existing production web'),
  ]);
  const stub = path.join(root, 'stub.mjs');
  await writeFile(stub, `
import fs from 'node:fs';import path from 'node:path';
const [tool,...args]=process.argv.slice(2);const root=process.env.PETPAL_STUB_ROOT;
const stage=tool==='gradle'?'gradle':tool==='node'?(args[0].includes('verify-openui')?'verify':'mihomo'):args.includes('tsc')?'tsc':args.includes('vite')?'vite':args.includes('cap')?'sync':'unexpected';
fs.appendFileSync(path.join(root,'calls.jsonl'),JSON.stringify({tool,args,stage,web:process.env.PETPAL_ANDROID_WEB_DIR,version:process.env.PETPAL_ANDROID_VERSION,cwd:process.cwd()})+'\\n');
if(process.env.PETPAL_STUB_FAIL===stage)process.exit(17);
if(stage==='unexpected')process.exit(18);
if(stage==='vite'){const out=args[args.indexOf('--outDir')+1];fs.mkdirSync(out,{recursive:true});fs.writeFileSync(path.join(out,'index.html'),'fresh isolated web');}
if(stage==='verify'&&fs.readFileSync(path.join(args[1],'index.html'),'utf8')!=='fresh isolated web')process.exit(19);
if(stage==='sync'&&fs.readFileSync(path.join(process.env.PETPAL_ANDROID_WEB_DIR,'index.html'),'utf8')!=='fresh isolated web')process.exit(20);
if(stage==='gradle'){const out=path.join(root,'android/app/build/outputs/apk/debug');fs.mkdirSync(out,{recursive:true});fs.writeFileSync(path.join(out,'app-debug.apk'),'test APK');}
`);
  for (const tool of ['node', 'npx', 'gradle']) {
    await writeFile(path.join(commands, `${tool}.cmd`), `@echo off\r\n"${process.execPath}" "${stub}" ${tool} %*\r\nexit /b %errorlevel%\r\n`);
  }
  const run = async ({ fail = '', skip = false } = {}) => {
    const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join(scripts, 'build-android.ps1'),
      '-SdkPath', sdk, '-JdkPath', jdk, '-GradlePath', path.join(commands, 'gradle.cmd'), '-WebDirectory', web, '-OutputDirectory', output, ...(skip ? ['-SkipWebBuild'] : [])], {
      encoding: 'utf8', timeout: 30000,
      env: { ...process.env, PATH: `${commands};${process.env.PATH}`,
        // Node does not perform PowerShell 7's PSModulePath cleanup when it
        // launches Windows PowerShell; keep its real Get-FileHash available.
        PSModulePath: path.join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'Modules'),
        PETPAL_STUB_ROOT: root, PETPAL_STUB_FAIL: fail },
    });
    const calls = (await readFile(path.join(root, 'calls.jsonl'), 'utf8')).trim().split('\n').map(line => JSON.parse(line));
    return { result, calls };
  };
  return { root, web, output, run };
}

test('PowerShell Android build isolates the Web output and stops before packaging on each failed stage', { skip: process.platform !== 'win32' }, async t => {
  for (const fail of ['', 'tsc', 'vite', 'verify', 'mihomo', 'sync', 'gradle']) {
    await t.test(fail ? `${fail} failure stops dependent commands` : 'fresh selected output is verified and synced', async () => {
      const f = await fixture();
      try {
        const { result, calls } = await f.run({ fail });
        const order = ['tsc', 'vite', 'verify', 'mihomo', 'sync', 'gradle'];
        assert.equal(result.status, fail ? 1 : 0, result.stdout + result.stderr);
        assert.deepEqual(calls.map(call => call.stage), fail ? order.slice(0, order.indexOf(fail) + 1) : order);
        assert.equal(await readFile(path.join(f.root, 'dist', 'index.html'), 'utf8'), 'existing production web');
        for (const call of calls) { assert.equal(call.web, f.web); assert.equal(call.version, '0.9.14'); }
        if (!fail) {
          assert.deepEqual(calls[1].args, ['--no-install', 'vite', 'build', '--outDir', f.web]);
          assert.deepEqual(calls[2].args, ['scripts/verify-openui-web-build.mjs', f.web]);
          assert.equal(await readFile(path.join(f.output, 'PetPal-0.9.14-Android-debug.apk'), 'utf8'), 'test APK');
        }
      } finally { await removeFixture(f.root); }
    });
  }
});

test('PowerShell SkipWebBuild consumes the explicit existing output and protects an existing APK', { skip: process.platform !== 'win32' }, async () => {
  const f = await fixture();
  try {
    await mkdir(f.web, { recursive: true }); await writeFile(path.join(f.web, 'index.html'), 'fresh isolated web');
    await mkdir(f.output, { recursive: true });
    const existing = path.join(f.output, 'PetPal-0.9.14-Android-debug.apk'); await writeFile(existing, 'protected previous APK');
    const { result, calls } = await f.run({ skip: true });
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.deepEqual(calls.map(call => call.stage), ['mihomo', 'sync', 'gradle']);
    assert.match(result.stdout + result.stderr, /An APK with this version already exists/);
    assert.equal(await readFile(existing, 'utf8'), 'protected previous APK');
  } finally { await removeFixture(f.root); }
});
