import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { mkdir, lstat, realpath, open, unlink } from 'node:fs/promises';

export const IMAGE_LIMIT = 8 * 1024 * 1024;
export const IMAGE_COUNT = 4;
export const USER_IMAGE_LIMIT = 500 * 1024 * 1024;
export const USER_IMAGE_COUNT = 1000;
export const IMAGE_CONTEXT_COUNT = 16;
export const IMAGE_CONTEXT_LIMIT = 32 * 1024 * 1024;
const DIMENSION_LIMIT = 8192, PIXEL_LIMIT = 32 * 1024 * 1024;
const formats = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };
const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(value);
const failure = (status, message) => Object.assign(new Error(message), { status });
const invalid = () => failure(400, '图片格式损坏或与类型不符，请选择有效的 PNG、JPEG 或 WebP 图片。');
const dimensions = (width, height) => {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1 || width > DIMENSION_LIMIT || height > DIMENSION_LIMIT || width * height > PIXEL_LIMIT) throw failure(400, '图片尺寸须不超过 8192 像素，且总像素不超过 32MP。');
  return { width, height };
};
const crcTable = Array.from({ length: 256 }, (_, i) => { let value = i; for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1; return value >>> 0; });
const crc32 = bytes => { let crc = 0xffffffff; for (const byte of bytes) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8); return (crc ^ 0xffffffff) >>> 0; };

export function inspectImage(bytes, mimeType) {
  if (!formats[mimeType]) throw failure(415, '只支持 PNG、JPEG 和 WebP 图片。');
  if (!Buffer.isBuffer(bytes) || !bytes.length) throw invalid();
  if (bytes.length > IMAGE_LIMIT) throw failure(413, '每张图片不能超过 8 MiB。');
  let size;
  if (mimeType === 'image/png') {
    if (bytes.length < 45 || !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw invalid();
    let offset = 8, header = false, pixels = false, ended = false;
    while (offset + 12 <= bytes.length) {
      const length = bytes.readUInt32BE(offset), end = offset + 12 + length;
      if (end > bytes.length) throw invalid();
      const type = bytes.toString('ascii', offset + 4, offset + 8);
      if (!/^[a-zA-Z]{4}$/.test(type) || crc32(bytes.subarray(offset + 4, end - 4)) !== bytes.readUInt32BE(end - 4)) throw invalid();
      if (!header && type !== 'IHDR') throw invalid();
      if (type === 'IHDR') {
        if (header || length !== 13) throw invalid();
        size = dimensions(bytes.readUInt32BE(offset + 8), bytes.readUInt32BE(offset + 12)); header = true;
        const depth = bytes[offset + 16], color = bytes[offset + 17];
        if (!({ 0: [1, 2, 4, 8, 16], 2: [8, 16], 3: [1, 2, 4, 8], 4: [8, 16], 6: [8, 16] }[color]?.includes(depth)) || bytes[offset + 18] !== 0 || bytes[offset + 19] !== 0 || bytes[offset + 20] > 1) throw invalid();
      }
      if (type === 'IDAT' && length) pixels = true;
      if (type === 'IEND') { if (length || end !== bytes.length) throw invalid(); ended = true; break; }
      offset = end;
    }
    if (!header || !pixels || !ended) throw invalid();
  } else if (mimeType === 'image/jpeg') {
    if (bytes.length < 12 || bytes.readUInt16BE(0) !== 0xffd8) throw invalid();
    let offset = 2, scanned = false, ended = false;
    while (offset < bytes.length) {
      if (bytes[offset++] !== 0xff) throw invalid();
      while (bytes[offset] === 0xff) offset++;
      const marker = bytes[offset++];
      if (marker === 0xd9) { ended = offset === bytes.length; break; }
      if (marker === 0x00 || marker === 0xd8 || marker === undefined) throw invalid();
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
      if (offset + 2 > bytes.length) throw invalid();
      const length = bytes.readUInt16BE(offset), end = offset + length;
      if (length < 2 || end > bytes.length) throw invalid();
      if ([0xc0, 0xc1, 0xc2].includes(marker)) {
        if (length < 8 || size) throw invalid();
        size = dimensions(bytes.readUInt16BE(offset + 5), bytes.readUInt16BE(offset + 3));
      }
      offset = end;
      if (marker === 0xda) {
        if (!size) throw invalid(); scanned = true;
        while (offset < bytes.length) {
          if (bytes[offset] !== 0xff) { offset++; continue; }
          const next = bytes[offset + 1];
          if (next === 0 || (next >= 0xd0 && next <= 0xd7)) { offset += 2; continue; }
          break;
        }
      }
    }
    if (!size || !scanned || !ended) throw invalid();
  } else {
    if (bytes.length < 26 || bytes.toString('ascii', 0, 4) !== 'RIFF' || bytes.toString('ascii', 8, 12) !== 'WEBP' || bytes.readUInt32LE(4) + 8 !== bytes.length) throw invalid();
    let offset = 12, pixels = false;
    while (offset + 8 <= bytes.length) {
      const type = bytes.toString('ascii', offset, offset + 4), length = bytes.readUInt32LE(offset + 4), start = offset + 8, end = start + length;
      if (end > bytes.length) throw invalid();
      let frame;
      if (type === 'VP8X') {
        if (size || length !== 10 || (bytes[start] & 2)) throw invalid();
        size = dimensions(bytes.readUIntLE(start + 4, 3) + 1, bytes.readUIntLE(start + 7, 3) + 1);
      } else if (type === 'VP8 ') {
        if (pixels || length < 10 || (bytes[start] & 1) || !bytes.subarray(start + 3, start + 6).equals(Buffer.from([0x9d, 0x01, 0x2a]))) throw invalid();
        frame = dimensions(bytes.readUInt16LE(start + 6) & 0x3fff, bytes.readUInt16LE(start + 8) & 0x3fff);
      } else if (type === 'VP8L') {
        if (pixels || length < 5 || bytes[start] !== 0x2f) throw invalid();
        const bits = bytes.readUInt32LE(start + 1); if (bits >>> 29) throw invalid();
        frame = dimensions((bits & 0x3fff) + 1, ((bits >>> 14) & 0x3fff) + 1);
      } else if (['ANIM', 'ANMF'].includes(type)) throw invalid();
      if (frame) { if (size && (size.width !== frame.width || size.height !== frame.height)) throw invalid(); size = frame; pixels = true; }
      offset = end + (length & 1);
    }
    if (!pixels || offset !== bytes.length) throw invalid();
  }
  return { mimeType, size: bytes.length, ...size };
}

export function normalizeAttachmentIds(value = []) {
  if (!Array.isArray(value) || value.length > IMAGE_COUNT || value.some(id => !uuid(id)) || new Set(value).size !== value.length) throw failure(400, '每条消息最多携带 4 张不重复的已上传图片。');
  return [...value];
}
export const publicAttachment = record => ({ id: record.id, mimeType: record.mimeType, name: `图片.${formats[record.mimeType]}`, size: record.size, width: record.width, height: record.height });

export function validateStoredAttachments(state) {
  if (state.attachments === undefined) { state.attachments = []; return true; }
  if (!Array.isArray(state.attachments) || state.attachments.length > state.users.length * USER_IMAGE_COUNT) throw new Error('本地图片索引损坏，请保留数据并检查备份。');
  const ids = new Set(), quotas = new Map();
  for (const record of state.attachments) {
    if (!record || typeof record !== 'object' || !uuid(record.id) || ids.has(record.id) || !state.users.some(user => user.id === record.userId) || !formats[record.mimeType] || !Number.isSafeInteger(record.size) || record.size < 1 || record.size > IMAGE_LIMIT || typeof record.createdAt !== 'string' || Object.keys(record).some(key => !['id', 'userId', 'mimeType', 'size', 'width', 'height', 'createdAt'].includes(key))) throw new Error('本地图片归属或元数据无效。');
    dimensions(record.width, record.height); ids.add(record.id);
    const quota = quotas.get(record.userId) ?? { count: 0, bytes: 0 }; quota.count++; quota.bytes += record.size; quotas.set(record.userId, quota);
    if (quota.count > USER_IMAGE_COUNT || quota.bytes > USER_IMAGE_LIMIT) throw new Error('本地图片索引超过用户限额。');
  }
  return false;
}

export async function createAttachmentService({ store, dataDir }) {
  const root = path.resolve(dataDir, 'attachments');
  await mkdir(root, { recursive: true, mode: 0o700 });
  if ((await lstat(root)).isSymbolicLink() || !(await lstat(root)).isDirectory()) throw new Error('图片目录不能是符号链接。');
  const canonical = await realpath(root), uploading = new Map();
  const get = (userId, id) => { const record = uuid(id) && store.state.attachments.find(item => item.id === id && item.userId === userId); if (!record) throw failure(404, '图片不存在或不属于当前账号。'); return record; };
  const owned = (userId, ids) => normalizeAttachmentIds(ids).map(id => get(userId, id));
  const context = (userId, messages) => {
    let count = 0, bytes = 0;
    for (const message of messages) for (const record of owned(userId, message.attachmentIds)) {
      count++; bytes += record.size;
      if (count > IMAGE_CONTEXT_COUNT || bytes > IMAGE_CONTEXT_LIMIT) throw failure(400, '此会话图片上下文超过 16 张或 32 MiB，请新建会话。');
    }
  };
  const quota = userId => store.state.attachments.filter(item => item.userId === userId).reduce((value, item) => ({ count: value.count + 1, bytes: value.bytes + item.size }), { count: 0, bytes: 0 });
  const begin = userId => {
    const pending = uploading.get(userId) ?? 0, used = quota(userId);
    if (pending >= 2) throw failure(429, '同时最多上传 2 张图片，请稍后重试。');
    if (used.count + pending >= USER_IMAGE_COUNT || used.bytes + pending * IMAGE_LIMIT >= USER_IMAGE_LIMIT) throw failure(413, '此账号已达到 1000 张或 500 MiB 图片存储限额。');
    uploading.set(userId, pending + 1); let ended = false;
    return () => { if (!ended) { ended = true; uploading.set(userId, Math.max(0, (uploading.get(userId) ?? 1) - 1)); } };
  };
  const location = record => path.join(canonical, `${record.id}.${formats[record.mimeType]}`);
  const read = async (userId, id) => {
    const record = get(userId, id), filename = location(record);
    let handle;
    try {
      if ((await lstat(root)).isSymbolicLink() || await realpath(root) !== canonical || (await lstat(filename)).isSymbolicLink() || await realpath(filename) !== filename) throw failure(409, '图片文件已变化，请重新上传。');
      handle = await open(filename, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
      const stat = await handle.stat(); if (!stat.isFile() || stat.nlink !== 1 || stat.size !== record.size) throw failure(409, '图片文件已变化，请重新上传。');
      const buffer = Buffer.alloc(record.size + 1); let offset = 0;
      while (offset < buffer.length) { const result = await handle.read(buffer, offset, buffer.length - offset, offset); if (!result.bytesRead) break; offset += result.bytesRead; }
      if (offset !== record.size) throw failure(409, '图片文件长度已变化，请重新上传。');
      const bytes = buffer.subarray(0, offset); const actual = inspectImage(bytes, record.mimeType);
      if (actual.width !== record.width || actual.height !== record.height) throw failure(409, '图片尺寸与索引不符，请重新上传。');
      return { record, bytes, path: filename };
    } catch (error) { if (error.status) throw error; throw failure(409, '图片文件不可用，请重新上传。'); }
    finally { await handle?.close(); }
  };
  return {
    begin, context, metadata: (userId, ids) => owned(userId, ids).map(publicAttachment),
    async upload(userId, bytes, mimeType, authorize) {
      const metadata = inspectImage(bytes, mimeType), used = quota(userId);
      if (used.count >= USER_IMAGE_COUNT || used.bytes + bytes.length > USER_IMAGE_LIMIT) throw failure(413, '此账号已达到图片存储限额。');
      authorize(); const record = { id: randomUUID(), userId, ...metadata, createdAt: new Date().toISOString() }, filename = location(record);
      if ((await lstat(root)).isSymbolicLink() || await realpath(root) !== canonical) throw failure(409, '图片目录已变化。');
      let handle, retained = false;
      try {
        handle = await open(filename, 'wx', 0o600); await handle.writeFile(bytes); await handle.sync(); await handle.close(); handle = null;
        authorize(); const current = quota(userId);
        if (current.count >= USER_IMAGE_COUNT || current.bytes + bytes.length > USER_IMAGE_LIMIT) throw failure(413, '此账号已达到图片存储限额。');
        store.state.attachments.push(record); await store.save(); authorize(); retained = true; return publicAttachment(record);
      } finally {
        await handle?.close();
        if (!retained) { store.state.attachments = store.state.attachments.filter(item => item.id !== record.id); await unlink(filename).catch(() => {}); await store.save(); }
      }
    },
    read,
    async images(userId, ids) { return Promise.all(owned(userId, ids).map(async record => ({ path: (await read(userId, record.id)).path }))); },
    async messages(userId, messages) {
      context(userId, messages); const result = [], cache = new Map();
      for (const message of messages) {
        const images = [];
        for (const record of owned(userId, message.attachmentIds)) {
          if (!cache.has(record.id)) cache.set(record.id, `data:${record.mimeType};base64,${(await read(userId, record.id)).bytes.toString('base64')}`);
          images.push({ dataUrl: cache.get(record.id) });
        }
        result.push({ ...message, ...(images.length ? { images } : {}) });
      }
      return result;
    },
  };
}
