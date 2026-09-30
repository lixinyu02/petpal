import { inspectImage } from './attachments.mjs';

export const COMPUTER_USE_IMAGE_COUNT = 2;
export const COMPUTER_USE_IMAGE_BYTES = 2 * 1024 * 1024;
export const COMPUTER_USE_TOTAL_IMAGE_BYTES = 3 * 1024 * 1024;
export const DYNAMIC_TOOL_TEXT_BYTES = 64 * 1024;
const MAX_CONTENT_BLOCKS = 128;
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const invalid = () => Object.assign(new Error('Computer Use 工具返回的文字或图片格式无效。'), { status: 502, code: 'invalid_output' });
const tooLarge = () => Object.assign(new Error('Computer Use 工具返回内容超过大小限制。'), { status: 502, code: 'output_limit' });

/** Retain only inline MCP text/images; never resolve URLs, files or resources. */
export function normalizeComputerUseContent(content) {
  if (!Array.isArray(content) || content.length > MAX_CONTENT_BLOCKS) throw invalid();
  let images = 0, imageBytes = 0, textBytes = 0;
  return content.map(item => {
    if (!object(item)) throw invalid();
    if (item.type === 'text') {
      if (typeof item.text !== 'string' || Object.keys(item).some(key => !['type', 'text', 'annotations', '_meta'].includes(key))) throw invalid();
      textBytes += Buffer.byteLength(item.text);
      if (textBytes > DYNAMIC_TOOL_TEXT_BYTES) throw tooLarge();
      return { type: 'text', text: item.text };
    }
    if (item.type !== 'image' || Object.keys(item).some(key => !['type', 'data', 'mimeType', 'annotations', '_meta'].includes(key)) ||
        !['image/png', 'image/jpeg'].includes(item.mimeType) || typeof item.data !== 'string' || !item.data) throw invalid();
    if (++images > COMPUTER_USE_IMAGE_COUNT || item.data.length > Math.ceil(COMPUTER_USE_IMAGE_BYTES / 3) * 4) throw tooLarge();
    // Buffer.from(base64) is permissive; require canonical padding and bytes.
    if (item.data.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(item.data)) throw invalid();
    const bytes = Buffer.from(item.data, 'base64');
    if (!bytes.length || bytes.toString('base64') !== item.data) throw invalid();
    imageBytes += bytes.length;
    if (bytes.length > COMPUTER_USE_IMAGE_BYTES || imageBytes > COMPUTER_USE_TOTAL_IMAGE_BYTES) throw tooLarge();
    // Includes PNG/JPEG magic, chunk/marker structure and bounded dimensions.
    try { inspectImage(bytes, item.mimeType); } catch { throw invalid(); }
    return { type: 'image', mimeType: item.mimeType, data: item.data };
  });
}

/** Convert trusted Computer Use MCP results to app-server multimodal output. */
export function dynamicToolContentItems(value, redact = text => text) {
  if (object(value) && value.kind === 'computer-use-mcp') {
    if (typeof value.ok !== 'boolean' || typeof value.tool !== 'string' || !value.tool || value.tool.length > 128 || /[\x00-\x1f\x7f]/.test(value.tool)) throw invalid();
    const content = normalizeComputerUseContent(value.content);
    const summary = redact(JSON.stringify({ ok: value.ok, tool: value.tool }));
    let textBytes = Buffer.byteLength(summary);
    const items = [{ type: 'inputText', text: summary }];
    for (const item of content) {
      if (item.type === 'text') {
        const text = redact(item.text); textBytes += Buffer.byteLength(text);
        if (textBytes > DYNAMIC_TOOL_TEXT_BYTES) throw tooLarge();
        items.push({ type: 'inputText', text });
      } else items.push({ type: 'inputImage', imageUrl: `data:${item.mimeType};base64,${item.data}` });
    }
    return items;
  }
  // Existing music/browser/error results keep their JSON text contract.
  const text = redact(JSON.stringify(value));
  if (text.length > DYNAMIC_TOOL_TEXT_BYTES) throw Object.assign(new Error('工具返回内容超过大小限制。'), { code: 'dynamic_output_limit' });
  return [{ type: 'inputText', text }];
}
