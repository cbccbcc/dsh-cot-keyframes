import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('built dock renders non-empty frames, localizes placeholders and cleans up its styles', () => {
  const binding = {};
  let plugin, options, Component, dictionaries, display, effect;
  const cleanup = [], styles = [];
  // Controlled hooks exercise the shipped component; this is not a browser test.
  const React = {
    useState: () => [display, () => {}], useEffect: fn => { effect = fn; },
    createElement: (type, props, ...children) => ({ type, props, children }),
  };
  const document = {
    createElement: () => ({ remove() { styles.splice(styles.indexOf(this), 1); } }),
    head: { appendChild: style => styles.push(style) },
  };
  new Function('window', 'document', readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8'))({
    __ModuleLoader__: { load: ({ factory }) => {
      plugin = factory(name => { assert.equal(name, 'react'); return React; });
    } },
  }, document);
  plugin.apply({
    effect: fn => { const stop = fn(); cleanup.push(stop); return stop; },
    locale: { register: (_, d) => { dictionaries = d; return () => { dictionaries = null; }; } },
    slots: { inject: (_, fn) => fn(), register: (o, component) => { options = o; Component = component; } },
    sessions: { binding: () => binding },
  });
  assert.equal(options.name, 'conversation.input.dock');
  assert.equal(options.locale, 'cotKeyframes');
  assert.equal(options.inject('test').keyframeBinding, binding);
  assert.equal(styles.length, 1);
  const render = (frame, lang) => {
    display = { binding, frame };
    return Component({ keyframeBinding: binding, t: key => {
      assert.ok(dictionaries[lang][key], `missing translation: ${key}`);
      return dictionaries[lang][key];
    } });
  };
  assert.equal(render(null, 'en'), null);
  const frame = { sentence: 'Wait — inspect core.mjs.', signal: 'wait-start', tier: 'A', tools: [] };
  const node = render(frame, 'en');
  assert.equal(node.props.role, 'status');
  const [thought, command] = node.children[0].children;
  assert.equal(thought.props.title, frame.sentence);
  assert.equal(command.children[1].children[0], 'Waiting for a tool');
  const failed = render({ sentence: '', signal: 'error', tier: 'E', tools: [] }, 'zh');
  assert.equal(failed.children[0].children[0].props.title, '工具调用失败');
  assert.equal(failed.children[0].children[1].children[1].children[0], '未知工具');
  assert.equal(Component({ keyframeBinding: {}, t: key => key }), null, 'switching session hides the old frame');
  Component({ keyframeBinding: undefined, t: key => key });
  assert.doesNotThrow(() => effect(), 'a released session has no subscription');
  cleanup.reverse().forEach(stop => stop());
  assert.equal(styles.length, 0);
  assert.equal(dictionaries, null);
});

test('every signal in core has a label in both dictionaries', () => {
  const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
  const ids = new Set([...read('../src/core.mjs').matchAll(/id: '([a-z-]+)'/g)].map(m => m[1].replace(/-/g, '_')));
  ids.add('error'); // 工具失败不是词表信号，但同样要出 badge
  assert.ok(ids.size >= 20, '信号数量异常: ' + ids.size);

  const src = read('../lib/client.js');
  const dictOf = (lang) => {
    const start = src.indexOf(`const ${lang} = {`);
    assert.ok(start > 0, `找不到 ${lang} 词典`);
    const end = src.indexOf('\n    };', start);
    assert.ok(end > start, `${lang} 词典没有闭合`);
    return src.slice(start, end);
  };
  for (const lang of ['zh', 'en']) {
    const dict = dictOf(lang);
    for (const id of ids) assert.ok(dict.includes(`sig_${id}:`), `${lang} 缺少 sig_${id}`);
    for (const key of ['pending', 'unknown_tool', 'tool_failed']) {
      assert.ok(dict.includes(`${key}:`), `${lang} 缺少 ${key}`);
    }
  }
});
