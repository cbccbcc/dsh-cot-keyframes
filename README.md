# CoT Keyframes

English · [简体中文](https://github.com/cbccbcc/dsh-cot-keyframes/blob/main/README.zh-CN.md)

A DeepSeek Harness plugin that surfaces key reasoning moments and their tool calls above the chat input.

![CoT Keyframes in the light theme](https://raw.githubusercontent.com/cbccbcc/dsh-cot-keyframes/main/assets/preview.png)

*Component preview · Light theme.*

- Uses a bilingual keyword list (regex rules) to catch phrases such as `I was wrong`, `Hold on`, and `等等`. No extra model calls.
- Pairs each highlight with tool calls from the same step; surfaces tool failures.
- Follows the DSH theme and language. Hides when response text begins.

## Install

Targets **DSH Desktop 0.2.1-rc.3**.

```sh
dsh plugin --profile desktop add dsh-plugin-cot-keyframes
```

## Tailor your keyword list

Clone the repo and edit the matching rules in [`src/core.mjs`](https://github.com/cbccbcc/dsh-cot-keyframes/blob/main/src/core.mjs) to fit your vocabulary. Reuse existing signal IDs to keep their labels; new IDs also need English and Chinese labels in [`src/client.template.js`](https://github.com/cbccbcc/dsh-cot-keyframes/blob/main/src/client.template.js).

```sh
git clone https://github.com/cbccbcc/dsh-cot-keyframes.git
cd dsh-cot-keyframes
# Edit the keyword rules in src/core.mjs.
npm test
dsh plugin --profile desktop add "link:$PWD"
```

Restart DSH to load your version. Keep the cloned directory—DSH loads the plugin from it.

## License

[MIT](https://github.com/cbccbcc/dsh-cot-keyframes/blob/main/LICENSE)
