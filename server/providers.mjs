const MAX_FRAME_BYTES = 2 * 1024 * 1024;
const MAX_OUTPUT_CHARS = 2 * 1024 * 1024;

export const REASONING_EFFORTS = Object.freeze(['', 'none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra']);
export function normalizeReasoningEffort(value) {
  if (value === undefined) return '';
  if (typeof value !== 'string' || !REASONING_EFFORTS.includes(value)) throw new Error('推理强度须为服务默认值或 none、minimal、low、medium、high、xhigh、max、ultra。');
  return value;
}

export function normalizeBaseUrl(value, protocol) {
  let url;
  try { url = new URL(value); } catch { throw new Error('请输入完整的模型服务 URL。'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.hash || url.search) throw new Error('模型 URL 只支持 HTTP/HTTPS，不可包含用户名、密码、查询参数或片段。');
  const endpoint = protocol === 'responses' ? '/responses' : '/chat/completions';
  let base = url.pathname.replace(/\/+$/, '');
  if (base.endsWith('/chat/completions') || base.endsWith('/responses')) base = base.replace(/\/(?:chat\/completions|responses)$/, '');
  url.pathname = base || '/';
  return url.toString().replace(/\/$/, '');
}

function endpointFor(provider) {
  return `${normalizeBaseUrl(provider.baseUrl, provider.protocol)}${provider.protocol === 'responses' ? '/responses' : '/chat/completions'}`;
}

function safeMessage(value, provider) {
  let message = typeof value === 'string' ? value : '模型服务返回了未知错误。';
  if (provider.apiKey) message = message.split(provider.apiKey).join('[redacted]');
  return message.slice(0, 500);
}

function responseText(data) {
  if (typeof data.output_text === 'string') return data.output_text;
  return (data.output ?? []).filter(item => item.type === 'message').flatMap(item => item.content ?? [])
    .filter(item => ['output_text', 'refusal'].includes(item.type)).map(item => item.text ?? item.refusal ?? '').join('');
}

async function* parseEvents(body, signal) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let lines = [];
  let eventBytes = 0;
  const parse = () => {
    let event = 'message'; const data = [];
    for (const line of lines) {
      if (line.startsWith('event:')) event = line.slice(6).trim();
      if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''));
    }
    lines = []; eventBytes = 0;
    return data.length ? { event, data: data.join('\n') } : null;
  };
  try {
    while (true) {
      signal.throwIfAborted();
      const { value, done } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      if (buffer.length > MAX_FRAME_BYTES) throw new Error('模型流事件超过大小限制。');
      let position;
      while ((position = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, position).replace(/\r$/, ''); buffer = buffer.slice(position + 1);
        if (!line) { const parsed = parse(); if (parsed) yield parsed; }
        else { lines.push(line); eventBytes += line.length; if (eventBytes > MAX_FRAME_BYTES) throw new Error('模型流事件超过大小限制。'); }
      }
      if (done) {
        // A missing final blank line is valid if the event itself is complete.
        if (buffer) lines.push(buffer.replace(/\r$/, ''));
        const parsed = parse(); if (parsed) yield parsed;
        break;
      }
    }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}

async function boundedJson(response) {
  const length = Number(response.headers.get('content-length'));
  if (length > MAX_FRAME_BYTES) throw new Error('模型响应超过大小限制。');
  let bytes = 0; const chunks = [];
  if (!response.body) throw new Error('模型服务返回空响应。');
  for await (const chunk of response.body) { bytes += chunk.byteLength; if (bytes > MAX_FRAME_BYTES) throw new Error('模型响应超过大小限制。'); chunks.push(chunk); }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new Error('模型服务没有返回有效 JSON。'); }
}

/** Stream one real provider request. Never fabricate completion on EOF. */
export async function streamProvider({ provider, messages, persona = '', signal, onEvent, timeoutMs = 600000 }) {
  const timeout = AbortSignal.timeout(timeoutMs);
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
  const history = messages.filter(message => ['user', 'assistant'].includes(message.role) && message.content).map(({ role, content }) => ({ role, content }));
  const reasoningEffort = normalizeReasoningEffort(provider.reasoningEffort);
  const body = provider.protocol === 'responses'
    ? { model: provider.model, instructions: persona || undefined, input: history, stream: true, store: false, ...(reasoningEffort ? { reasoning: { effort: reasoningEffort } } : {}) }
    : { model: provider.model, messages: [...(persona ? [{ role: 'system', content: persona }] : []), ...history], stream: true, ...(reasoningEffort ? { reasoning_effort: reasoningEffort } : {}) };
  const headers = { 'Content-Type': 'application/json', Accept: 'text/event-stream, application/json' };
  if (provider.apiKey) headers.Authorization = `Bearer ${provider.apiKey}`;
  let response;
  try { response = await fetch(endpointFor(provider), { method: 'POST', headers, body: JSON.stringify(body), signal: combined, redirect: 'error' }); }
  catch (error) {
    if (combined.aborted) throw combined.reason;
    throw new Error(`无法连接模型服务：${safeMessage(error.message, provider)}。请检查 URL、网络和 TLS 证书。`);
  }
  if (!response.ok) {
    let detail = '';
    try { const data = await boundedJson(response); detail = safeMessage(data.error?.message ?? data.message ?? '', provider); } catch {}
    throw new Error(`模型服务 HTTP ${response.status}${detail ? `：${detail}` : '。请检查地址、密钥和模型权限。'}`);
  }
  let text = ''; let completed = false;
  const emit = chunk => {
    if (!chunk) return;
    if (typeof chunk !== 'string') throw new Error('模型服务文本字段格式无效。');
    if (text.length + chunk.length > MAX_OUTPUT_CHARS) throw new Error('模型回复超过 2 MiB 限制。');
    text += chunk; onEvent?.('delta', { text: chunk });
  };
  if (!(response.headers.get('content-type') ?? '').includes('text/event-stream')) {
    const data = await boundedJson(response);
    if (data.error) throw new Error(safeMessage(data.error.message, provider));
    if (provider.protocol === 'responses') {
      if (data.status && data.status !== 'completed') throw new Error(`模型响应未完成（${safeMessage(data.status, provider)}）。`);
      emit(responseText(data));
    } else {
      const choice = data.choices?.[0];
      if (!choice || !choice.message) throw new Error('Chat Completions 响应中缺少消息。');
      emit(choice.message.content ?? choice.message.refusal ?? '');
      if (choice.finish_reason === 'length') onEvent?.('status', { message: '模型达到输出长度限制。' });
    }
    if (!text) throw new Error('模型服务没有返回可显示的文本。');
    return { text };
  }
  if (!response.body) throw new Error('模型服务返回空响应流。');
  for await (const frame of parseEvents(response.body, combined)) {
    if (frame.data === '[DONE]') {
      if (provider.protocol === 'responses' && !completed) throw new Error('Responses 流在 response.completed 前结束。');
      completed = true; break;
    }
    let data;
    try { data = JSON.parse(frame.data); } catch { throw new Error('模型服务返回了无效的流式 JSON。'); }
    if (data.error || frame.event === 'error') throw new Error(safeMessage(data.error?.message ?? data.message, provider));
    if (provider.protocol === 'responses') {
      const type = data.type ?? frame.event;
      if (type === 'response.output_text.delta') emit(data.delta);
      else if (type === 'response.refusal.delta') emit(data.delta);
      else if (type === 'response.completed') { if (!text) emit(responseText(data.response ?? {})); completed = true; break; }
      else if (['response.failed', 'response.incomplete', 'response.cancelled'].includes(type)) {
        throw new Error(safeMessage(data.response?.error?.message ?? `模型响应未完成（${data.response?.incomplete_details?.reason ?? type}）。`, provider));
      }
    } else {
      const choice = data.choices?.[0];
      if (choice) {
        emit(choice.delta?.content ?? choice.delta?.refusal ?? '');
        if (choice.finish_reason) {
          completed = true;
          if (choice.finish_reason === 'length') onEvent?.('status', { message: '模型达到输出长度限制。' });
          if (choice.finish_reason === 'tool_calls' && !text) throw new Error('该模型返回工具调用；聊天模式当前只支持文本回复。');
        }
      }
    }
  }
  if (!completed) throw new Error('模型连接提前结束，回复未完成。请检查网络后重试。');
  if (!text) throw new Error('模型服务没有返回可显示的文本。');
  return { text };
}

export async function testProvider(provider, signal) {
  await streamProvider({ provider, messages: [{ role: 'user', content: 'Reply with OK only.' }], signal, timeoutMs: 20000 });
  return { ok: true, message: '连接成功，已收到模型的实际回复。' };
}
