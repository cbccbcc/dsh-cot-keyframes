window.__ModuleLoader__.load({
  id: 'dsh-plugin-cot-keyframes',
  factory: (require) => {
    const React = require('react');
    /*__CORE__*/
    /*__LIVE__*/

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
    const BUILD = '__COT_KF_BUILD__';

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
