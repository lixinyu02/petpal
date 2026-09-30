const MAX_FRAME_BYTES = 2 * 1024 * 1024;
const MAX_OUTPUT_CHARS = 2 * 1024 * 1024;

export const REASONING_EFFORTS = Object.freeze(['', 'none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra']);
export function normalizeSupportsImages(value, model = '') {
  if (value !== undefined && typeof value !== 'boolean') throw new Error('图片能力须为布尔值。');
  if (String(model).toLowerCase() === 'halogen-qwen3.8-flash-next') return false;
  return value ?? true;
}
export function assertImageSupport(provider, messages) {
  if (!normalizeSupportsImages(provider.supportsImages, provider.model) && messages.some(message => message.attachmentIds?.length || message.images?.length)) throw Object.assign(new Error('此模型仅支持文本，请选择支持图片的模型或新建纯文本会话。'), { status: 400 });
}
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
export async function streamProvider({ provider, messages, persona = '', signal, onEvent, onToolCall, timeoutMs = 600000 }) {
  const timeout = AbortSignal.timeout(timeoutMs);
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
  assertImageSupport(provider, messages);
  const history = messages.filter(message => ['user', 'assistant'].includes(message.role) && (message.content || message.images?.length)).map(({ role, content, images }) => {
    if (!images?.length) return { role, content };
    if (role !== 'user' || !Array.isArray(images) || images.length > 4 || images.some(image => typeof image.dataUrl !== 'string' || !/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/.test(image.dataUrl))) throw new Error('图片上下文格式无效。');
    return { role, content: provider.protocol === 'responses'
      ? [...(content ? [{ type: 'input_text', text: content }] : []), ...images.map(image => ({ type: 'input_image', image_url: image.dataUrl }))]
      : [...(content ? [{ type: 'text', text: content }] : []), ...images.map(image => ({ type: 'image_url', image_url: { url: image.dataUrl } }))] };
  });
  const reasoningEffort = normalizeReasoningEffort(provider.reasoningEffort);
  const body = provider.protocol === 'responses'
    ? { model: provider.model, instructions: persona || undefined, input: history, stream: true, store: false, ...(reasoningEffort ? { reasoning: { effort: reasoningEffort } } : {}) }
    : { model: provider.model, messages: [...(persona ? [{ role: 'system', content: persona }] : []), ...history], stream: true, ...(reasoningEffort ? { reasoning_effort: reasoningEffort } : {}) };
  if (onToolCall) {
    const definition = { name: 'run_agent', description: '将当前用户要求的电脑或软件操作派发给后台 Agent。执行电脑、模型和权限由用户预先设置；工具只接收具体任务。派发成功不代表任务已经完成。普通聊天、能力问答、否定或引用的指令不要派发。', parameters: { type: 'object', properties: { task: { type: 'string', description: '用户要求 Agent 完成的任务，保留目标软件、歌曲名称等必要信息。' } }, required: ['task'], additionalProperties: false }, strict: true };
    body.tools = [provider.protocol === 'responses' ? { type: 'function', ...definition } : { type: 'function', function: definition }];
    body.parallel_tool_calls = false;
    if (provider.protocol === 'responses') body.include = ['reasoning.encrypted_content'];
  }
  const first = await providerRequest({ provider, body, combined, onEvent });
  if (!first.calls.length) return { text: first.text };
  // Validate the whole completed response before any side effect. Neither
  // fragmented arguments nor a second/malformed call can partially dispatch.
  if (!onToolCall || first.calls.length !== 1) throw new Error('聊天模型返回了未授权或多个工具调用；没有派发 Agent。');
  const call = first.calls[0];
  if (call.name !== 'run_agent' || typeof call.id !== 'string' || !call.id || call.id.length > 200 || typeof call.arguments !== 'string' || call.arguments.length > 128000) throw new Error('Agent 工具调用格式无效；没有派发任务。');
  let args;
  try { args = JSON.parse(call.arguments); } catch { throw new Error('Agent 工具参数不是完整 JSON；没有派发任务。'); }
  if (!args || typeof args !== 'object' || Array.isArray(args) || Object.keys(args).length !== 1 || typeof args.task !== 'string' || !args.task.trim() || args.task.length > 32000) throw new Error('Agent 工具只接受有效的 task 文本；没有派发任务。');
  combined.throwIfAborted();
  const result = await onToolCall({ task: args.task.trim() });
  combined.throwIfAborted();
  const output = JSON.stringify(result);
  if (typeof output !== 'string' || output.length > 128000) throw new Error('Agent 派发回执格式无效。');
  onEvent?.('status', { message: '后台任务已提交，正在生成聊天回复。' });
  const next = provider.protocol === 'responses'
    ? { ...body, tool_choice: 'none', input: [...body.input, ...first.output, { type: 'function_call_output', call_id: call.id, output }] }
    : { ...body, tool_choice: 'none', messages: [...body.messages, { role: 'assistant', content: first.text || null, tool_calls: [{ id: call.id, type: 'function', function: { name: call.name, arguments: call.arguments } }] }, { role: 'tool', tool_call_id: call.id, content: output }] };
  const second = await providerRequest({ provider, body: next, combined, onEvent });
  if (second.calls.length) throw new Error('聊天模型重复请求工具调用，未重复派发任务。');
  return { text: first.text + second.text };
}

async function providerRequest({ provider, body, combined, onEvent }) {
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
  let text = ''; let completed = false; let output = []; let finishReason;
  const toolFragments = new Map();
  let calls = [];
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
      output = Array.isArray(data.output) ? data.output : [];
      calls = output.filter(item => item.type === 'function_call').map(item => ({ id: item.call_id, name: item.name, arguments: item.arguments }));
      if (calls.length && data.status !== 'completed') throw new Error('模型工具响应未完成，没有派发任务。');
    } else {
      const choice = data.choices?.[0];
      if (!choice || !choice.message) throw new Error('Chat Completions 响应中缺少消息。');
      emit(choice.message.content ?? choice.message.refusal ?? '');
      finishReason = choice.finish_reason;
      if (choice.message.tool_calls !== undefined && !Array.isArray(choice.message.tool_calls)) throw new Error('模型工具调用格式无效。');
      calls = (choice.message.tool_calls ?? []).map(item => ({ id: item.id, name: item.function?.name, arguments: item.function?.arguments }));
      if (choice.finish_reason === 'length') onEvent?.('status', { message: '模型达到输出长度限制。' });
    }
    if (calls.length && provider.protocol !== 'responses' && finishReason !== 'tool_calls') throw new Error('模型工具响应未完成，没有派发任务。');
    if (!text && !calls.length) throw new Error('模型服务没有返回可显示的文本。');
    return { text, calls, output };
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
      else if (type === 'response.completed') {
        if (data.response?.status && data.response.status !== 'completed') throw new Error('模型工具响应未完成，没有派发任务。');
        if (!text) emit(responseText(data.response ?? {}));
        output = Array.isArray(data.response?.output) ? data.response.output : [];
        calls = output.filter(item => item.type === 'function_call').map(item => ({ id: item.call_id, name: item.name, arguments: item.arguments }));
        completed = true; break;
      }
      else if (['response.failed', 'response.incomplete', 'response.cancelled'].includes(type)) {
        throw new Error(safeMessage(data.response?.error?.message ?? `模型响应未完成（${data.response?.incomplete_details?.reason ?? type}）。`, provider));
      }
    } else {
      const choice = data.choices?.[0];
      if (choice) {
        emit(choice.delta?.content ?? choice.delta?.refusal ?? '');
        if (choice.delta?.tool_calls !== undefined) {
          if (!Array.isArray(choice.delta.tool_calls)) throw new Error('模型工具流格式无效。');
          for (const part of choice.delta.tool_calls) {
            if (!Number.isSafeInteger(part.index) || part.index < 0 || part.index > 16) throw new Error('模型工具流序号无效。');
            const item = toolFragments.get(part.index) ?? { id: '', name: '', arguments: '' };
            for (const [key, value] of [['id', part.id], ['name', part.function?.name], ['arguments', part.function?.arguments]]) {
              if (value !== undefined) { if (typeof value !== 'string') throw new Error('模型工具流字段无效。'); item[key] += value; }
            }
            if (item.arguments.length > 128000 || item.name.length > 200 || item.id.length > 200) throw new Error('模型工具流超过大小限制。');
            toolFragments.set(part.index, item);
          }
        }
        if (choice.finish_reason) {
          completed = true;
          finishReason = choice.finish_reason;
          if (choice.finish_reason === 'length') onEvent?.('status', { message: '模型达到输出长度限制。' });
        }
      }
    }
  }
  if (!completed) throw new Error('模型连接提前结束，回复未完成。请检查网络后重试。');
  if (provider.protocol !== 'responses') calls = [...toolFragments.values()];
  if (calls.length && provider.protocol !== 'responses' && finishReason !== 'tool_calls') throw new Error('模型工具响应未完成，没有派发任务。');
  if (!text && !calls.length) throw new Error('模型服务没有返回可显示的文本。');
  return { text, calls, output };
}

export async function testProvider(provider, signal) {
  await streamProvider({ provider, messages: [{ role: 'user', content: 'Reply with OK only.' }], signal, timeoutMs: 20000 });
  return { ok: true, message: '连接成功，已收到模型的实际回复。' };
}
