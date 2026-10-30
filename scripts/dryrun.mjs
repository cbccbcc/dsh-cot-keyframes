#!/usr/bin/env node
/**
 * 用真实会话数据跑一遍核心逻辑，输出：
 *   - 分句质量
 *   - 候选覆盖率（多少 reasoning block 命中词表，不模拟运行时停留窗口）
 *   - 命中句样本（人工核验用）
 *
 * 用法：node scripts/dryrun.mjs <session 目录或 jsonl 文件...>
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { splitSentences, selectBeats } from '../src/core.mjs';

const args = process.argv.slice(2);
if (args.length === 0) {
  console.error('用法: node scripts/dryrun.mjs <dir|file>...');
  process.exit(1);
}

/** 递归收集 .jsonl / .jsonl.zstd */
function collect(p, out = []) {
  const st = statSync(p);
  if (st.isDirectory()) {
    for (const name of readdirSync(p)) collect(join(p, name), out);
  } else if (p.endsWith('.jsonl') || p.endsWith('.jsonl.zstd')) {
    out.push(p);
  }
  return out;
}

function lines(file) {
  if (file.endsWith('.zstd')) {
    return execFileSync('zstd', ['-d', '-c', file], { maxBuffer: 1 << 30 }).toString('utf8');
  }
  return readFileSync(file, 'utf8');
}

const blocks = [];
for (const file of args.flatMap((a) => collect(a))) {
  let raw;
  try {
    raw = lines(file);
  } catch {
    continue;
  }
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    let ev;
    try {
      ev = JSON.parse(line);
    } catch {
      continue;
    }
    if (ev.type !== 'assistant/message') continue;
    const content = ev.data?.message?.content ?? [];
    // 按 block 收集：reasoning 文本 + 同 step 的 tool-call 名字
    const reasoning = content.filter((b) => b?.type === 'reasoning' && b.text).map((b) => b.text);
    const tools = content.filter((b) => b?.type === 'tool-call').map((b) => b.name).filter(Boolean);
    for (const text of reasoning) blocks.push({ text, tools });
  }
}

if (blocks.length === 0) {
  console.error('没有找到 reasoning block');
  process.exit(1);
}

/* ---------- 统计 ---------- */
let totalSentences = 0;
const sentenceLens = [];
let withBeats = 0;
const tiers = { S: 0, A: 0 };
const samples = [];
const bySignal = new Map();

for (const b of blocks) {
  const sents = splitSentences(b.text);
  totalSentences += sents.length;
  for (const s of sents) sentenceLens.push(s.text.length);

  const beats = selectBeats(b.text);
  if (beats.length > 0) withBeats++;

  // 只统计候选；实际展示还取决于运行时停留窗口。
  const first = beats[0];
  for (const f of beats) tiers[f.tier]++;
  if (first) {
    bySignal.set(first.signal, (bySignal.get(first.signal) || 0) + 1);
    if (samples.length < 40) samples.push({ ...first, tools: b.tools });
  }
}

const pct = (n, d) => `${((n / d) * 100).toFixed(0)}%`;
const q = (arr, p) => {
  const a = [...arr].sort((x, y) => x - y);
  return a[Math.min(a.length - 1, Math.floor(a.length * p))];
};

console.log('══ 分句 ══');
console.log(`  blocks=${blocks.length}  sentences=${totalSentences}  平均 ${(totalSentences / blocks.length).toFixed(1)} 句/block`);
console.log(`  句长 p50=${q(sentenceLens, 0.5)} p90=${q(sentenceLens, 0.9)} p99=${q(sentenceLens, 0.99)} max=${Math.max(...sentenceLens)}`);

console.log('\n══ 候选覆盖率（不代表实际展示率）══');
console.log(`  有 ≥1 候选句的 block: ${withBeats}/${blocks.length} (${pct(withBeats, blocks.length)})`);

console.log('\n══ 层级分布 ══');
console.log(`  S=${tiers.S}  A=${tiers.A}  (S 占比 ${pct(tiers.S, tiers.S + tiers.A || 1)})`);

console.log('\n══ 各信号贡献 ══');
for (const [k, v] of [...bySignal.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${k.padEnd(14)} ${v}`);
}

console.log('\n══ 命中样本（前 24 条，人工核验）══');
for (const s of samples.slice(0, 24)) {
  const t = s.tools.length ? ` [tool: ${s.tools.join(',')}]` : '';
  console.log(`  [${s.tier}]${t}  ${s.sentence.slice(0, 150)}`);
}
