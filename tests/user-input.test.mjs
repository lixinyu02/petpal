import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeUserInputQuestions, normalizeUserInputAnswer, userInputAnswerSecrets } from '../server/user-input.mjs';

const question = (extra = {}) => ({ id: 'color', header: '配色', question: '请选择配色。', options: [{ label: '奶油白', description: '明亮。' }, { label: '浅橘', description: '温暖。' }], ...extra });
const answer = value => ({ answers: { color: { answers: [value] } } });

test('bounded question normalization preserves native flags and allows a free-form question', () => {
  const result = normalizeUserInputQuestions([question(), question({ id: 'private_note', isSecret: true, options: null })]);
  assert.deepEqual(result[0], { ...question(), isOther: false, isSecret: false });
  assert.deepEqual(result[1].options, []); assert.equal(result[1].isSecret, true);
  const free = normalizeUserInputQuestions([question({ options: undefined })]);
  assert.deepEqual(normalizeUserInputAnswer(free, answer('自由输入')), answer('自由输入'));
});

test('invalid, duplicate and oversized questions fail without returning any supplied values', () => {
  const privateText = 'synthetic-private-question-content';
  for (const input of [null, [], Array.from({ length: 4 }, () => question()), [question(), question()], [question({ id: '__proto__' })], [question({ id: 'bad id' })], [question({ unknown: privateText })], [question({ isSecret: privateText })], [question({ question: 'x'.repeat(2001) })], [question({ header: '\0' })], [question({ options: Array.from({ length: 5 }, (_, id) => ({ label: String(id), description: privateText })) })], [question({ options: [{ label: 'same', description: 'one' }, { label: ' same ', description: 'two' }] })]]) {
    assert.throws(() => normalizeUserInputQuestions(input), error => error.status === 400 && error.code === 'user_input_invalid' && !error.message.includes(privateText));
  }
});

test('answers require every question exactly once and only a single bounded string', () => {
  const questions = normalizeUserInputQuestions([question(), question({ id: 'second', options: [] })]);
  const valid = { answers: { color: { answers: ['奶油白'] }, second: { answers: ['second answer'] } } };
  assert.deepEqual(normalizeUserInputAnswer(questions, valid), valid);
  for (const body of [{ answers: {} }, answer('奶油白'), { ...valid, skip: false }, { answers: { ...valid.answers, foreign: { answers: ['x'] } } }, { answers: { ...valid.answers, color: { answers: ['奶油白', '浅橘'] } } }, { answers: { ...valid.answers, color: { answers: ['奶油白'], private: 'do not expose' } } }, { answers: { ...valid.answers, second: { answers: ['x'.repeat(2001)] } } }, { answers: { ...valid.answers, second: { answers: ['  '] } } }]) assert.throws(() => normalizeUserInputAnswer(questions, body), { code: 'user_input_invalid' });
});

test('Other permits an unlisted answer while secret whitespace remains exact and skip is explicit', () => {
  assert.throws(() => normalizeUserInputAnswer([question()], answer('other')), { code: 'user_input_invalid' });
  assert.deepEqual(normalizeUserInputAnswer([question({ isOther: true })], answer('other')), answer('other'));
  const questions = normalizeUserInputQuestions([question({ isSecret: true, options: [] })]), value = '  synthetic exact secret  ';
  const result = normalizeUserInputAnswer(questions, answer(value)); assert.equal(result.answers.color.answers[0], value);
  assert.deepEqual(userInputAnswerSecrets(questions, result), [value]);
  assert.deepEqual(normalizeUserInputAnswer(questions, { skip: true }), { answers: {} });
  assert.deepEqual(userInputAnswerSecrets(questions, { answers: {} }), []);
  for (const body of [{ answers: {} }, { skip: false }, { skip: true, answers: {} }, { skip: true, extra: 'x' }]) assert.throws(() => normalizeUserInputAnswer(questions, body), { code: 'user_input_invalid' });
});
