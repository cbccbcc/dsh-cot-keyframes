import assert from 'node:assert/strict';
import test from 'node:test';
import { watchKeyframes } from '../src/live.mjs';
const thought = 'Wait — the cache key ignores the session, so responses can leak between conversations.';
const later = 'I was wrong about the default timeout; the actual setting is thirty seconds.';

// Same observable/change contract as DSH MutableSessionEventSource.
class Source {
  listeners = new Set();
  constructor(value) { this.value = value; }
  getSnapshot() { return this.value; }
  subscribe(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  publish(value) { this.value = value; for (const fn of this.listeners) fn(); }
}
function setup() {
  const session = new Source({ running: true });
  const eventSource = new Source({ change: { kind: 'replace', entries: [] } });
  let frame = null, now = 0;
  const seen = [];
  const dispose = watchKeyframes({ session, eventSource }, value => {
    frame = value; seen.push(value);
  }, () => now);
  const emit = (type, data = {}) => eventSource.publish({ change: {
    kind: 'append', entries: [{ event: { type, data: { turn: 1, step: 1, ...data } } }],
  } });
  const chunk = (chunk, step = 1, attemptId = 'a') => emit('assistant/live-chunk', { chunk, step, attemptId });
  const reasoning = (text = thought, step = 1, attemptId = 'a') => chunk({
    type: 'block-end', index: 0, block: { type: 'reasoning', text },
  }, step, attemptId);
  return { session, eventSource, seen, dispose, emit, chunk, reasoning,
    get frame() { return frame; }, advance(ms) { now += ms; } };
}

test('completed reasoning appears, tool name joins the same step, settlement is not replayed', () => {
  const h = setup();
  // 本轮还没有任何内容：允许用流式补一次开头空白（但必须是一句完整的话）
  h.chunk({ type: 'reasoning-delta', index: 0, text: thought + ' ' });
  assert.equal(h.frame?.sentence, thought, '本轮开头允许流式出句');
  h.reasoning();
  assert.equal(h.frame.sentence, thought);
  // 流式阶段只登记参数，不发布——避免闪出 `❯bash` 这种裸工具名
  h.chunk({ type: 'tool-call-delta', index: 1, id: 'call-1', name: 'shell', argumentsDelta: '{"command":"ls"}' });
  assert.deepEqual(h.frame.tools, []);
  h.advance(20000);
  h.emit('assistant/message', { message: { content: [
    { type: 'reasoning', text: thought }, { type: 'tool-call', id: 'call-1', name: 'shell', arguments: '{"command":"ls"}' },
  ] } });
  // 结算补全参数：句子不重放，只把命令补上
  assert.equal(h.frame.sentence, thought);
  assert.deepEqual(h.frame.tools, ['ls']);
});

test('hold duration drops new beats; old phrase never gets a later step’s tool', () => {
  const h = setup(); h.reasoning();
  h.emit('tool/call', { callId: 'one', name: 'read' });
  h.advance(100); h.reasoning(later, 2);
  h.emit('tool/call', { step: 2, callId: 'two', name: 'write' });
  assert.equal(h.frame.sentence, thought);
  assert.deepEqual(h.frame.tools, ['read']);
  h.advance(10000); h.reasoning(later, 3);
  assert.equal(h.frame.sentence, later);
  assert.deepEqual(h.frame.tools, []);
});

test('empty selection retains the preceding beat and no timer resurrects dropped beats', () => {
  const h = setup(); h.reasoning(); h.advance(20000); h.reasoning('', 2);
  assert.equal(h.frame.sentence, thought);
});

test('final text hides immediately, including streaming before durable settlement', () => {
  const h = setup(); h.reasoning();
  h.chunk({ type: 'text-delta', index: 1, text: 'Here is the answer.' });
  assert.equal(h.frame, null);
  h.emit('assistant/message', { message: { content: [
    { type: 'reasoning', text: thought }, { type: 'text', text: 'Here is the answer.' },
  ] } });
  assert.equal(h.frame, null);
});

test('durable-only delivery works; plain final answers stay hidden', () => {
  const h = setup();
  h.emit('assistant/message', { message: { content: [
    { type: 'reasoning', text: thought }, { type: 'tool-call', id: 'x', name: 'search' },
  ] } });
  assert.equal(h.frame.sentence, thought);
  assert.deepEqual(h.frame.tools, ['search']);
  h.emit('assistant/message', { step: 2, message: { content: [
    { type: 'reasoning', text: later }, { type: 'text', text: 'Done' },
  ] } });
  assert.equal(h.frame, null);
});

test('history loading/reconnection never replays old reasoning', () => {
  const h = setup(); h.reasoning();
  const entries = [{ event: { type: 'assistant/message', data: { turn: 0, step: 1,
    message: { content: [{ type: 'reasoning', text: later }] } } } }];
  h.eventSource.publish({ change: { kind: 'prepend', entries } });
  assert.equal(h.frame.sentence, thought);
  h.eventSource.publish({ change: { kind: 'replace', entries } });
  assert.equal(h.frame, null);
});

test('turn end, cancellation and retry clear stale display; sessions are isolated', () => {
  const a = setup(), b = setup(); a.reasoning(); assert.equal(b.frame, null);
  a.emit('turn/end'); assert.equal(a.frame, null);
  b.reasoning(); b.session.publish({ running: false }); assert.equal(b.frame, null);
  a.reasoning(later, 2); a.emit('llm/retry', { step: 2 }); assert.equal(a.frame, null);
  a.reasoning(thought, 2, 'retry'); assert.equal(a.frame.sentence, thought);
  a.dispose(); b.dispose();
  assert.equal(a.session.listeners.size + a.eventSource.listeners.size, 0);
  assert.equal(b.session.listeners.size + b.eventSource.listeners.size, 0);
});

test('intermediate prose hides the strip, then its tool call restores the corresponding beat', () => {
  const h = setup(); h.reasoning();
  h.chunk({ type: 'text-delta', index: 1, text: 'I will inspect the config.' });
  assert.equal(h.frame, null);
  h.chunk({ type: 'tool-call-delta', index: 2, id: 't', name: 'read', argumentsDelta: '' });
  assert.equal(h.frame?.sentence, thought);
  assert.deepEqual(h.frame.tools, ['read']);
  h.emit('assistant/message', { message: { content: [
    { type: 'reasoning', text: thought }, { type: 'text', text: 'I will inspect the config.' },
    { type: 'tool-call', id: 't', name: 'read' },
  ] } });
  assert.equal(h.frame?.sentence, thought);
});

test('retiring committed stream chunks at step end keeps the last beat visible', () => {
  const h = setup(); h.reasoning();
  h.emit('assistant/message', { message: { content: [{ type: 'reasoning', text: thought }] } });
  h.emit('step/end');
  h.eventSource.publish({ change: { kind: 'settle-assistant', attemptId: 'a' } });
  assert.equal(h.frame?.sentence, thought);
});

test('a failed tool result surfaces its error with the failing command', () => {
  const h = setup();
  h.reasoning();
  h.emit('tool/call', { callId: 'c1', name: 'write', arguments: '{"file_path":"/tmp/a.txt"}' });
  h.advance(2000);
  h.emit('tool/result', {
    message: {
      role: 'tool', toolCallId: 'c1', isError: true,
      content: [{ type: 'text', text: 'Error: cannot write "/tmp/a.txt": file changed since it was read — re-read the file, then retry' }],
    },
  });
  assert.equal(h.frame.tier, 'E');
  assert.match(h.frame.sentence, /file changed since it was read/);
  assert.deepEqual(h.frame.tools, ['write /tmp/a.txt']);
});

test('a successful tool result never replaces the reasoning beat', () => {
  const h = setup();
  h.reasoning();
  h.advance(2000);
  h.emit('tool/call', { callId: 'c2', name: 'bash', arguments: '{"command":"ls"}' });
  const before = h.frame.sentence;
  h.emit('tool/result', {
    message: { role: 'tool', toolCallId: 'c2', isError: false, content: [{ type: 'text', text: 'ok' }] },
  });
  assert.equal(h.frame.sentence, before);
  assert.notEqual(h.frame.tier, 'E');
});

test('short reasoning after prose restores the previous beat instead of going blank', () => {
  const h = setup(); h.reasoning();
  h.advance(20000);
  h.chunk({ type: 'text-delta', index: 1, text: 'I will check the config.' });
  assert.equal(h.frame, null, '正文出现时先隐藏');
  h.chunk({ type: 'block-end', index: 2, block: { type: 'reasoning', text: 'ok' } }); // 太短，选不出 beat
  assert.equal(h.frame?.sentence, thought, '没有新句时保留旧句');
});

test('a later reasoning beat keeps tool labels as strings, not objects', () => {
  const h = setup();
  h.emit('tool/call', { callId: 'c9', name: 'bash', arguments: '{"command":"ls -la"}' });
  h.advance(20000);
  h.reasoning(later); // 同一步，工具行应保留
  assert.deepEqual(h.frame.tools, ['ls -la']);
});

test('streaming fill-in happens at most once per turn', () => {
  const h = setup();
  h.chunk({ type: 'reasoning-delta', index: 0, text: thought + ' ' });
  assert.ok(h.frame, '开头允许一次');
  h.chunk({ type: 'text-delta', index: 1, text: 'I will inspect the config.' });
  assert.equal(h.frame, null, '正文出现后隐藏');
  h.chunk({ type: 'reasoning-delta', index: 2, text: later });
  assert.equal(h.frame, null, '同一轮不再抢跑，等块结束');
  h.reasoning(later, 3);
  assert.equal(h.frame?.sentence, later, '块结束后恢复出句');
});

test('streaming fill-in only uses a completed sentence, never a fragment', () => {
  const h = setup();
  h.chunk({ type: 'reasoning-delta', index: 0, text: 'Actually earlier ' });
  assert.equal(h.frame, null, '半句话不出句');
  h.chunk({ type: 'reasoning-delta', index: 0, text: '`pnpm add` failed under the sandbox and worked with escalation. ' });
  assert.equal(
    h.frame?.sentence,
    'Actually earlier `pnpm add` failed under the sandbox and worked with escalation.',
    '完整句出现后才出句',
  );
});

test('streaming cannot replace a previous step, even after its hold expires', () => {
  const h = setup(); h.reasoning();
  h.advance(100);
  h.chunk({ type: 'reasoning-delta', index: 0, text: later + ' ' }, 2);
  assert.equal(h.frame.sentence, thought);
  h.advance(20000);
  h.chunk({ type: 'reasoning-delta', index: 0, text: later + ' ' }, 3);
  assert.equal(h.frame.sentence, thought);
});

test('streaming waits for filename continuation and whitespace arriving separately', () => {
  const h = setup();
  h.chunk({ type: 'reasoning-delta', index: 0, text: 'Wait — inspect core.' });
  assert.equal(h.frame, null);
  h.chunk({ type: 'reasoning-delta', index: 0, text: 'mjs before changing it.' });
  assert.equal(h.frame, null);
  h.chunk({ type: 'reasoning-delta', index: 0, text: ' ' });
  assert.equal(h.frame.sentence, 'Wait — inspect core.mjs before changing it.');
});

test('error stays paired with its failed call when other tools arrive; long errors cannot stall later beats', () => {
  const h = setup();
  h.emit('tool/call', { callId: 'a', name: 'read', arguments: '{"path":"/missing"}' });
  h.emit('tool/call', { callId: 'b', name: 'bash', arguments: '{"command":"pwd"}' });
  h.emit('tool/result', { message: { toolCallId: 'a', isError: true,
    content: [{ type: 'text', text: 'File not found. '.repeat(200) }] } });
  assert.deepEqual(h.frame.tools, ['read /missing']);
  h.emit('tool/call', { callId: 'c', name: 'bash', arguments: '{"command":"ls"}' });
  assert.deepEqual(h.frame.tools, ['read /missing']);
  h.advance(10000); h.reasoning(later, 2);
  assert.equal(h.frame.sentence, later);
});

test('binding 结构不符时静默降级，不抛异常', () => {
  assert.equal(typeof watchKeyframes({}, () => {}), 'function');
  assert.equal(typeof watchKeyframes(undefined, () => {}), 'function');
});
