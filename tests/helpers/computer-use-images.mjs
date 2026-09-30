import { deflateSync } from 'node:zlib';

export function computerUsePng(paddingBytes = 0) {
  const chunk = (name, data) => {
    const result = Buffer.alloc(12 + data.length); result.writeUInt32BE(data.length); result.write(name, 4); data.copy(result, 8);
    let crc = 0xffffffff;
    for (const byte of result.subarray(4, -4)) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1; }
    result.writeUInt32BE((crc ^ 0xffffffff) >>> 0, result.length - 4); return result;
  };
  const header = Buffer.alloc(13); header.writeUInt32BE(1); header.writeUInt32BE(1, 4); header[8] = 8; header[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(Buffer.from([0, 255, 0, 0, 255]))), ...(paddingBytes ? [chunk('tEXt', Buffer.alloc(paddingBytes))] : []), chunk('IEND', Buffer.alloc(0))]);
}

export const computerUseImage = (bytes = computerUsePng(), mimeType = 'image/png') => ({ type: 'image', mimeType, data: bytes.toString('base64') });
