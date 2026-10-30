# CoT Keyframes · 雷霆大思考

[English](README.md) · 简体中文

一个 DeepSeek Harness 插件，在输入框上方，用两行展示关键思考句和对应的工具调用。

```text
转向  Wait — the cache key ignores the session.
❯ rg "cacheKey" src/
```

- 捕捉自我纠错、思路转向和新发现，支持中英文信号。
- 关键句关联同一步的工具调用，工具失败时显示错误。
- 跟随 DSH 主题和界面语言，正文开始输出时隐藏。
- 本地关键词匹配，不额外调用模型。

## 安装

面向 **DSH Desktop 0.2.1-rc.3**。

```sh
git clone https://github.com/cbccbcc/dsh-cot-keyframes.git
cd dsh-cot-keyframes
dsh plugin --profile desktop add "link:$PWD"
```

仓库已包含构建产物，无需 `npm install`。请保留克隆目录，DSH 会从这里加载插件。

## 开发

修改 `src/` 后，构建并运行测试：

```sh
npm test
```

重启 DSH 加载改动。信号词表位于 [`src/core.mjs`](src/core.mjs)。

## 许可证

[MIT](LICENSE)
