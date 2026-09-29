const FRAME_LIMIT = 2 * 1024 * 1024, OUTPUT_LIMIT = 24 * 1024 * 1024;
const invalid = () => new Error('中央模型流不完整或格式无效。');
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const textualDeltas = new Set([
  'response.output_text.delta', 'response.refusal.delta',
  'response.function_call_arguments.delta', 'response.custom_tool_call_input.delta',
  'response.reasoning_text.delta', 'response.reasoning_summary_text.delta',
]);
const scopeKeys = ['response_id', 'item_id', 'output_index', 'content_index', 'summary_index'];
const terminalTypes = new Set(['response.completed', 'response.failed', 'response.incomplete', 'error']);

/**
 * Remove the central credential before SSE leaves the central service.
 * Each text stream retains only a possible credential-prefix suffix. Its last
 * frame stays private until that suffix resolves; delayed bytes fill that same
 * frame, preserving original event/sequence order without synthetic events.
 */
export function createExecutorRelayRedactor({ secret = '', maxFrameBytes = FRAME_LIMIT, maxOutputBytes = OUTPUT_LIMIT } = {}) {
  if (typeof secret !== 'string' || secret.length > 8192 || !Number.isSafeInteger(maxFrameBytes) || maxFrameBytes < 1 || maxFrameBytes > FRAME_LIMIT || !Number.isSafeInteger(maxOutputBytes) || maxOutputBytes < 1 || maxOutputBytes > OUTPUT_LIMIT) throw invalid();
  let mask = '[已隐藏]';
  if ([...mask].some(character => secret.includes(character))) {
    // A marker containing a credential character could recreate a short secret
    // against adjacent output. Use a character absent from the credential.
    let point = 0xe000;
    while (secret.includes(String.fromCodePoint(point))) point++;
    mask = String.fromCodePoint(point).repeat(3);
  }
  const scrub = text => secret ? text.split(secret).join(mask) : text;
  const clean = (value, depth = 0) => {
    if (depth > 64) throw invalid();
    if (typeof value === 'string') return scrub(value);
    if (Array.isArray(value)) return value.map(item => clean(item, depth + 1));
    if (object(value)) return Object.fromEntries(Object.entries(value).map(([key, item]) => [scrub(key), clean(item, depth + 1)]));
    return value;
  };
  const prefix = new Uint16Array(secret.length);
  for (let i = 1, matched = 0; i < secret.length; i++) {
    while (matched && secret[i] !== secret[matched]) matched = prefix[matched - 1];
    if (secret[i] === secret[matched]) matched++;
    prefix[i] = matched;
  }
  const tailLength = text => {
    if (!secret) return 0;
    let matched = 0;
    // A possible prefix can occupy at most secret.length - 1 code units.
    for (let i = Math.max(0, text.length - secret.length + 1); i < text.length; i++) {
      while (matched && text[i] !== secret[matched]) matched = prefix[matched - 1];
      if (text[i] === secret[matched]) matched++;
      if (matched === secret.length) matched = prefix[matched - 1];
    }
    return matched;
  };
  const streams = new Map(), items = new Map(), decoder = new TextDecoder('utf-8', { fatal: true });
  let responseId;
  let pending = '', queue = [], cursor = 0, inputBytes = 0, outputBytes = 0, count = 0, terminal = false, doneMarker = false, finished = false;
  const render = frame => {
    if (!frame.value) return frame.lines.map(scrub).join('\n') + '\n\n';
    let data = false;
    return frame.lines.flatMap(line => {
      if (!line.startsWith('data:')) return [scrub(line)];
      if (data) return []; data = true;
      return [`data: ${JSON.stringify(frame.value)}`];
    }).join('\n') + '\n\n';
  };
  const drain = () => {
    const result = [];
    while (cursor < queue.length && queue[cursor].ready) {
      const encoded = render(queue[cursor]), bytes = Buffer.byteLength(encoded);
      if (bytes > maxFrameBytes || outputBytes + bytes > maxOutputBytes) throw invalid();
      outputBytes += bytes; cursor++; result.push(encoded);
    }
    if (cursor === queue.length) { queue = []; cursor = 0; }
    else if (cursor > 1024) { queue = queue.slice(cursor); cursor = 0; }
    return result;
  };
  const identity = value => {
    const scope = Object.fromEntries(scopeKeys.filter(key => value[key] !== undefined).map(key => [key, value[key]]));
    if (scope.item_id === undefined || scope.output_index === undefined) throw invalid();
    for (const [key, item] of Object.entries(scope)) {
      if (key.endsWith('_index')) { if (!Number.isSafeInteger(item) || item < 0 || item >= 512) throw invalid(); }
      else if (typeof item !== 'string' || !item || item.length > 256 || /[\x00-\x1f\x7f]/.test(item)) throw invalid();
    }
    if (scope.response_id !== undefined) {
      if (responseId !== undefined && responseId !== scope.response_id) throw invalid();
      responseId = scope.response_id;
    }
    if (items.has(scope.output_index) && items.get(scope.output_index) !== scope.item_id) throw invalid();
    items.set(scope.output_index, scope.item_id);
    // Optional response IDs and unrelated extension indices must not split a
    // semantic stream, otherwise a credential can straddle two aliases.
    const partKey = value.type === 'response.reasoning_summary_text.delta' ? 'summary_index'
      : ['response.output_text.delta', 'response.refusal.delta', 'response.reasoning_text.delta'].includes(value.type) ? 'content_index' : null;
    if (partKey && scope[partKey] === undefined) throw invalid();
    return { scope, key: JSON.stringify([value.type, scope.output_index, partKey ? scope[partKey] : null]) };
  };
  const flush = stream => {
    if (stream.frame) { stream.frame.value.delta += stream.tail; stream.frame.ready = true; stream.frame = null; }
    stream.tail = ''; stream.closed = true;
  };
  const endStreams = value => {
    if (terminalTypes.has(value.type) || value.type === 'response.done') { for (const stream of streams.values()) flush(stream); return; }
    if (!value.type.endsWith('.done')) return;
    const itemId = value.item_id ?? value.item?.id;
    const candidates = { ...Object.fromEntries(scopeKeys.filter(key => value[key] !== undefined).map(key => [key, value[key]])), ...(itemId !== undefined ? { item_id: itemId } : {}) };
    if (candidates.item_id === undefined && candidates.output_index === undefined) return;
    const correspondingDelta = value.type.slice(0, -5) + '.delta';
    const aggregate = ['response.output_item.done', 'response.content_part.done', 'response.reasoning_summary_part.done'].includes(value.type);
    for (const stream of streams.values()) {
      if (!aggregate && stream.type !== correspondingDelta) continue;
      const entries = Object.entries(candidates);
      if (entries.every(([key, item]) => stream.scope[key] === undefined || stream.scope[key] === item) &&
          entries.some(([key, item]) => (key === 'item_id' || key === 'output_index') && stream.scope[key] === item)) flush(stream);
    }
  };
  const consume = raw => {
    if (++count > 100000) throw invalid();
    const lines = raw.split(/\r?\n/), data = [], events = [];
    for (const line of lines) {
      if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''));
      else if (line.startsWith('event:')) events.push(line.slice(6).trim());
    }
    const frame = { lines, value: null, ready: true };
    if (!data.length) { queue.push(frame); return; }
    const text = data.join('\n');
    if (text === '[DONE]') {
      if (!terminal || doneMarker) throw invalid();
      doneMarker = true; queue.push(frame); return;
    }
    if (doneMarker) throw invalid();
    let value; try { value = JSON.parse(text); } catch { throw invalid(); }
    if (!object(value) || typeof value.type !== 'string' || !value.type || value.type.length > 100 || events.length > 1 || events.length === 1 && events[0] !== value.type) throw invalid();
    if (terminal && value.type !== 'response.done') throw invalid();
    if (value.type === 'response.done' && !terminal) throw invalid();
    frame.value = clean(value); queue.push(frame);
    if (textualDeltas.has(value.type)) {
      if (typeof value.delta !== 'string') throw invalid();
      const { key, scope } = identity(value);
      let stream = streams.get(key);
      if (!stream) {
        if (streams.size >= 512) throw invalid();
        stream = { scope, type: value.type, tail: '', frame: null, closed: false }; streams.set(key, stream);
      }
      if (stream.closed) throw invalid();
      const safe = scrub(stream.tail + value.delta), retained = tailLength(safe), output = safe.slice(0, safe.length - retained);
      frame.value.delta = '';
      if (stream.frame) { stream.frame.value.delta += output; stream.frame.ready = true; }
      else frame.value.delta = output;
      stream.tail = retained ? safe.slice(-retained) : '';
      frame.ready = !retained; stream.frame = retained ? frame : null;
    } else {
      endStreams(value);
      if (terminalTypes.has(value.type)) terminal = true;
    }
  };
  return {
    push(bytes) {
      if (finished || !(bytes instanceof Uint8Array) || (inputBytes += bytes.byteLength) > maxOutputBytes) throw invalid();
      try { pending += decoder.decode(bytes, { stream: true }); } catch { throw invalid(); }
      const output = [];
      for (;;) {
        const boundary = /\r?\n\r?\n/.exec(pending); if (!boundary) break;
        const size = boundary.index + boundary[0].length;
        if (Buffer.byteLength(pending.slice(0, size)) > maxFrameBytes) throw invalid();
        const raw = pending.slice(0, boundary.index); pending = pending.slice(size);
        consume(raw); output.push(...drain());
      }
      if (Buffer.byteLength(pending) > maxFrameBytes) throw invalid();
      return output;
    },
    finish() {
      if (finished) throw invalid(); finished = true;
      try { pending += decoder.decode(); } catch { throw invalid(); }
      if (pending.trim() || !terminal) throw invalid();
      for (const stream of streams.values()) flush(stream);
      const output = drain();
      if (cursor !== queue.length) throw invalid();
      return output;
    },
  };
}
