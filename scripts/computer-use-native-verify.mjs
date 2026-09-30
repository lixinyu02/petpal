import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const invalid = () => new Error('Computer Use native ELF or provenance is invalid.');
const version = value => value.split('.').map(Number);
const newer = (a, b) => { const left = version(a), right = version(b); for (let i = 0; i < Math.max(left.length, right.length); i++) { if ((left[i] ?? 0) !== (right[i] ?? 0)) return (left[i] ?? 0) > (right[i] ?? 0); } return false; };

export function inspectComputerUseElf(bytes, { arch, maximumGlibc = '2.35', sha256 } = {}) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 64 || bytes.subarray(0, 4).toString('hex') !== '7f454c46' || bytes[4] !== 2 || bytes[5] !== 1 || bytes.readUInt16LE(16) !== 3) throw invalid();
  const machine = bytes.readUInt16LE(18), expected = { x64: 62, arm64: 183 }[arch];
  if (!expected || machine !== expected || !/^\d+\.\d+(?:\.\d+)?$/.test(maximumGlibc)) throw invalid();
  const digest = createHash('sha256').update(bytes).digest('hex'); if (sha256 !== undefined && digest !== sha256) throw invalid();
  const shoff = Number(bytes.readBigUInt64LE(40)), size = bytes.readUInt16LE(58), count = bytes.readUInt16LE(60), strings = bytes.readUInt16LE(62);
  if (!Number.isSafeInteger(shoff) || size < 64 || count < 1 || strings >= count || shoff + size * count > bytes.length) throw invalid();
  const sections = [];
  for (let index = 0; index < count; index++) {
    const offset = shoff + index * size, section = { nameIndex: bytes.readUInt32LE(offset), type: bytes.readUInt32LE(offset + 4), offset: Number(bytes.readBigUInt64LE(offset + 24)), size: Number(bytes.readBigUInt64LE(offset + 32)), link: bytes.readUInt32LE(offset + 40) };
    if (!Number.isSafeInteger(section.offset) || !Number.isSafeInteger(section.size) || section.offset < 0 || section.size < 0 || section.type !== 8 && section.offset + section.size > bytes.length) throw invalid(); sections.push(section);
  }
  const string = (section, offset) => {
    if (!section || !Number.isSafeInteger(offset) || offset < 0 || offset >= section.size) throw invalid();
    const start = section.offset + offset, end = bytes.indexOf(0, start); if (end < start || end >= section.offset + section.size) throw invalid(); return bytes.toString('utf8', start, end);
  };
  for (const section of sections) section.name = string(sections[strings], section.nameIndex);
  const needed = [], versions = [], requirements = sections.find(section => section.name === '.gnu.version_r'), dynamic = sections.find(section => section.name === '.dynamic');
  if (!requirements || !dynamic || dynamic.size % 16 !== 0) throw invalid();
  for (let offset = dynamic.offset; offset < dynamic.offset + dynamic.size; offset += 16) if (bytes.readBigInt64LE(offset) === 1n) needed.push(string(sections[dynamic.link], Number(bytes.readBigUInt64LE(offset + 8))));
  for (let offset = requirements.offset, records = 0; offset < requirements.offset + requirements.size;) {
    if (++records > 128 || offset + 16 > requirements.offset + requirements.size) throw invalid();
    const count = bytes.readUInt16LE(offset + 2), file = string(sections[requirements.link], bytes.readUInt32LE(offset + 4));
    let auxiliary = offset + bytes.readUInt32LE(offset + 8);
    if (count < 1 || count > 128) throw invalid();
    for (let index = 0; index < count; index++) {
      if (auxiliary < requirements.offset || auxiliary + 16 > requirements.offset + requirements.size) throw invalid();
      versions.push({ file, name: string(sections[requirements.link], bytes.readUInt32LE(auxiliary + 8)) });
      const next = bytes.readUInt32LE(auxiliary + 12); if (!next) { if (index !== count - 1) throw invalid(); break; } if (next < 16) throw invalid(); auxiliary += next;
    }
    const next = bytes.readUInt32LE(offset + 12); if (!next) break; if (next < 16) throw invalid(); offset += next;
  }
  const glibc = [...new Set(versions.map(item => /^GLIBC_(\d+\.\d+(?:\.\d+)?)$/.exec(item.name)?.[1]).filter(Boolean))].sort((a, b) => newer(a, b) ? 1 : newer(b, a) ? -1 : 0);
  if (!glibc.length || glibc.some(item => newer(item, maximumGlibc)) || versions.some(item => item.name === 'GLIBC_PRIVATE')) throw new Error(`Computer Use native requires glibc newer than ${maximumGlibc}.`);
  return { arch, machine, sha256: digest, bytes: bytes.length, needed, versions, requiredGlibc: glibc.at(-1), maximumGlibc };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [file, arch, maximumGlibc = '2.35', sha256] = process.argv.slice(2); if (!file || !arch) throw new Error('Usage: computer-use-native-verify.mjs FILE ARCH [MAX_GLIBC] [SHA256]');
  console.log(JSON.stringify(inspectComputerUseElf(await readFile(path.resolve(file)), { arch, maximumGlibc, sha256 }), null, 2));
}
