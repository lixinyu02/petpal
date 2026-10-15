// Isolated Windows distribution: never replaces the backend's live dist folder.
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile, readdir, cp } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import {auditComputerUsePackage,filterComputerUseNative,COMPUTER_USE_PACKAGE,COMPUTER_USE_RUNTIME_FILES} from './computer-use-package.mjs';
import {parseWindowsBuildOptions,prepareWindowsCodex,installWindowsCodex,inspectWindowsPe} from './windows-target-package.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const { build, Platform, Arch } = require('electron-builder');
const installMihomo = require('./mihomo-after-pack.cjs');
const yaml = require('js-yaml');
if (process.platform !== 'win32') throw new Error('Build Windows distributions on Windows.');
const metadata = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
const {arch,output}=parseWindowsBuildOptions(process.argv.slice(2),{root,version:metadata.version});
const computerUseSource=await auditComputerUsePackage(root,{platform:'win32',arch});
await mkdir(output); // EEXIST protects previous releases/evidence.
const codexTarget=await prepareWindowsCodex(root,{arch,stagingRoot:path.join(output,'target-staging')});
function run(executable, parameters, cwd = root) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, parameters, { cwd, stdio: 'inherit', shell: false, windowsHide: true });
    child.once('error', reject);
    child.once('exit', code => code === 0 ? resolve() : reject(new Error(`Build command failed (${code})`)));
  });
}
await run(process.execPath, ['node_modules/typescript/bin/tsc', '--noEmit']);
const dist = path.join(output, 'dist');
await run(process.execPath, ['node_modules/vite/bin/vite.js', 'build', '--outDir', dist]);
const config = yaml.load(await readFile(path.join(root, 'desktop/electron-builder.yml'), 'utf8'));
config.files = config.files.map(item => item === 'dist/**' ? { from: dist, to: 'dist', filter: ['**/*'] } : item);
config.files.push('!server/native/computer-use/linux-*/**');
let packagedApp;
config.afterPack = async context => {
  assert.equal(context.arch,Arch[arch]);
  packagedApp=context.appOutDir;
  const unpacked=path.join(context.appOutDir,'resources','app.asar.unpacked');
  const codex=await installWindowsCodex(unpacked,codexTarget);
  await writeFile(path.join(output,'codex-target-package.json'),JSON.stringify(codex,null,2),{flag:'wx'});
  const packageDirectory=path.join(unpacked,COMPUTER_USE_PACKAGE);
  // Preserve exact package metadata and runtime/license members after builder
  // filtering, then retain only the target host's N-API module.
  for(const relative of [...COMPUTER_USE_RUNTIME_FILES,`computer-use-napi.win32-${arch}.node`]){
    const target=path.join(packageDirectory,relative);await mkdir(path.dirname(target),{recursive:true});
    await cp(path.join(root,COMPUTER_USE_PACKAGE,relative),target);
  }
  await filterComputerUseNative(unpacked,{platform:'win32',arch});
  const audit=await auditComputerUsePackage(unpacked,{platform:'win32',arch,expected:computerUseSource});
  await writeFile(path.join(output,'computer-use-package.json'),JSON.stringify(audit,null,2),{flag:'wx'});
  // Custom native filtering must retain the generic core/license/source hook.
  const mihomo=await installMihomo(context);
  await writeFile(path.join(output,'mihomo-package.json'),JSON.stringify(mihomo,null,2),{flag:'wx'});
  inspectWindowsPe(await readFile(path.join(context.appOutDir,'PetPal.exe')),arch);
};
config.directories.output = path.join(output, 'desktop');
let verifiedDefines = false;
await build({ projectDir: root, config, targets: Platform.WINDOWS.createTarget(['portable'], Arch[arch]),
  effectiveOptionComputed: async ([defines]) => {
    assert.equal(Object.hasOwn(defines, 'UNPACK_DIR_NAME'), false, 'Portable wrappers must use unique per-launch extraction directories.');
    assert.equal(defines.REQUEST_EXECUTION_LEVEL, 'user');
    assert.equal(defines.SPLASH_IMAGE, path.join(root, 'desktop/assets/startup.bmp'));
    verifiedDefines = true;
    await writeFile(path.join(output, 'portable-defines.json'), JSON.stringify({ version: metadata.version,arch,
      uniqueExtractionDirectory: true, executionLevel: 'user', splashImage: 'desktop/assets/startup.bmp' }, null, 2), { flag: 'wx' });
    return false;
  } });
assert.ok(verifiedDefines, 'Portable compile settings were not verified.');
const folder = `PetPal-${metadata.version}-Windows-${arch}`;
assert.ok(packagedApp,'Windows package staging was not verified.');
await cp(packagedApp, path.join(output, folder), { recursive: true, errorOnExist: true });
await writeFile(path.join(output, folder, 'START-HERE.txt'),
  `小伴 PetPal — Windows 10 / 11 ${arch}\r\n\r\n请把整个 ZIP 解压到本地文件夹，再双击 PetPal.exe。\r\n不要在压缩包内运行，也不要单独移动 PetPal.exe；旁边的 resources 等文件必须保留。\r\n无需安装 Node.js、Git、Codex 或 OpenCLI。登录账号后使用 Chat / Agent。\r\n内置 Mihomo 许可和对应源码位于 resources/mihomo。代理默认关闭，不修改系统代理。\r\n\r\n启动失败时请检查安全软件的隔离记录，并将提示中的启动日志交给维护者。\r\n下载来源：https://github.com/lixinyu02/petpal/releases\r\n`, { flag: 'wx' });
const cache = path.join(process.env.LOCALAPPDATA || '', 'electron-builder', 'Cache', '7zip@1.0.0');
let sevenZip;
for (const entry of await readdir(cache, { withFileTypes: true })) if (entry.isDirectory() && entry.name.startsWith('7zip-win-x64-')) sevenZip = path.join(cache, entry.name, 'bin', '7za.exe');
assert.ok(sevenZip, 'electron-builder 7za runtime is required.');
await run(sevenZip, ['a', '-tzip', '-mx=5', path.join(config.directories.output, `${folder}.zip`), folder], output);
console.log(JSON.stringify({ output, dist, exe: path.join(config.directories.output, `${folder}.exe`), zip: path.join(config.directories.output, `${folder}.zip`) }));
