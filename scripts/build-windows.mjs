// Isolated Windows distribution: never replaces the backend's live dist folder.
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile, readdir, cp } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import {auditComputerUsePackage,filterComputerUseNative,COMPUTER_USE_PACKAGE,COMPUTER_USE_RUNTIME_FILES} from './computer-use-package.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const { build, Platform } = require('electron-builder');
const yaml = require('js-yaml');
if (process.platform !== 'win32') throw new Error('Build Windows distributions on Windows.');
const args = process.argv.slice(2);
if (args.length && (args.length !== 2 || args[0] !== '--out-dir')) throw new Error('Usage: node scripts/build-windows.mjs [--out-dir <new-directory>]');
const metadata = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
const computerUseSource=await auditComputerUsePackage(root,{platform:'win32',arch:'x64'});
const output = path.resolve(root, args[1] || `releases/windows-${metadata.version}`);
assert.ok(output.startsWith(root + path.sep) && output !== path.join(root, 'dist'), 'Output must be a fresh project subdirectory.');
await mkdir(output); // EEXIST protects previous releases/evidence.
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
config.afterPack = async context => {
  const unpacked=path.join(context.appOutDir,'resources','app.asar.unpacked');
  const packageDirectory=path.join(unpacked,COMPUTER_USE_PACKAGE);
  // Preserve exact package metadata and runtime/license members after builder
  // filtering, then retain only the target host's N-API module.
  for(const relative of COMPUTER_USE_RUNTIME_FILES){
    const target=path.join(packageDirectory,relative);await mkdir(path.dirname(target),{recursive:true});
    await cp(path.join(root,COMPUTER_USE_PACKAGE,relative),target);
  }
  await filterComputerUseNative(unpacked,{platform:'win32',arch:'x64'});
  const audit=await auditComputerUsePackage(unpacked,{platform:'win32',arch:'x64',expected:computerUseSource});
  await writeFile(path.join(output,'computer-use-package.json'),JSON.stringify(audit,null,2),{flag:'wx'});
};
config.directories.output = path.join(output, 'desktop');
let verifiedDefines = false;
await build({ projectDir: root, config, targets: Platform.WINDOWS.createTarget(['portable'], 1),
  effectiveOptionComputed: async ([defines]) => {
    assert.equal(Object.hasOwn(defines, 'UNPACK_DIR_NAME'), false, 'Portable wrappers must use unique per-launch extraction directories.');
    assert.equal(defines.REQUEST_EXECUTION_LEVEL, 'user');
    assert.equal(defines.SPLASH_IMAGE, path.join(root, 'desktop/assets/startup.bmp'));
    verifiedDefines = true;
    await writeFile(path.join(output, 'portable-defines.json'), JSON.stringify({ version: metadata.version,
      uniqueExtractionDirectory: true, executionLevel: 'user', splashImage: 'desktop/assets/startup.bmp' }, null, 2), { flag: 'wx' });
    return false;
  } });
assert.ok(verifiedDefines, 'Portable compile settings were not verified.');
const folder = `PetPal-${metadata.version}-Windows-x64`;
await cp(path.join(config.directories.output, 'win-unpacked'), path.join(output, folder), { recursive: true, errorOnExist: true });
await writeFile(path.join(output, folder, 'START-HERE.txt'),
  '小伴 PetPal — Windows 10 / 11 x64\r\n\r\n请把整个 ZIP 解压到本地文件夹，再双击 PetPal.exe。\r\n不要在压缩包内运行，也不要单独移动 PetPal.exe；旁边的 resources 等文件必须保留。\r\n无需安装 Node.js、Git、Codex 或 OpenCLI。登录账号后使用 Chat / Agent。\r\n\r\n启动失败时请检查安全软件的隔离记录，并将提示中的启动日志交给维护者。\r\n下载来源：https://github.com/lixinyu02/petpal/releases\r\n', { flag: 'wx' });
const cache = path.join(process.env.LOCALAPPDATA || '', 'electron-builder', 'Cache', '7zip@1.0.0');
let sevenZip;
for (const entry of await readdir(cache, { withFileTypes: true })) if (entry.isDirectory() && entry.name.startsWith('7zip-win-x64-')) sevenZip = path.join(cache, entry.name, 'bin', '7za.exe');
assert.ok(sevenZip, 'electron-builder 7za runtime is required.');
await run(sevenZip, ['a', '-tzip', '-mx=5', path.join(config.directories.output, `${folder}.zip`), folder], output);
console.log(JSON.stringify({ output, dist, exe: path.join(config.directories.output, `${folder}.exe`), zip: path.join(config.directories.output, `${folder}.zip`) }));
