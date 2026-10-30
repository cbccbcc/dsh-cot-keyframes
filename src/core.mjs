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
export function splitSentences(text, completeOnly = false) {
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
export function classify(sentence) {
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
export function selectBeats(text, opts = {}) {
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
export function toolLabel(name, argsJson) {
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
export function signalParts(sentence, signal) {
  const rule = [...TIER_S, ...TIER_A].find(rule => rule.id === signal);
  const match = rule?.re.exec(sentence);
  return match ? [sentence.slice(0, match.index), match[0], sentence.slice(match.index + match[0].length)]
    : [sentence, '', ''];
}
