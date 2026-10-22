# 工作区过渡动效验收

- Date: 2026-10-22
- Source baseline: `649c9cd0b230c6979cbfbc913b4e5ba94e2a46f6`
- Status: 源码与隔离验收完成，正式包/生产服务未替换。

## 新增效果

1. 已有对话之间切换，消息内容区使用180ms、opacity .35→1的有限淡入。保留既有scroll/content ref和消息DOM生命周期，不逐条重播历史行；key只有会话ID和模式，不依赖流式正文、语音进度或草稿。
2. Chat/Agent控制区切换及返回Chat时使用同样的短淡入。只改opacity，不transform含fixed菜单的祖先、不延迟业务模式或权限状态。
3. 侧栏当前项增加轻量的选中指示条，160/180ms opacity/scale过渡，文字和点击区域不移动。
4. 右侧消息导航有限入场，收放时追加10px以内位移/轻微缩放。收起仍立即inert、aria-hidden、tabIndex=-1，只有视觉退场延续，隐藏按钮不接收交互。

模型菜单、原有弹窗/按钮/欢迎页/消息入口已具备动效，本轮没有重复增加。没有新动画库、常驻rAF、尺寸/模糊动画或新的应用state/timer；CSS复用full/reduced/off策略，隐藏或减少动态效果时有限入口被清理，不因恢复重播。

## 回归与构建

证据根为ignored `.tools/workspace-transitions-20261022/`。

| 验证 | 结果 | 证据 |
| --- | --- | --- |
| 真实useUiEntrance、原controller、消息动效及App交互 | 160/160，无失败/跳过/取消 | `entrance-hook-app-regression.log` |
| Chat+Agent、伙伴世界、弹层/视口等兼容 | 39/39，无失败/跳过/取消 | `entrance-compatibility-regression.log` |
| TypeScript | exit 0 | `typecheck.log` |
| 隔离Vite构建 | exit 0，3.76秒 | `build.log`，产物位于上述ignored目录的`dist/` |
| 公开源码审计 | 1704文件通过，无问题 | `public-source-audit.log` |

新增12项执行生产hook而非复制实现：既有ref、scrollTop/图片节点身份保持，相同key40次render不重播，key/ref对象变化清理旧订阅，view关闭/重入、reduced/hidden/off及卸载清理。既有ref的节点替换必须伴随key、active或ref对象变化；本hook不观察静默的ref.current修改，App节点重挂符合该契约。未新增仅镜像CSS字面量的测试。

## Chrome插件验收

使用新临时JsonStore、两个合成Chat历史、暂停的两项Agent队列。所有监听仅loopback，前端API变更被405拦截，桥接执行及音频禁止，未用真实模型或业务数据。

- Chat A→B：观察到一次`chat-scroll-content`的`ui-workspace-in` start/end；原reading/scroll DOM身份保持，旧历史没有`ui-message-enter`。输入并清空草稿前后animationstart计数1→1，未重播。
- Chat→已有Agent：控制区和消息区分别触发一次有限入口。控制区/消息区computed transform均为none。桌面模型菜单left792.5/right1152.5，位于2560宽视口内。
- Chrome模拟prefers-reduced-motion=reduce时，对话/模式切换computed animationName均为none，无新marker，新增入口start计数3→3。媒体策略事件在扩展中有延后交付，但CSS媒体门禁立即生效。隐藏/off和恢复不重播另由真实hook/controller回归覆盖，非原生后台实测。
- 412×960时scrollWidth=412；消息导航记录`ui-dock-in` start/end与opacity/transform/visibility过渡。收起即时inert=true、aria-hidden=true、tabIndex=-1，焦点留在“展开消息导航”按钮，布局无溢出。
- 从设置通过键盘切换夜间，模型菜单left16/right376/top159/bottom355.79，位于手机视口内；控制区transform=none。菜单动画完成后opacity=1，已截图并视觉检查。最后恢复日间、媒体/设备模拟并关闭本轮标签。

上述结果是浏览器受控交互与动画事件，CSS配置为180ms，不把扩展后台节流后的事件交付时差当作前台帧率或真实播放时长。未测实体手机FPS、GPU占用或原生客户端体验。

原始结果位于`browser/`：`conversation-switch.json`、`input-no-replay.json`、`mode-switch-popup.json`、`reduced-motion.json`、`mobile-dock-collapse.json`、`mobile-night-popup.json`及`mobile-night-settled.json`。截图`mobile-dock-expanded.jpg`与`mobile-night-popup-settled.jpg`为实际JPEG，已视觉检查。最早夜间截图处于菜单动画开头，保留为`mobile-night-popup.jpg`，不作为最终可见菜单证明；手机模拟下主题radio点击坐标未生效，随后通过键盘Space完成并验证，没有改产品绕过。

## 自审与交付边界

自审确认需求、reduced/off清理、稳定key、固定菜单定位和隐藏按钮语义一致。源码/测试/文档按issue提交；测试state与截图不入Git，生产dist、v0.9.14标签、安装包和更新清单保持。新建夹具在收尾退出并核验零残留监听；不宣称新版已部署或客户端已重打。
