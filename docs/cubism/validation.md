# 原创 Cubism 网页验收

日期：2026-10-01。此轮为共享前端与网页更新，0.9.6 客户端、版本、冻结 tag 和签名升级清单保持原状。

## 已完成

- 原创橘白少女分层 PSD、21 个 RGBA 层、真实 MOC3 与 CMO3 编辑候选。模型包含 23 drawables、22 deformers、20 个真实参数、3838 顶点、5049 三角形；一张 2048×2048 纹理。
- 官方原版 Core 06.00.0001 的 MOC 一致性、真实实例、损坏文件负例及 35 组姿态验证通过。脸红／泪光绑定 0/1 透明度关键形，0/.5/1 插值采样生效。
- 新增独立 authoring 入口实际离线编译、导出并重验；runtime 文件与首次产物一致。CMO3 含工具生成的时间和 GUID，不承诺整文件字节可重复。详见 [来源与重建](akari-authoring.md)。
- 完整自动测试以并发 2 运行：1300/1300 通过。首次默认并发为 1298 pass、1 fail、1 cancelled，两个既有后台测试发生超时；隔离复跑 50/50 与降低并发全套均通过，未修改 timeout 或业务逻辑。
- TypeScript、生产 Vite 构建、源码包 allowlist 检查通过；两份 Cubism 回归包含实际产品 Core、Framework、MOC 和原生 Idle 首次更新。
- Chrome 插件验收真实 WebGL 渲染、情绪对照、StrictMode／compact 重建、两实例共存与卸载、休息／唤醒、隐藏时闭嘴、减少动态、上下文丢失回退。测试页模拟无 Core／无 WebGL2 后均保留原角色场景。
- 与安卓悬浮窗相同的严格同源 CSP 下运行成功，没有添加 unsafe-eval 或放宽脚本策略。
- 公网 HTTPS 登录 test，播放已有消息：`/api/voice/synthesize/stream` 返回 200 NDJSON，播放期间 Cubism 为 speaking / playback-progress，实测嘴型开度 0.441；自然结束、准备期取消及播放期手动停止后开度均为 0。
- 公网首页的 CSS layout/visual viewport 为 412×960，横向内容宽度为 412，人物场景 379×622.8125。不同于浏览器窗口外框尺寸。
- 32 个公网 HTML／模型／Framework／Core／shader／许可资源与本次静态候选 SHA-256 全部相同。
- 静态资源先复制验证，index 原子替换；保留旧静态资源和回退 index。后端 PID 保持，账号数据、配对 token、下载包和升级清单未因部署改动。

## 验收边界

CMO3 是工具生成的编辑候选，尚未在官方 Cubism Editor 打开、保存和再导出验证。当前 rig 支持基础头部、身体、眼口、呼吸、头发、脸红与泪光；缺少独立 keyform 的可选细节会被跳过，没有冒充真实绑定。它不是经过人工逐项精修的商用 VTuber 模型。

Chrome 中的休息／唤醒命令和键盘入口已验收；共享触控策略有自动回归，本轮没有安卓实机触摸或 Windows／Ubuntu 安装包运行验收。网页通过不能替代设备验收。真实语音测试使用已有消息，不派发新的 Agent 任务，也没有复跑 ASR。

本机详细日志与截图位于忽略的 `evidence/cubism-20261001/`，包括 full-tests-retry.log、official-core-emotions-validation.json、chrome-lifecycle.json、chrome-csp.json、chrome-live-voice.json、public-readback.json 和 deployment.json。编辑源与可复现作者工具入仓；私有配置、依赖缓存和测试服务不入仓。
