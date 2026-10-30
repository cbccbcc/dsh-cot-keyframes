# CoT Keyframes · 雷霆大思考

[English](https://github.com/cbccbcc/dsh-cot-keyframes#readme) · 简体中文

一个 DeepSeek Harness 插件，在输入框上方，用两行展示关键思考句和对应的工具调用。

![CoT Keyframes 浅色主题效果](https://raw.githubusercontent.com/cbccbcc/dsh-cot-keyframes/main/assets/preview.png)

*组件效果预览 · 浅色主题。*

- 通过中英文关键词表（正则规则），匹配 `I was wrong`、`Hold on`、`等等` 等信号，不额外调用模型。
- 关键句关联同一步的工具调用，工具失败时显示错误。
- 跟随 DSH 主题和界面语言，正文开始输出时隐藏。

## 安装

面向 **DSH Desktop 0.2.1-rc.3**。

```sh
dsh plugin --profile desktop add dsh-plugin-cot-keyframes
```

## 定制你的词表

克隆仓库后，修改 [`src/core.mjs`](https://github.com/cbccbcc/dsh-cot-keyframes/blob/main/src/core.mjs) 中的匹配规则，适配你关注的表达。保留现有信号 ID 即可复用标签；新增 ID 时，还需在 [`src/client.template.js`](https://github.com/cbccbcc/dsh-cot-keyframes/blob/main/src/client.template.js) 中补上中英文标签。

```sh
git clone https://github.com/cbccbcc/dsh-cot-keyframes.git
cd dsh-cot-keyframes
# 修改 src/core.mjs 中的关键词规则。
npm test
dsh plugin --profile desktop add "link:$PWD"
```

重启 DSH 加载你的版本。请保留克隆目录，DSH 会从这里加载插件。

## 许可证

[MIT](https://github.com/cbccbcc/dsh-cot-keyframes/blob/main/LICENSE)
