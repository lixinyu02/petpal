# 页面美观与动效优化

- Date: 2026-10-04
- Complexity: L1
- Status: final

## Background

上轮已有轻量动效控制器与消息入场。Chrome 当前 1920×1080 基线显示人物主页操作分散在左右角，聊天/设置存在偏重的边框、辅助文字与内容层次不一致。Chat + Agent 弹层已有安全的 opacity CSS，却尚未接入有限入口 hook。

## Goal

- Visual thesis: 保留暖白、墨绿与浅橘人物，以舒展留白和清晰文字形成安静、亲近的陪伴空间。
- Content plan: 人物是主页中心；底部集中语音/文字入口；聊天以模式、模型、消息、输入为主次；设置用直接的功能标题和轻分隔。
- Interaction thesis: 人物准备好时装饰光晕一次展开；回应文字短淡入；语音面板及 Agent 设置只在打开时淡入；现有按钮反馈继续统一。

## Solution

单个集成 issue 同时对齐组成、主题与动效。新增小型 ui-polish.css，沿用现有 UI tokens 与生命周期，不引入新框架。主页只在 intro、reply、voice-panel、aura 上连接入口 hook，人物 canvas 与世界根不移动；所有带 fixed 后代的容器仅 opacity。减少动效/后台/off 默认静止，有限动画收尾释放标记，内容或设备列表刷新不重播。

设置标题精简，底部操作集中但保持普通文档流。保持 adaptive-screen 的人物网格行、短屏与 safe-area。保持语音/模型/权限、账号与消息的业务行为。

## Impact and Risks

仅前端样式、显示文字、入口 hook 与必要验证；不修改协议、数据库、模型资产或正式安装包。主题 !important、懒加载 CSS、fixed 弹层与小屏网格是主要风险，需要实测 computed styles 和边界。颜色不能只在日间成立；动态不能让人物 hit target 或弹层偏移。

## Verification Plan

Chrome 插件先截图基线，再验收最终构建：1920×1080、实际 412×960、320 宽与短屏；日/夜主题；人物/底部 CTA；模型菜单、Agent 弹层、图片预览；真实 animationstart/end 及标记清除、系统减少动效、列表刷新不重播。针对性组件/生命周期回归、TypeScript 与隔离 Vite 生产构建；新 hook 若影响旧 VM fixture，保留原断言补齐真实桥接。网页静态部署备份与哈希比对，保留模型/最新正式下载与签名清单；同步现有 GitHub main。

## Result and Evidence

主页语音/文字入口居中成组，工作台模式、模型/电脑入口、消息与输入区统一层级、间距和圆角；设置标题改为“连接与偏好”。夜间伙伴栏按钮使用协调的中性色。人物准备好后才启动 intro/aura/reply 的有限入场，语音面板和 Chat + Agent 弹层每次打开只播放一次。角色 ready 绑定当前种类，防止异步 hydration/切换时沿用旧角色状态。主页旧人物外层入场关闭，睡眠取消光晕入场且唤醒不重播，动画末态与常态透明度一致。

- 完整串行回归 **1825/1825**（新增实际 CompanionWorld 9 项、ChatAssistant 6 项），TypeScript 与隔离 Vite 生产构建通过。
- Chrome 插件验收桌面 1920×1080、实际 412×960、320×640 与 400×480 短屏，无横向溢出，短屏输入区可见；日夜主题与手机人物正常显示。
- 本地同源隔离服务记录真实 animationstart/end：人物装饰与回复、Agent 弹层收尾清标记；模型菜单和消息图片 fixed 预览定位正确；本地 Responses SSE 消息只入场一次并正常解析 Markdown。系统减少动效时全部新入场静止，恢复不补播，人物 canvas 外层 transform 为 none。
- 语音面板字幕/phase/任务刷新不重播、隐藏恢复、睡眠取消、异步切角及卸载清理由真实 TSX + 动效桥接回归覆盖；本轮没有采集真实麦克风、调用生产 ASR/TTS 或执行真实 Agent 任务。
- 静态网页已部署并通过公网 index 哈希核验：`8a9d1474ba1e95575fb8a507b43ddd5f851801a87b8a723d2657a100ba180e69`。只替换静态页面并新增 hash assets，保留旧 assets 与回退备份，未重启后端。
- V12 模型、0.9.7 正式安装包清单、SHA256SUMS 和更新签名元数据逐字节保持；`downloads/**` 和隔离 `qa-*` 未部署。本轮未重打安装包。

真实截图、动画事件、回归日志和静态部署回执保存在忽略目录 `evidence/ui-polish-20261004/`，不包含到公开源码提交中。
