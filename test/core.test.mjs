import assert from 'node:assert/strict';
import test from 'node:test';
import { selectBeats, signalParts } from '../src/core.mjs';

test('bilingual signals highlight exactly the matched text', () => {
  const sentence = 'Wait — the connection is still using the old token.';
  const beat = selectBeats(sentence)[0];
  assert.equal(beat.tier, 'A');
  const parts = signalParts(sentence, beat.signal);
  assert.equal(parts.join(''), sentence);
  assert.equal(parts[1], 'Wait');
  const zh = '不对，这里的请求应该属于当前会话，否则结果会串到另一个窗口。';
  assert.equal(signalParts(zh, selectBeats(zh)[0].signal)[1], '不对');
});

test('no signal means no beat; model-provided HTML stays literal text', () => {
  const plain = 'The current configuration uses a separate cache for each session.';
  assert.deepEqual(selectBeats(plain), []);
  const html = 'Wait — <img src=x onerror=alert(1)> must stay literal text.';
  assert.equal(signalParts(html, 'wait-start').join(''), html);
});

test('documented corrections and reconsideration survive the plan filter', () => {
  assert.equal(selectBeats('I should have checked the config first.')[0]?.signal, 'should-have');
  assert.equal(selectBeats('Let me reconsider the timeout.')[0]?.signal, 'reconsider');
  for (const plan of ['I should check why this failed.', 'Let me inspect that suspicious file.', 'Actually, let me check the config.']) {
    assert.deepEqual(selectBeats(plan), []);
  }
});

test('streaming uses the same code, abbreviation and parenthesis boundaries as completed reasoning', () => {
  for (const prefix of ['Wait — inspect `core. ', 'Wait — check e.g. ', 'Wait — inspect (version 1. ', 'Wait — inspect ```\ncore. ']) {
    assert.deepEqual(selectBeats(prefix, { completeOnly: true }), []);
  }
  assert.equal(selectBeats('不对，这里的缓存键缺少会话。', { completeOnly: true }).length, 1);
});

test('new English signals select and highlight corrections, pivots and discoveries', () => {
  for (const [sentence, keyword] of [
    ['I misread.', 'I misread'],
    ['This exposes a condition I missed.', 'I missed'],
    ['Hold on — the transcript may have another cause.', 'Hold on —'],
    ['But hold on: apply must exist.', 'But hold on:'],
    ['Ah — the background repeats across the page.', 'Ah —'],
    ['Aha, the cache key omits the session.', 'Aha,'],
  ]) {
    const beat = selectBeats(sentence)[0];
    assert.ok(beat, sentence);
    const parts = signalParts(sentence, beat.signal);
    assert.equal(parts[1], keyword);
    assert.equal(parts.join(''), sentence);
  }
  for (const sentence of [
    'If the view renders, I misread it.', 'Unless I missed a setting, the view is empty.',
    'Hold on.', 'Hold on until the command finishes.',
    'But hold on — maybe I should inspect the file.', 'Ah.', 'Aha!',
  ]) assert.deepEqual(selectBeats(sentence), [], sentence);
});
