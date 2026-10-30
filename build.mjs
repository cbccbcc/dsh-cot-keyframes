#!/usr/bin/env node
/**
 * 把 src/core.mjs 内联进 src/client.template.js，产出 lib/client.js。
 * 没有外部依赖：只用 node 内置模块。
 *
 * 之所以内联而不是 import：DSH 的客户端 bundle 由 __ModuleLoader__ 加载，
 * React 使用宿主提供的模块，插件自己的子模块直接内联，
 * 自己的子路径不保证能解析。内联最稳。
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));

const core = readFileSync(join(root, 'src/core.mjs'), 'utf8');
const template = readFileSync(join(root, 'src/client.template.js'), 'utf8');

// 去掉 ESM 导出关键字，让函数变成同一作用域内的声明
const inlined = core
  .replace(/^export\s+(?=(?:async\s+)?function|const|let|class)/gm, '')
  .replace(/^export\s+default\s+/gm, 'const __default = ')
  .trim();

if (!template.includes('/*__CORE__*/')) {
  console.error('模板缺少 /*__CORE__*/ 占位符');
  process.exit(1);
}

const live = readFileSync(join(root, 'src/live.mjs'), 'utf8')
  .replace(/^import .* from .*;\n/gm, '')
  .replace(/^export\s+/gm, '');
const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
const out = template
  .replace('/*__CORE__*/', inlined)
  .replace('/*__LIVE__*/', live)
  .replace('__COT_KF_BUILD__', stamp);
// 一致性守卫：这三处的名字必须完全相同，否则客户端模块表对不上（曾两次踩坑）
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const patch = readFileSync(join(root, 'cordis.patch.yml'), 'utf8');
const declaredId = template.match(/id:\s*'([^']+)'/)?.[1];
if (declaredId !== pkg.name) {
  console.error(`✗ bundle id (${declaredId}) 与包名 (${pkg.name}) 不一致`);
  process.exit(1);
}
if (!patch.includes(pkg.name)) {
  console.error(`✗ cordis.patch.yml 没有引用包名 ${pkg.name}`);
  process.exit(1);
}
if (!pkg.dsh?.bundle?.patch || !pkg.dsh?.client?.platform) {
  console.error('✗ package.json 缺少 bundle.patch 或 client.platform');
  process.exit(1);
}

// 语法自检
try {
  new Function(out);
} catch (err) {
  console.error('✗ 生成的 bundle 语法错误：', err.message);
  process.exit(1);
}

const target = join(root, 'lib/client.js');
mkdirSync(dirname(target), { recursive: true });
writeFileSync(target, out);
console.log('✓ lib/client.js 已生成，语法检查通过');
