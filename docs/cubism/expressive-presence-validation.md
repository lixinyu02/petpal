# V9 神态动作验收

日期：2026-10-02。网页默认路径为 `public/avatars/akari-cubism-v9/akari.model3.json`，本轮只更新共享前端与网页，未重打客户端。

## 结果

- 官方 Core 6.0.1 一致性、真实 MOC5 实例和 64 姿态通过；11 drawables、19 参数、2550 顶点，MOC SHA-256 仍为 `29ebb1c652f658b2033996583409b920beecd94d2c2b3667b6c67e6820694246`。
- 14 个复用文件（原 MOC／纹理／物理／显示信息／图层元数据及九组 motion）与 V8 逐字节相同；新七组原生曲线 60 Hz 播放的参数范围、有限顶点、无翻面、结束中性均通过。Wink 实际短闭右眼且左眼不动，Doze 双眼短闭后恢复。
- 相关回归 **271/271** 通过，包括真 Core/Framework 的动作路由、淡出归属、口型独立、phase 去重、旧 V7/V8 与导入路径隔离，以及共享 avatar/anime/speech 生命周期。TypeScript、Vite 构建通过，仅有既有超过 500 kB 分块提示。
- Chrome 插件实际渲染 V8/V9 中性、Wink 和新动作定点对照。脸发比例保持，未观察到明显新增拼接或拉扯。连续 CubismScene 通过 listening→Listen、thinking→Think、playful speech→Wink、停止→Idle/gesture none/mouth 0；读取到每次独立 cue ID。该预览采用模拟文本和阶段输入，没有发送聊天、ASR 或 TTS 请求。
- 减少动态状态实际为 motionEnabled=false、motionGroup 空、gesture none。临时媒体与视口覆盖已恢复，私人预览和临时 Vite 服务已关闭。
- 正式 HTTPS 首页加载真实 Cubism，双击触发 Greet。CSS layout 与 visual viewport 实际为 **412×960**，scrollWidth=412、人物画布 379×570.8125，正式页面没有捕获到 warn/error。
- 生产静态部署核对 174 文件后原子替换 HTML，保留旧静态文件；后端 PID 34828 未重启，state/token 字节、下载包大小／mtime、稳定升级清单保持。公网初次三路核对遇到 15 秒连接超时，改为两路和 45 秒单请求上限后 **170 个资源 SHA-256 全部匹配**，没有绕过 HTTPS 证书验证。
- 完成设计和 issue 文档、来源清单及只读交叉审查。审查发现同一 phase 的草稿 ID 变更可能重启动作，已修复并纳入真实运行时测试。

## 范围

没有把模拟语音或历史 TTS/ASR 证据表述为本轮服务重测。本轮不包含 Windows/Ubuntu/Android 实机或安装包验收，也不包含官方 Cubism Editor 打开、保存、再导出。动作自然度仍需用户体验反馈。独立眼球／连续眼睑、独立手指与大幅手臂动作不属于现有骨架能力；详见 [动作说明](akari-expressive-presence.md)。

详细证据保存在忽略目录 `evidence/cubism-presence-20261002/`：`core.json`、`regression.log`、`build.log`、`wink-showcase.png`、`surprise-final.png`、`reassure-final.png`、`chrome-live-lifecycle.json`、`chrome-reduced.json`、`chrome-public-412x960.png/json`、`deployment.json`、`public-readback.json`。这些本机证据与私有业务文件不提交公开源码。
