// Presentation data only. No model-provided HTML, code, URLs or host commands.
export const OPENUI_MESSAGE_LIMIT = 262144;
const interactiveModes = new Set(['auto', 'openui']);
export const isOpenUIMode = mode => interactiveModes.has(mode);

/** Only explicit fences opening at column zero activate UI. Indented/list,
 * quoted and outer-fence examples stay Markdown without loading a parser.
 * Raw HTML containers outside code conservatively keep the whole reply Markdown. */
export function splitOpenUI(value, { streaming = false } = {}) {
  const source = String(value ?? '');
  if (source.length > OPENUI_MESSAGE_LIMIT) return { parts: [], error: '交互内容过长，已显示原文。' };
  const parts = []; let prose = [], code = null, fence = '', ordinary = null;
  const flush = () => { if (prose.length) parts.push({ type: 'markdown', text: prose.join('\n') }); prose = []; };
  const closing = (line, token) => new RegExp(`^ {0,3}${token[0]}{${token.length},}\\s*$`).test(line);
  for (const line of source.split('\n')) {
    if (code !== null) {
      if (closing(line, fence)) { parts.push({ type: 'openui', text: code.join('\n'), closed: true }); code = null; }
      else code.push(line);
      continue;
    }
    if (ordinary) { prose.push(line); if (closing(line, ordinary)) ordinary = null; continue; }
    // Markdown HTML blocks can contain column-zero fences that are only text
    // (comments, pre/script/style, declarations and custom tags). Do not activate
    // an apparent UI inside them. Conservatively decline this mixed reply rather
    // than introducing a second Markdown parser into the initial app bundle.
    if (line.includes('<!--') || /^ {0,3}<(?:\?|!\[CDATA\[|![A-Z]|\/?[A-Za-z][\w:-]*(?:[\t />]|$))/.test(line)) {
      return { parts: [{ type: 'markdown', text: source }] };
    }
    const match = /^(`{3,}|~{3,})openui\s*$/.exec(line);
    if (match) { flush(); fence = match[1]; code = []; continue; }
    const other = /^ {0,3}(`{3,}|~{3,})/.exec(line);
    if (other) ordinary = other[1];
    prose.push(line);
  }
  if (code !== null) {
    if (!streaming) return { parts: [], error: '交互内容未生成完整，已显示原文。' };
    parts.push({ type: 'openui', text: code.join('\n'), closed: false });
  }
  flush();
  if (parts.filter(part => part.type === 'openui').length > 8) return { parts: [], error: '交互界面过多，已显示原文。' };
  return { parts };
}

/** Return bounded plain draft text. This function cannot dispatch a task. */
export function openUIActionText(event) {
  try {
    if (event?.type !== 'UseInPrompt' || !event.params || typeof event.params !== 'object' || Array.isArray(event.params)) return null;
    if (Object.keys(event.params).some(key => key !== 'text') || event.params.text !== undefined && typeof event.params.text !== 'string') return null;
    const form = event.formState ?? {};
    if (!form || typeof form !== 'object' || Array.isArray(form)) return null;
    let count = 0; const seen = new Set();
    const check = (value, depth = 0) => {
      if (++count > 1000 || depth > 12) throw new Error('limit');
      if (value === null || typeof value === 'boolean' || typeof value === 'number' && Number.isFinite(value)) return;
      if (typeof value === 'string') { if (value.length > 12000) throw new Error('limit'); return; }
      if (typeof value !== 'object' || seen.has(value)) throw new Error('invalid');
      seen.add(value);
      if (!Array.isArray(value) && ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw new Error('invalid');
      for (const [key, child] of Object.entries(value)) { if (['__proto__', 'constructor', 'prototype'].includes(key)) throw new Error('invalid'); check(child, depth + 1); }
    };
    check({ text: event.params.text ?? '', form });
    const encoded = JSON.stringify({ text: event.params.text ?? '', form });
    if (new TextEncoder().encode(encoded).length > 16384) return null;
    // The SDK stores unbound control values with component metadata. Only the
    // exact known scalar wrappers are presentation metadata; retain other data.
    const values = Object.fromEntries(Object.entries(form).map(([key, field]) => {
      const wrapper = field && typeof field === 'object' && !Array.isArray(field)
        && Object.keys(field).length === 2 && Object.hasOwn(field, 'value') && Object.hasOwn(field, 'componentType');
      const scalarField = wrapper && (field.componentType === 'Field' && (field.value === null || typeof field.value === 'string' || typeof field.value === 'number')
        || field.componentType === 'Select' && typeof field.value === 'string'
        || field.componentType === 'Checkbox' && typeof field.value === 'boolean');
      return [key, scalarField ? field.value : field];
    }));
    return [event.params.text?.trim(), Object.keys(values).length ? `表单内容：\n${JSON.stringify(values, null, 2)}` : ''].filter(Boolean).join('\n\n') || null;
  } catch { return null; }
}
