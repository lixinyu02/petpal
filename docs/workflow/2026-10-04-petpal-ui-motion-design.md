# 界面动效迭代

- Date: 2026-10-04
- Complexity: L1
- Status: final

## Goal

在现有暖白与墨绿界面中增加轻、短、可感知的反馈，保持消息阅读、表单输入和人物模型稳定。内容主次不变，界面动效不承担角色建模或实际语音任务。

## Solution

- 页面/设置页签与欢迎区有限淡入，标题、图标等没有 fixed 后代的叶子可以轻移；按钮 hover/按压与焦点反馈，弹窗/状态提示短淡入。
- 当前已挂载会话的新增正式消息只入场一次；初次挂载已有的消息、切换会话、流式字块与朗读刷新不重复入场。现有欢迎页与消息分支保持；发送过程中的数字形式 `user-…`/`pending-…` 临时 ID 静态消费，正式 ID 到来后才入场，避免乐观消息替换时重复淡入。
- 语音状态旁加入装饰波形，只在真实倾听/说话相位活动，不代表采集或声学音量。人物、声学口型与实时字幕保持原实现。
- 一个根生命周期监测系统减少动效偏好、页面可见性及 pagehide/pageshow，写 `data-ui-motion=full/reduced/off`。有限入口在完成、取消、隐藏、减少动效或卸载时清理，恢复前台不补播旧消息。
- 不引入动画框架、永久 requestAnimationFrame、轮询或逐条消息计时器；不增加首页控件或新的人物资源。CSS 只动画 opacity/transform，带 fixed 后代的消息/页面/弹窗容器仅 opacity，避免图片/模型菜单的定位基准变化。

## Scope and Verification

本轮只改前端与测试/文档，保留上游、权限、下载正式包与模型资产。生命周期与消息 ID 行为用独立测试验证，运行相关回归、TypeScript 与隔离生产构建。优先 Chrome 验收真实点击切换、消息流、动效完成、减少动效/隐藏恢复、图片预览、412×960、日夜主题及人物显示；网页静态同步保留原安装包与更新签名。安装包不在本轮重打。

## Verification Result

- 完整串行回归 1810/1810，通过 TypeScript、隔离 Vite 生产构建、公开源码凭据审计与 diff 检查。
- Chrome 插件使用隔离后端与本地 Responses SSE，真实 animationstart/end 记录验证：临时 ID 无入场，两个正式消息各一次；多个流式 delta、完成和历史切换没有重播；标记收尾清除。
- 图片预览覆盖实际视口，所有祖先 transform/filter 为 none。聊天、设置、下载在实际 CSS 视口 412×960 无横向溢出；日/夜主题与 Cubism 人物显示正常。Chrome 当前站点缩放不同，验收以 innerWidth/innerHeight 为准。
- Chrome 模拟系统减少动效后，实际波形 CSS 为 none；隔离 QA 页面使用同一 CSS/controller 验证 listening/speaking/idle。隐藏、pagehide、StrictMode 与恢复清理由生命周期测试覆盖；没有冒充实机麦克风、ASR、TTS或客户端安装验收。
- 修复 Vite 同名 `.mjs`/`.ts` 入口解析，显式导入 `.ts`；三个旧 VM React fixture 补齐真实模块桥接，原业务断言保留。
- 2026-10-04 网页静态上线，公网 index SHA-256 `8e703b08770f85485329a867723b306e5262a0bdff224679deb21ce0192d3cf5` 与最终构建相同；仅更换静态文件，没有重启后端。模型、0.9.7 正式发布清单、SHA256SUMS 与签名更新元数据校验保持一致；隔离 QA 文件排除部署。
- 验收日志、动画记录、截图与部署回退文件存放在忽略目录 `evidence/ui-motion-20261004/`。首次完整测试的旧 fixture 失败与一次 Codex 取消超时保留在 first-full-tests.log；修复 fixture 后全套通过，独立 Codex 重跑也通过。
