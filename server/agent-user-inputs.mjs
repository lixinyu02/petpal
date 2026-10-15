import { createHash } from 'node:crypto';
import { normalizeUserInputQuestions, normalizeUserInputAnswer, userInputAnswerSecrets } from './user-input.mjs';

const fail = (status, message, code) => Object.assign(new Error(message), { status, code });
const timestamp = value => typeof value === 'string' && value.length <= 40 && Number.isFinite(Date.parse(value));
const fingerprint = answer => createHash('sha256').update(JSON.stringify(answer)).digest('hex');

export function approvalMetadata(value) {
  return { ...(typeof value.canAccept === 'boolean' ? { canAccept: value.canAccept } : {}),
    ...(timestamp(value.requestedAt) ? { requestedAt: value.requestedAt } : {}), ...(timestamp(value.expiresAt) ? { expiresAt: value.expiresAt } : {}) };
}

/** Ephemeral, task-scoped human questions. Answers never enter store snapshots. */
export function createAgentUserInputs({ active, authorize = () => {}, changed = () => {}, protectPrivateInput = async () => {} }) {
  const pending = new Map(), receipts = new Map();
  const alive = value => active.get(value.conversationId) === value.task && !value.task.controller.signal.aborted;
  const receive = (task, userId, conversationId, data) => {
    if (active.get(conversationId) !== task || task.controller.signal.aborted) return false;
    if (typeof data?.id !== 'string' || !/^[a-zA-Z0-9_-]{8,200}$/.test(data.id) || !timestamp(data.requestedAt) || !timestamp(data.expiresAt) || Date.parse(data.expiresAt) <= Date.parse(data.requestedAt) || Date.parse(data.expiresAt) - Date.parse(data.requestedAt) > 600000 || Date.parse(data.expiresAt) > Date.now() + 600000) throw fail(400, 'Agent 提问范围或有效期无效。', 'user_input_invalid');
    if (pending.has(data.id) || receipts.has(data.id) || [...pending.values()].filter(item => item.task === task).length >= 32) throw fail(409, 'Agent 提问标识重复或超过上限。', 'user_input_conflict');
    const value = { userId, conversationId, task, id: data.id, questions: normalizeUserInputQuestions(data.questions), requestedAt: data.requestedAt, expiresAt: data.expiresAt };
    pending.set(data.id, value); changed(value); return true;
  };
  const resolve = (task, id) => { const value = pending.get(id); if (value?.task !== task) return false; pending.delete(id); changed(value); return true; };
  const snapshot = conversationId => [...pending.values()].filter(value => value.conversationId === conversationId && alive(value) && Date.parse(value.expiresAt) > Date.now()).map(value => ({ id: value.id, questions: structuredClone(value.questions), requestedAt: value.requestedAt, expiresAt: value.expiresAt, ...(value.deliveryUncertain ? { deliveryUncertain: true } : {}) }));
  const clear = task => { for (const [id, value] of pending) if (value.task === task) { pending.delete(id); changed(value); } for (const [id, value] of receipts) if (value.task === task) receipts.delete(id); };
  async function reply(id, body, userId, verifyCurrent = () => {}) {
    const value = pending.get(id) ?? receipts.get(id);
    if (!value || value.userId !== userId || !alive(value) || Date.parse(value.expiresAt) <= Date.now()) throw fail(404, '提问不存在或已过期，请刷新任务状态。', 'user_input_expired');
    verifyCurrent(); authorize(value.task);
    const normalized = normalizeUserInputAnswer(value.questions, body), hash = fingerprint(normalized), previous = receipts.get(id);
    const answerBody = body.skip === true ? { skip: true } : normalized;
    if (previous) {
      if (previous.hash !== hash) throw fail(409, '该提问已提交另一份回答，请刷新状态。', 'user_input_conflict');
      return previous.promise;
    }
    if (typeof value.task.bridge?.replyUserInput !== 'function') throw fail(409, '执行电脑尚不支持回答提问，请升级该电脑客户端。', 'user_input_unsupported');
    // Install the receipt before invoking a bridge that can resolve synchronously.
    const receipt = { ...value, hash, promise: null };
    receipt.promise = Promise.resolve().then(async () => {
      if (!alive(value) || Date.parse(value.expiresAt) <= Date.now()) throw fail(404, '提问不存在或已过期，请刷新任务状态。', 'user_input_expired');
      verifyCurrent(); authorize(value.task);
      // A future CLI generation must never resume a thread whose secret mask
      // lived only in this process. Commit the non-resumable binding first.
      if (userInputAnswerSecrets(value.questions, normalized).length) await protectPrivateInput(value.task, value.conversationId);
      if (!alive(value) || Date.parse(value.expiresAt) <= Date.now()) throw fail(404, '提问不存在或已过期，请刷新任务状态。', 'user_input_expired');
      verifyCurrent(); authorize(value.task);
      try {
        await value.task.bridge.replyUserInput(id, answerBody);
        resolve(value.task, id); return { ok: true };
      } catch {
        if (alive(value) && pending.get(id) === value) { value.deliveryUncertain = true; changed(value); }
        throw fail(409, '回答送达状态尚未确认，请刷新状态或停止任务；不会自动重发。', 'user_input_delivery_uncertain');
      }
    });
    receipts.set(id, receipt);
    return receipt.promise;
  }
  return { receive, resolve, snapshot, clear, reply };
}
