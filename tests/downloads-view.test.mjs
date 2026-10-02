import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const bundle=await build({entryPoints:[fileURLToPath(new URL('../src/DownloadsView.tsx',import.meta.url))],bundle:true,write:false,format:'cjs',platform:'node',external:['react','react/jsx-runtime','react/jsx-dev-runtime'],loader:{'.css':'empty'}});
const compiled={exports:{}};new Function('require','module','exports',bundle.outputFiles[0].text)(createRequire(import.meta.url),compiled,compiled.exports);
const {latestStableDownloadPackages}=compiled.exports;
const item=(id,version,platform,extra={})=>({id,version,platform,channel:'stable',arch:platform==='android'?'universal':'x64',format:platform==='android'?'apk':'portable-zip',publishedAt:'2026-10-03T00:00:00Z',...extra});

test('the UI filters old mixed catalogs globally before grouping by platform, retaining latest architecture/format alternatives',()=>{
  const source=[item('old','0.9.99','ubuntu'),item('zip','0.10.0','windows',{publishedAt:'2026-01-01T00:00:00Z'}),item('exe','0.10.0','windows',{format:'portable-exe'}),item('arm','0.10.0','windows',{arch:'arm64'}),item('android','0.10.0','android')].map(Object.freeze);
  Object.freeze(source);
  const latest=latestStableDownloadPackages(source);
  assert.deepEqual(latest.map(value=>value.id),['zip','exe','arm','android']);
  assert.equal(latest.some(value=>value.platform==='ubuntu'),false,'no platform-specific historical fallback');
  assert.equal(source.length,5,'does not rewrite a cached response');
});

test('the UI rejects preview flags and semantic suffixes even when an older server calls them stable',()=>{
  const invalid=[item('flag','10.0.0','windows',{channel:'preview'}),...['3.0.0-rc.1','3.0.0-preview','3.0.0+build.1','03.0.0','v3.0.0'].map((version,index)=>item(String(index),version,'windows'))];
  assert.deepEqual(latestStableDownloadPackages(invalid),[]);
  const stable=item('stable','0.9.7','android');
  assert.deepEqual(latestStableDownloadPackages([...invalid,stable]),[stable]);
  assert.deepEqual(latestStableDownloadPackages([]),[]);
});
