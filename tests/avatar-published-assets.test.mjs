import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {avatarImageUrl} from '../src/avatar/anime-resources.mjs';

const root=new URL('../',import.meta.url);
const names=['idle','blink','talk','round','curious','warm','sad','pout'];
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');

function losslessDimensions(bytes){
  assert.equal(bytes.toString('ascii',0,4),'RIFF');
  assert.equal(bytes.toString('ascii',8,12),'WEBP');
  assert.equal(bytes.readUInt32LE(4)+8,bytes.length,'complete WebP container');
  for(let offset=12;offset+8<=bytes.length;){
    const type=bytes.toString('ascii',offset,offset+4),length=bytes.readUInt32LE(offset+4),payload=offset+8;
    assert.ok(payload+length<=bytes.length,'complete WebP chunk');
    if(type==='VP8L'){
      assert.ok(length>=5);assert.equal(bytes[payload],0x2f);
      const header=bytes.readUInt32LE(payload+1);
      return {width:(header&0x3fff)+1,height:((header>>>14)&0x3fff)+1};
    }
    offset=payload+length+(length%2);
  }
  assert.fail('Missing lossless VP8L image');
}

test('all published portraits are complete lossless WebP files backed by original RGBA PNGs and audited hashes',async()=>{
  const manifest=JSON.parse(await readFile(new URL('public/avatars/akari/manifest.json',root),'utf8'));
  assert.deepEqual(manifest.entries.map(entry=>entry.name),names);
  assert.equal(manifest.format,'webp-lossless');
  let originalTotal=0,publishedTotal=0,decodedTotal=0;
  for(const entry of manifest.entries){
    const [original,published]=await Promise.all([
      readFile(new URL(`artwork/akari/${entry.name}.png`,root)),
      readFile(new URL(`public${avatarImageUrl(entry.name)}`,root)),
    ]);
    assert.deepEqual([...original.subarray(0,8)],[137,80,78,71,13,10,26,10]);
    assert.equal(original.readUInt32BE(16),1024);assert.equal(original.readUInt32BE(20),1536);
    assert.equal(original[24],8);assert.equal(original[25],6,'original retains eight-bit RGBA');
    assert.deepEqual(losslessDimensions(published),{width:entry.width,height:entry.height});
    assert.equal(sha(original),entry.originalSha256);assert.equal(sha(published),entry.publishedSha256);
    assert.equal(original.length,entry.originalBytes);assert.equal(published.length,entry.publishedBytes);
    assert.equal(entry.rgbaEqual,true);assert.match(entry.decodedRgbaSha256,/^[a-f0-9]{64}$/);
    originalTotal+=original.length;publishedTotal+=published.length;decodedTotal+=entry.width*entry.height*4;
  }
  assert.equal(originalTotal,manifest.originalTotalBytes);assert.equal(publishedTotal,manifest.publishedTotalBytes);
  assert.equal(decodedTotal,manifest.decodedRgbaTotalBytes);assert.ok(publishedTotal<originalTotal);
  assert.deepEqual((await readdir(new URL('public/avatars/akari/',root))).filter(name=>name.endsWith('.png')),[],'originals stay out of public and native bundles');
});
