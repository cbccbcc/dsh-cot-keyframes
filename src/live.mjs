import { selectBeats, toolLabel } from './core.mjs';

/** Observe new events only; history loading is never a playback trigger. */
export function watchKeyframes(binding, onChange, now = Date.now) {
  // 宿主契约变化时宁可什么都不做，也不要把异常抛进渲染层
  if (typeof binding?.eventSource?.subscribe !== 'function' || typeof binding?.session?.subscribe !== 'function') {
    return () => {};
  }
  let frame = null, holdUntil = 0, stepKey, attemptId, proseFrame, committed = false;
  let completed = new Set(), tools = new Map(), textStarted = false;
  /** 流式缓冲：每个 turn 只用来补一次"开头空白" */
  let partial = '', hasShown = false;
  /** 当前已登记工具的可读标签（去重，保持出现顺序） */
  const labels = (callId) => {
    const calls = callId === undefined ? [...tools.values()] : [tools.get(callId)].filter(Boolean);
    return [...new Set(calls.map(t => toolLabel(t.name, t.args)))];
  };
  /** 阅读时间限制在 1.8–10 秒，长错误也不会挡住后续思考。 */
  const holdFor = (sentence) => now() + Math.min(10000, Math.max(1800, Math.round(sentence.length / 26 * 1000)));
  const publish = value => { frame = value; if (value) { hasShown = true; partial = ''; } onChange(value); };
  const hide = () => { holdUntil = 0; if (frame !== null) publish(null); };
  const resetStep = () => {
    completed = new Set(); tools = new Map(); textStarted = false;
    proseFrame = null; committed = false; partial = '';
  };
  const reset = () => {
    hide(); stepKey = undefined; attemptId = undefined; resetStep();
    // 新一轮（或任务结束）重新给一次流式机会
    hasShown = false;
  };

  function reasoning(text, index) {
    if (completed.has(index)) return;
    completed.add(index);
    partial = '';
    if (now() < holdUntil) return;

    // 之前的正文把它藏起来过：既然又来了思考，那段正文就不是结论——
    // 要么被这一句顶掉，要么至少把上一句还回来，绝不能留空。
    const stashed = proseFrame?.stepKey === stepKey ? proseFrame : null;

    const beat = selectBeats(text)[0];
    if (!beat) {
      if (stashed) {
        textStarted = false;
        proseFrame = null;
        publish({ ...stashed, tools: labels(stashed.toolCallId) });
      }
      return;
    }
    textStarted = false;
    proseFrame = null;
    holdUntil = holdFor(beat.sentence);
    // 必须是 labels()：tools 里存的是 {name, args}，直接展开会把对象发给渲染层
    publish({ ...beat, stepKey, tools: labels() });
  }
  /**
   * 登记一次工具调用。
   * args 给完整 JSON 时覆盖；只给 delta 时累加（用于流式拼装参数）。
   */
  function tool(id, name, args, delta, silent) {
    const prev = tools.get(id);
    if (!name && !prev) return;
    const nextArgs = args !== undefined ? args : (prev?.args ?? '') + (delta ?? '');
    const nextName = name || prev?.name || '';
    if (!nextName) return;
    tools.set(id, { name: nextName, args: nextArgs });

    // 正文刚把展示藏起来时，工具出现本身就是"这段正文只是中途说明"的证据，
    // 这时必须恢复——它与"是否发布半截命令"是两件事。
    if (proseFrame?.stepKey === stepKey) {
      textStarted = false;
      holdUntil = holdFor(proseFrame.sentence);
      publish({ ...proseFrame, tools: labels(proseFrame.toolCallId) });
      proseFrame = null;
      return;
    }
    // 流式阶段参数还没到位：只登记，不发布，避免闪出 `❯bash` 这种裸工具名
    if (silent || frame?.stepKey !== stepKey) return;
    // 与"帧上现有的工具行"比较，而不是与上一刻的标签比较：
    // 静默期登记的调用，需要在结算时补发布出来
    const after = labels(frame.toolCallId);
    const current = frame.tools || [];
    const changed = after.length !== current.length || after.some((v, i) => v !== current[i]);
    if (changed) publish({ ...frame, tools: after });
  }
  /** 取工具结果里的第一段文本 */
  function textOf(content) {
    if (!Array.isArray(content)) return '';
    for (const block of content) {
      if (block?.type === 'text' && typeof block.text === 'string' && block.text.trim()) return block.text;
    }
    return '';
  }
  /**
   * 只补一次"每轮开头"的空白：当前没有任何内容时，用流式文本凑出第一句。
   * 只使用**已经写完**的前缀——半句话绝不能出句，否则会出现 "Actually earlier" 这种碎片。
   * 一旦本轮出过一次，就完全交回"块结束才判断"的规则。
   */
  function earlyBeat() {
    if (hasShown || textStarted) return;
    const beat = selectBeats(partial, { completeOnly: true })[0];
    if (!beat) return;
    holdUntil = holdFor(beat.sentence);
    publish({ ...beat, stepKey, tools: labels() });
  }

  function text() { textStarted = true; if (frame?.stepKey === stepKey) proseFrame = frame; hide(); }

  function accept(event) {
    const { type, data } = event;
    if (type === 'turn/start' || type === 'turn/end' || type === 'llm/retry') { reset(); return; }
    if (!['assistant/live-chunk', 'assistant/message', 'tool/call', 'tool/result'].includes(type)) return;
    const key = JSON.stringify([data.turn, data.step]);
    if (key !== stepKey) { stepKey = key; attemptId = undefined; resetStep(); }
    if (type === 'tool/result') {
      // 失败的工具调用同样值得展示：第一行错误、第二行是那条命令
      const msg = data.message;
      const failed = msg !== undefined && (msg.isError === true || data.error !== undefined);
      if (!failed || textStarted) return;
      const reason = data.error?.reason;
      const body = (reason && reason.trim()) || textOf(msg.content) ||
        (data.error ? `${data.error.name}: ${data.error.code}` : '');
      const sentence = body.replace(/\s+/g, ' ').trim();
      holdUntil = holdFor(sentence);
      publish({ sentence, tier: 'E', signal: 'error', stepKey,
        toolCallId: msg.toolCallId, tools: labels(msg.toolCallId) });
      return;
    }
    if (type === 'assistant/live-chunk') {
      if (attemptId !== undefined && attemptId !== data.attemptId) { hide(); resetStep(); }
      attemptId = data.attemptId;
      const chunk = data.chunk;
      if (chunk.type === 'reasoning-delta' && !hasShown && !textStarted) {
        partial += chunk.text;
        // 英文句末要等后续空白；空白可能单独到达。
        if (/[\s。！？；…]/u.test(chunk.text)) earlyBeat();
      }
      if (chunk.type === 'text-delta' && chunk.text.trim()) text();
      if (chunk.type === 'tool-call-delta') tool(chunk.id, chunk.name, undefined, chunk.argumentsDelta, true);
      if (chunk.type === 'block-end') {
        const block = chunk.block;
        if (block.type === 'reasoning') reasoning(block.text, chunk.index);
        if (block.type === 'tool-call') tool(block.id, block.name, block.arguments);
        if (block.type === 'text' && block.text.trim()) text();
      }
    } else if (type === 'tool/call') {
      tool(data.callId, data.name, data.arguments);
    } else {
      if (data.interrupted) { reset(); return; }
      committed = true;
      const content = data.message.content;
      // shortcut: no final-answer-start marker; prose hides until a tool proves it was commentary.
      if (!content.some(block => block.type === 'tool-call') && content.some(block => block.type === 'text' && block.text.trim())) { text(); return; }
      content.forEach((block, index) => {
        if (block.type === 'reasoning') reasoning(block.text, index);
        if (block.type === 'tool-call') tool(block.id, block.name, block.arguments);
      });
    }
  }

  const stopEvents = binding.eventSource.subscribe(() => {
    const { change } = binding.eventSource.getSnapshot();
    if (change.kind === 'replace') { reset(); return; }
    if (change.kind === 'append') for (const entry of change.entries) accept(entry.event);
    if (change.kind === 'settle-assistant') {
      if (change.entry) accept(change.entry.event);
      else if (change.attemptId === attemptId && !committed) reset();
    }
  });
  const stopSession = binding.session.subscribe(() => {
    if (!binding.session.getSnapshot().running) reset();
  });
  return () => { stopEvents(); stopSession(); };
}
