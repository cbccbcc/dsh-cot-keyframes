window.__ModuleLoader__.load({
  id: 'dsh-plugin-cot-keyframes',
  factory: (require) => {
    const React = require('react');
    /**
 * cot-keyframes core — 纯函数，无 DOM、无 React、无 DSH 依赖。
 *
 * 能力：
 *   splitSentences(text)        把 COT 切成句子（保护代码/括号/缩写）
 *   selectBeats(text, opts)     挑出命中 S/A 层信号的句子；没有命中就返回空数组
 *   toolLabel(name, argsJson)   把一次工具调用压成一行可读命令
 *   signalParts(sentence, sig)  拆成「前缀 / 命中词 / 后缀」，供渲染层做高亮
 *
 * 本文件同时被 scripts/dryrun.mjs（node 直接跑）和 lib/client.js（浏览器 bundle）使用，
 * 所以在 client bundle 里由 build.mjs 内联，去掉 export 关键字。
 */

/* ------------------------------------------------------------------ *
 * 1. 分句
 * ------------------------------------------------------------------ */

/** 句末标点（中文）——无论如何都断句 */
const CJK_END = new Set(['。', '！', '？', '；', '…']);

/** 英文缩写：这些词后面的点不是句末 */
const ABBREV = new Set([
  'i.e', 'e.g', 'etc', 'vs', 'cf', 'al', 'approx', 'fig', 'no', 'vol',
  'mr', 'mrs', 'ms', 'dr', 'st', 'jr', 'sr', 'inc', 'ltd', 'co', 'corp',
  'esp', 'incl', 'resp', 'min', 'max', 'avg', 'ref',
]);

/**
 * 把 reasoning 原文切成句子。
 *
 * 关键保护：
 *   - 反引号 / ``` 围栏内的内容一律不断句（代码里的点、问号、换行都不算）
 *   - 圆括号未闭合时，内部的 . ? ! 不断句
 *   - `i.e.` `e.g.` 等缩写点不算句末
 *   - `3.14` 这种小数点不算
 *   - 行首 `1.` 这种列表编号不算（编号点后面紧跟空白且整个缓冲只有编号）
 *
 * @param {string} text
 * @param {boolean} completeOnly 流式文本不把缓冲区末尾当作句末
 * @returns {{text: string, start: number, end: number}[]}
 */
function splitSentences(text, completeOnly = false) {
  const out = [];
  if (typeof text !== 'string' || text.length === 0) return out;

  let buf = '';
  let bufStart = 0;
  let inCode = false;   // 单反引号行内代码
  let paren = 0;        // 圆括号深度

  const flush = (endIdx) => {
    const raw = buf;
    const collapsed = raw.replace(/\s+/g, ' ').trim();
    if (collapsed) out.push({ text: collapsed, start: bufStart, end: endIdx });
    buf = '';
  };

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];

    // ``` 围栏：整块跳过，不参与断句
    if (ch === '`' && text.startsWith('```', i)) {
      // 消耗三个反引号
      buf += '```';
      const close = text.indexOf('```', i + 3);
      if (close === -1) {
        buf += text.slice(i + 3);
        i = text.length;
        break;
      }
      buf += text.slice(i + 3, close + 3);
      i = close + 2;
      continue;
    }

    if (ch === '`') {
      inCode = !inCode;
      buf += ch;
      continue;
    }

    buf += ch;
    if (inCode) continue;

    if (ch === '(' || ch === '（') paren++;
    else if (ch === ')' || ch === '）') paren = Math.max(0, paren - 1);

    // 换行：硬边界
    if (ch === '\n') {
      flush(i);
      bufStart = i + 1;
      continue;
    }

    // 中文句末：硬边界
    if (CJK_END.has(ch)) {
      // 吃掉连续的句末标点（"！？" 这种）
      while (i + 1 < text.length && CJK_END.has(text[i + 1])) {
        buf += text[++i];
      }
      flush(i);
      bufStart = i + 1;
      continue;
    }

    // 英文句末：需要后接空白或结尾，且不在括号内
    if (ch === '.' || ch === '!' || ch === '?') {
      if (paren > 0) continue;
      const next = text[i + 1];
      if (completeOnly && next === undefined) continue;
      if (next !== undefined && !/\s/.test(next)) continue; // 不是句末（标识符/路径/小数）

      if (ch === '.') {
        const prev = text[i - 1];
        // 小数点：两侧都是数字
        if (prev !== undefined && /\d/.test(prev) && next !== undefined && /\d/.test(next)) continue;
        // 缩写
        const word = (buf.slice(0, -1).match(/([A-Za-z.]+)$/) || [, ''])[1].toLowerCase().replace(/\.$/, '');
        if (ABBREV.has(word)) continue;
        if (ABBREV.has(word.replace(/\./g, ''))) continue;
        // 列表编号 "1." / "a."
        if (/^\s*(\d{1,2}|[a-zA-Z])$/.test(buf.slice(0, -1))) continue;
      }
      // 吃掉连续的 ?! 
      while (i + 1 < text.length && '!?'.includes(text[i + 1])) buf += text[++i];
      flush(i);
      bufStart = i + 1;
      continue;
    }
  }

  if (!completeOnly) flush(text.length);
  return out;
}

/* ------------------------------------------------------------------ *
 * 2. 信号词表
 * ------------------------------------------------------------------ */

/**
 * S 层：稀有但几乎必是真信号。
 * 命中即入选，不看上下文。
 */
const TIER_S = [
  { id: 'self-wrong', re: /\b(?:i\s+)?(?:was|were|am)\s+wrong\b/i },
  { id: 'my-mistake', re: /\bmy\s+(?:mistake|error|bad)\b/i },
  // 只认"我判断错了"，不认"用户可能错了"——后者是评价别人，不是自省
  { id: 'mistaken', re: /\bi\s+(?:was|am|'m)\s+mistaken\b|\bif\s+i'?m\s+not\s+mistaken\b/i },
  // 第一人称或名词形式；"realize" 作及物动词（realize the value）是噪声
  { id: 'realize', re: /\bi\s+realiz(?:e|ed)\b|\brealiz(?:e|ed)\s+(?:that|i|it|this)\b|\brealization\b/i },
  // 必须是 "I should have"，"should have a section" 是建议不是自省
  { id: 'should-have', re: /\bi\s+should\s+have\b/i },
  { id: 'good-catch', re: /\bgood\s+(?:catch|point)\b/i },
  // 中文
  { id: 'zh-wrong', re: /我(?:错|搞错|想错|看错)了?|说错|弄错/ },
  { id: 'zh-realize', re: /(?:发现|意识到|才明白)/ },
];

/**
 * A 层：主力信号，全部按位置收紧。
 * 位置锚定是精度的关键——同一个 wait，句首 ≈87%，句中 ≈47%。
 */
const TIER_A = [
  // 句首 wait，但排除动词用法
  { id: 'wait-start', re: /^\s*(?:wait|WAIT)\b/i, not: /^\s*wait\s+(?:for|until|time|a\s+bit|a\s+moment|here)\b/i },
  // but/hmm/and/now + wait —— 句中也能用
  { id: 'wait-turn', re: /\b(?:but|hmm+|and|now)\s*,?\s*wait\b/i },
  // Hmm 必须带 but/wait，单用精度不够
  { id: 'hmm-turn', re: /^\s*hmm+\s*,?\s*(?:but|wait|actually|no)\b/i },
  // Actually 句首；但 "Actually, let me / I'll" 是计划句，排除
  {
    id: 'actually-start',
    re: /^\s*actually\b/i,
    not: /^\s*actually\s*,?\s*(?:let\s+me|i\s+(?:need|will|'ll|should|can|would)|we\s+(?:need|should|can))\b/i,
  },
  // No — / No, 句首
  { id: 'no-start', re: /^\s*no\s*[—–\-,]/i },
  // 重新考虑
  { id: 'reconsider', re: /^\s*let\s+me\s+(?:reconsider|rethink|step\s+back)\b/i },
  // 感叹词后必须有同句内容，单独的 Ah/Aha 不构成关键句
  { id: 'oh-start', re: /^\s*(?:oh|ah|aha)\s*[,!:—–-](?=\s*\S)/i },
  // 追问：句中出现 why + 问号（"Why?" 也算，允许零字符间隔）
  { id: 'why-q', re: /\bwhy\b[^.!?\n]*[?？]/i },
  // 推演：假设性反问
  { id: 'what-if', re: /\bwhat if\b/i },
  // 存疑：发现了不一致 / 不对劲
  {
    id: 'anomaly',
    re: /\b(?:contradict\w*|inconsistent|doesn'?t make sense|that(?:'s| is) (?:odd|weird|strange)|suspicious|red flag|smells?)\b/i,
  },
  { id: 'misread', re: /\bi\s+(?:misread|missed)\b/i, not: /^\s*(?:if|unless)\b/i },
  {
    id: 'hold-on',
    re: /^\s*(?:but\s+)?hold\s+on\s*[,!:—–-](?=\s*\S)/i,
    not: /^\s*(?:but\s+)?hold\s+on\s*[,!:—–-]\s*(?:maybe\s+)?(?:i|we)\s+(?:should|need|will|can|could)\b/i,
  },
  // 中文
  { id: 'zh-turn', re: /^\s*(?:等等|等一下|不对|其实|慢着|且慢)/ },
];

/** 明确排除：这些词单独出现时噪声太大（有实测数据支撑） */
const REJECT = /^\s*(?:let\s+me\b(?!\s+(?:reconsider|rethink|step\s+back)\b)|i\s+(?:need|should\b(?!\s+have\b)|will|can|'ll)|now\s+i|next,?\s*i)\b/i;

function firstHit(list, s) {
  for (const rule of list) {
    if (rule.not && rule.not.test(s)) continue;
    if (rule.re.test(s)) return rule.id;
  }
  return null;
}

/**
 * 判断一句话是否"有信号"。
 * @param {string} sentence
 * @returns {{tier: 'S'|'A', signal: string} | null}
 */
function classify(sentence) {
  if (typeof sentence !== 'string') return null;
  const s = sentence.trim();
  if (s.length === 0) return null;
  // 纯计划句直接排除（先于 A 层判定，避免 "Actually, let me ..." 被误收）
  if (REJECT.test(s)) return null;

  const hitS = firstHit(TIER_S, s);
  if (hitS) return { tier: 'S', signal: hitS };
  const hitA = firstHit(TIER_A, s);
  if (hitA) return { tier: 'A', signal: hitA };
  return null;
}

/* ------------------------------------------------------------------ *
 * 3. 选题：COT → beats
 * ------------------------------------------------------------------ */

/**
 * 从一段 reasoning 原文里挑出要展示的句子。
 *
 * 只收命中 S/A 层信号的句子；没有命中就返回空数组——运行时保持上一条不动，
 * 而不是塞一条摘要。空数组是正常结果，不是失败。
 *
 * @param {string} text reasoning 原文
 * @param {{maxChars?: number, completeOnly?: boolean}} [opts]
 * @returns {{sentence: string, tier: 'S'|'A', signal: string, at: number, end: number}[]}
 */
function selectBeats(text, opts = {}) {
  const { maxChars = 240, completeOnly = false } = opts;
  const beats = [];
  for (const s of splitSentences(text, completeOnly)) {
    if (s.text.length > maxChars) continue;
    const hit = classify(s.text);
    if (hit) {
      beats.push({ sentence: s.text, tier: hit.tier, signal: hit.signal, at: s.start, end: s.end });
    }
  }
  return beats;
}

/** 各工具"最有信息量的那个参数"，用于把调用展示成人能读的一条命令 */
const TOOL_ARG_KEYS = {
  bash: ['command'], pwsh: ['command'], shell: ['command'], terminal: ['command'],
  read: ['path', 'file_path'], write: ['path', 'file_path'], edit: ['path', 'file_path'],
  str_replace_editor: ['path', 'file_path'],
  grep: ['pattern'], glob: ['pattern'],
  web_search: ['query'], web_fetch: ['url'],
  subagent: ['description', 'prompt'], skill: ['name'],
};

const SHELL_TOOLS = new Set(['bash', 'pwsh', 'shell', 'terminal']);

/**
 * 把一次工具调用压成一行可读文本。
 * 命令类工具只显示命令本身；其他工具显示 `name + 关键参数`。
 * @param {string} name 工具名
 * @param {string} argsJson 模型产出的原始 JSON 字符串
 * @returns {string}
 */
function toolLabel(name, argsJson) {
  if (!name) return '';
  if (!argsJson) return name;
  let args;
  try {
    args = JSON.parse(argsJson);
  } catch {
    return name; // 流式中的半截 JSON：先退回工具名
  }
  if (!args || typeof args !== 'object') return name;

  const keys = TOOL_ARG_KEYS[name] || ['command', 'path', 'query', 'url', 'description', 'pattern', 'name'];
  let value = '';
  for (const k of keys) {
    if (typeof args[k] === 'string' && args[k].trim()) { value = args[k]; break; }
  }
  if (!value) {
    for (const v of Object.values(args)) {
      if (typeof v === 'string' && v.trim()) { value = v; break; }
    }
  }
  if (!value) return name;

  const flat = value.replace(/\s+/g, ' ').trim();
  return SHELL_TOOLS.has(name) ? flat : name + ' ' + flat;
}

/** Text segments for React highlighting; never interpret model text as HTML. */
function signalParts(sentence, signal) {
  const rule = [...TIER_S, ...TIER_A].find(rule => rule.id === signal);
  const match = rule?.re.exec(sentence);
  return match ? [sentence.slice(0, match.index), match[0], sentence.slice(match.index + match[0].length)]
    : [sentence, '', ''];
}
    
/** Observe new events only; history loading is never a playback trigger. */
function watchKeyframes(binding, onChange, now = Date.now) {
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


    /* ---------------------------------------------------------------- *
     * 样式
     * ---------------------------------------------------------------- */

    /** badge 文案走宿主的 locale 服务，跟随 DSH 的界面语言 */
    const NS = 'cotKeyframes';

    const zh = {
      sig_self_wrong: '自我纠错', sig_my_mistake: '自我纠错', sig_mistaken: '自我纠错',
      sig_realize: '自我纠错', sig_should_have: '自我纠错', sig_good_catch: '自我纠错',
      sig_zh_wrong: '自我纠错', sig_zh_realize: '自我纠错',
      sig_wait_start: '转向', sig_wait_turn: '转向', sig_zh_turn: '转向',
      sig_hmm_turn: '存疑', sig_anomaly: '存疑',
      sig_actually_start: '判断', sig_no_start: '判断',
      sig_why_q: '追问', sig_what_if: '推演',
      sig_reconsider: '重估', sig_oh_start: '察觉',
      sig_misread: '自我纠错', sig_hold_on: '转向',
      sig_error: '失败',
      pending: '等待调用', unknown_tool: '未知工具', tool_failed: '工具调用失败',
    };

    const en = {
      sig_self_wrong: 'Self-correct', sig_my_mistake: 'Self-correct', sig_mistaken: 'Self-correct',
      sig_realize: 'Self-correct', sig_should_have: 'Self-correct', sig_good_catch: 'Self-correct',
      sig_zh_wrong: 'Self-correct', sig_zh_realize: 'Self-correct',
      sig_wait_start: 'Pivot', sig_wait_turn: 'Pivot', sig_zh_turn: 'Pivot',
      sig_hmm_turn: 'Doubt', sig_anomaly: 'Doubt',
      sig_actually_start: 'Verdict', sig_no_start: 'Verdict',
      sig_why_q: 'Why?', sig_what_if: 'What if',
      sig_reconsider: 'Rethink', sig_oh_start: 'Noticed',
      sig_misread: 'Self-correct', sig_hold_on: 'Pivot',
      sig_error: 'Failed',
      pending: 'Waiting for a tool', unknown_tool: 'Unknown tool', tool_failed: 'Tool call failed',
    };

    /** 构建时间戳，由 build.mjs 注入；挂在 DOM 上便于确认跑的是哪一版 */
    const BUILD = '20261030034549';

    const CSS = `
.cot-kf-dock{
  --cot-kf-tint:var(--dsw-alias-state-business-primary);
  box-sizing:border-box;flex:1 1 auto;min-width:0;
  width:calc(100% - var(--dsh-composer-side-clearance) * 2);
  max-width:var(--dsh-composer-card-max-width);
  margin:0 auto;padding:9px 14px 8px;border-radius:14px;
  background:color-mix(in srgb,var(--dsw-alias-bg-base) 78%,transparent);
  backdrop-filter:blur(14px) saturate(1.4);
  border:1px solid color-mix(in srgb,var(--cot-kf-tint) 22%,transparent);
  animation:cot-kf-in 220ms ease-out both;
}
.cot-kf-dock[data-cot-keyframe="S"]{--cot-kf-tint:var(--dsw-alias-state-warn-primary)}
.cot-kf-dock[data-cot-keyframe="E"]{--cot-kf-tint:var(--dsw-alias-state-error-primary)}
.cot-kf-stack{display:flex;flex-direction:column;width:100%;min-width:0}
.cot-kf-text,.cot-kf-cmdtext{min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.cot-kf-text{color:var(--dsw-alias-label-primary);font-size:13.5px;line-height:1.55}
.cot-kf-badge{
  display:inline-block;vertical-align:1.5px;margin-right:8px;
  padding:1px 6px;border-radius:4px;font-size:10px;font-weight:600;line-height:1.45;
  color:var(--cot-kf-tint);
  background:color-mix(in srgb,var(--cot-kf-tint) 13%,transparent);
  border:1px solid color-mix(in srgb,var(--cot-kf-tint) 26%,transparent);
}
.cot-kf-mark{
  color:inherit;font-weight:650;padding:0 1px;border-radius:2px;
  background:color-mix(in srgb,var(--cot-kf-tint) 18%,transparent);
}
.cot-kf-cmd{
  display:flex;align-items:baseline;gap:6px;min-width:0;margin-top:5px;
  font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;
  font-size:10.5px;line-height:1.45;color:var(--dsw-alias-label-tertiary);
}
.cot-kf-cmdtext{flex:1}
.cot-kf-caret{flex:none;color:var(--cot-kf-tint);animation:cot-kf-blink 1.4s steps(1,end) infinite}
.cot-kf-count{flex:none}
@keyframes cot-kf-in{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:none}}
@keyframes cot-kf-blink{0%,55%{opacity:.9}56%,100%{opacity:.25}}
@media(prefers-reduced-motion:reduce){.cot-kf-dock,.cot-kf-caret{animation:none}}
`;

    function KeyframeDock({ keyframeBinding, t }) {
      const [display, setDisplay] = React.useState(null);

      React.useEffect(() => {
        setDisplay(null);
        if (!keyframeBinding) return; // DSH returns no binding after a session is released.
        return watchKeyframes(keyframeBinding, (frame) =>
          setDisplay({ binding: keyframeBinding, frame }),
        );
      }, [keyframeBinding]);

      const frame = display?.binding === keyframeBinding ? display.frame : null;
      if (!frame) return null;

      const sentence = frame.sentence || t('tool_failed');
      const [before, keyword, after] = signalParts(sentence, frame.signal);
      const tools = frame.tools;
      const command = tools.at(-1) || t(frame.tier === 'E' ? 'unknown_tool' : 'pending');

      return React.createElement(
        'div',
        {
          className: 'cot-kf-dock',
          'data-cot-keyframe': frame.tier,
          'data-cot-kf-build': BUILD,
          role: 'status',
          'aria-live': 'polite',
          'aria-atomic': true,
        },
        React.createElement(
          'div',
          { className: 'cot-kf-stack' },
          React.createElement(
            'div',
            { className: 'cot-kf-text', title: sentence },
            React.createElement('span', { className: 'cot-kf-badge' }, t('sig_' + frame.signal.replace(/-/g, '_'))),
            before,
            keyword ? React.createElement('mark', { className: 'cot-kf-mark' }, keyword) : null,
            after,
          ),
          React.createElement(
            'div',
            { className: 'cot-kf-cmd' },
            React.createElement('span', { className: 'cot-kf-caret', 'aria-hidden': 'true' }, '❯'),
            React.createElement('span', { className: 'cot-kf-cmdtext', title: tools.join('\n') || command }, command),
            tools.length > 1
              ? React.createElement('span', { className: 'cot-kf-count' }, '+' + (tools.length - 1))
              : null,
          ),
        ),
      );
    }

    function apply(ctx) {
      ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'cot-keyframes: dictionaries');
      ctx.effect(() => {
        const style = document.createElement('style');
        style.textContent = CSS;
        document.head.appendChild(style);
        return () => style.remove();
      }, 'cot-keyframes: styles');
      ctx.slots.inject('conversation.input.dock', () => ctx.slots.register({
        name: 'conversation.input.dock', id: 'cot-keyframes', order: 10, locale: NS,
        inject: sessionId => ({ keyframeBinding: ctx.sessions.binding(sessionId) }),
      }, KeyframeDock));
    }
    return { apply, inject: ['slots', 'sessions', 'locale'] };
  },
});
