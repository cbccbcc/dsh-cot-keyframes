# CoT Keyframes

运行任务时，在输入框上方显示两行：**关键思考句 + 同一步的工具调用**。
插件中文展示名为「雷霆大思考」，英文为「Wait, Oh Wait…」。
原始思考、工具记录、历史会话仍由 DSH 渲染；插件不修改会话记录，不调用额外模型。

```
转向  Wait — the fallback path never sets the timeout…
❯ npm test -- --watch
```

## 安装与开发

```sh
git clone https://github.com/cbccbcc/dsh-cot-keyframes.git
cd dsh-cot-keyframes
dsh plugin --profile desktop add "link:$PWD"
```

当前通过 GitHub 分发，尚未发布到 npm。仓库已包含构建产物，无需安装 npm 依赖。
修改源码后运行 `npm test`，再重新加载插件的客户端。桌面发布版不要假定 Cmd/Ctrl+R 生效；
确认页面的 `data-cot-kf-build` 与新产物一致，必要时保存其他工作后重启 DSH。

```sh
npm test                        # 构建、纯函数与事件测试、组件渲染路径检查
npm pack --dry-run              # prepack 先构建，再检查发布文件
node scripts/dryrun.mjs <会话目录或jsonl文件>  # 本地词表分析，不是运行时验收
```

## 展示规则

- 默认只在 reasoning 块结束时选取第一条命中句；无命中时保留上一条，不生成兜底摘要。
- 每轮尚未展示过任何内容时，允许一次流式补位。英文句末需等后续空白，中文句末可直接确认；
  与完整块共用分句逻辑，保护代码、缩写和括号，不把 chunk 结束当作句子结束。
- 关键句只关联其所属 step 的工具。第二行显示最新命令和其余数量，悬停可看全部同一步命令；
  暂无调用时显示「等待调用」。第一行悬停可看完整句子。
- 阅读停留时间为 `min(10000ms, max(1800ms, 字符数 / 26 × 1000ms))`。
  窗口内的新关键句直接丢弃，不排队。
- 工具失败会立即显示错误，并按 `toolCallId` 配对失败的命令。未找到该调用时显示「未知工具」，
  不借用其他命令。长错误最多停留 10 秒，完整错误仍保存在原工具记录中。
- 正文开始输出时隐藏；同一步随后出现工具或新的思考时，按后续事件恢复对应关键句。
  DSH 尚无插件可直接使用的“最终回答开始”标记，因此中途说明可能短暂隐藏展示条。
- 任务结束、取消、重试时清空。打开历史会话、刷新、重连不回放旧思考。

## 与 DSH 的集成

- 使用 `conversation.input.dock` 槽，不使用 overlay，也不覆盖原生思考组件。
- 通过 `ctx.slots.inject()` 跟随槽的生命周期；`locale` 声明让宿主提供当前语言的 `t`。
- 使用 `sessions.binding()` 订阅新事件，仅保存当前视图的阅读状态，不扫描或重放历史。
  这是瞬时展示状态，不是需要持久化的会话事实；因此不新增 Host projection 或存储。
- 尺寸使用宿主 composer 变量，颜色使用 `--dsw-alias-*` 主题令牌。
  标签用本地简单元素，全文提示用原生 `title`，不导入不稳定的 Harness Client 内部组件。
- 词典和样式由 `ctx.effect()` 注册并清理；组件卸载时取消订阅。
  减少动态效果模式同时关闭入场和光标动画。

## 信号词表

| 层 | 信号示例 | 中文 / 英文标签 |
|---|---|---|
| S | `I was wrong` / `my mistake` / `I realize` / `I should have` / 我错了 | 自我纠错 / Self-correct |
| A | `Wait` / `but wait` / `Hold on` / `But hold on` | 转向 / Pivot |
| A | `I misread` / `I missed` | 自我纠错 / Self-correct |
| A | `Oh` / `Ah` / `Aha` | 察觉 / Noticed |
| A | `why …?` / `what if` | 追问 / Why?；推演 / What if |
| A | `inconsistent` / `doesn't make sense` / `suspicious` | 存疑 / Doubt |
| A | `Actually` / `No,` | 判断 / Verdict |
| A | `let me reconsider` | 重估 / Rethink |
| E | 工具调用失败 | 失败 / Failed |

保留短但有效的信号，如 `Why?`，仅排除超过 240 字符的思考句。
`Hold on` 与 `Oh/Ah/Aha` 需在句首，后接标点及同句内容；排除单独感叹和等待指令。
`Hold on` 后的常见计划句、以 `if/unless` 开头的 `I misread/I missed` 假设句不作为这些信号入选。
词表在源码 `src/core.mjs`，开发者可修改后构建；安装包不提供自定义词表设置。
`dryrun.mjs` 的候选覆盖率不计停留窗口、流式补位和最终正文，因此不等于实际展示率。

## 文件

| 文件 | 作用 |
|---|---|
| `package.json` / `cordis.patch.yml` | 单包同时提供 bundle 配置和 client 入口 |
| `lib/index.js` | Host 入口，导出空 `apply()` 以满足加载契约 |
| `lib/client.js` | 浏览器构建产物，由 `__ModuleLoader__` 加载 |
| `src/core.mjs` | 分句、信号匹配、工具标签、高亮 |
| `src/live.mjs` | 当前视图的事件状态机 |
| `src/client.template.js` | 组件、样式、词典和槽注册 |
| `scripts/dryrun.mjs` | 本地会话词表分析 |

## 验证边界

目标接口版本为桌面 DSH **0.2.1-rc.3**。包名、bundle id 和 patch 引用必须一致。
`npm test` 包含实际构建组件的渲染路径检查，但不是 DSH 浏览器集成测试。
发布验收还需在 DSH 中确认：思考折叠时运行条可见、工具配对正确、最终正文出现后隐藏，
以及重新加载后没有旧样式或旧订阅残留。宿主升级后应重新验证这些接口。

## 许可证

MIT，见 [LICENSE](./LICENSE)。
