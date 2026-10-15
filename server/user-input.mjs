const object = value => value && typeof value === 'object' && !Array.isArray(value);
const keys = (value, allowed) => object(value) && Object.keys(value).every(key => allowed.includes(key));
const invalid = () => Object.assign(new Error('Agent 提问或回答格式无效，请刷新后重新填写。'), { status: 400, code: 'user_input_invalid' });
const text = (value, max) => typeof value === 'string' && value.length <= max && value.trim().length > 0 && !/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value);
const bounded = (value, bytes) => { try { if (Buffer.byteLength(JSON.stringify(value)) > bytes) throw invalid(); } catch { throw invalid(); } };

/** Bounded native subset shared by direct CLI, remote relay and HTTP answers. */
export function normalizeUserInputQuestions(value) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 3) throw invalid();
  const ids = new Set();
  const questions = value.map(question => {
    if (!keys(question, ['id', 'header', 'question', 'isOther', 'isSecret', 'options']) || typeof question.id !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(question.id) || ['__proto__', 'prototype', 'constructor'].includes(question.id) || ids.has(question.id) ||
        !text(question.header, 48) || !text(question.question, 2000) || (question.isOther !== undefined && typeof question.isOther !== 'boolean') || (question.isSecret !== undefined && typeof question.isSecret !== 'boolean')) throw invalid();
    ids.add(question.id);
    const source = question.options ?? [];
    if (!Array.isArray(source) || source.length > 4) throw invalid();
    const labels = new Set();
    const options = source.map(option => {
      if (!keys(option, ['label', 'description']) || !text(option.label, 200) || !text(option.description, 500)) throw invalid();
      const label = option.label.trim(); if (labels.has(label)) throw invalid(); labels.add(label);
      return { label, description: option.description.trim() };
    });
    return { id: question.id, header: question.header.trim(), question: question.question.trim(), isOther: question.isOther === true, isSecret: question.isSecret === true, options };
  });
  bounded(questions, 16384); return questions;
}

/** Explicit skip is the sole accepted spelling of an empty native answer map. */
export function normalizeUserInputAnswer(questions, body) {
  const normalized = normalizeUserInputQuestions(questions);
  if (!object(body)) throw invalid();
  if (Object.hasOwn(body, 'skip')) {
    if (!keys(body, ['skip']) || body.skip !== true) throw invalid();
    return { answers: {} };
  }
  if (!keys(body, ['answers']) || !object(body.answers) || Object.keys(body.answers).length !== normalized.length || Object.keys(body.answers).some(id => !normalized.some(question => question.id === id))) throw invalid();
  const answers = Object.fromEntries(normalized.map(question => {
    const answer = body.answers[question.id];
    if (!Object.hasOwn(body.answers, question.id) || !keys(answer, ['answers']) || !Array.isArray(answer.answers) || answer.answers.length !== 1 || !text(answer.answers[0], 2000)) throw invalid();
    const value = answer.answers[0];
    if (question.options.length && !question.isOther && !question.options.some(option => option.label === value)) throw invalid();
    // Preserve exact whitespace: secret values can legitimately contain it.
    return [question.id, { answers: [value] }];
  }));
  const result = { answers }; bounded(result, 8192); return result;
}

/** Call only after normalization; plaintext stays in the caller's owned memory. */
export function userInputAnswerSecrets(questions, nativeAnswer) {
  return questions.filter(question => question.isSecret).flatMap(question => nativeAnswer.answers[question.id]?.answers ?? []);
}
