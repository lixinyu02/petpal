# 原创 Cubism 网页验收

## 当前 V2：2026-10-02

- 修复源层中重复锁骨与横向领口拼接：一张连续颈肩／衣服／双手／裙底替代旧 neck 与 topwear，保留原脸与头发。20 层 PSD、22 drawables、20 个参数、3552 顶点，重新导出 MOC3 与图集；来源与重建见 [连续身体说明](akari-continuous-body.md)。
- continuous-body profile 收小头部 XY、身体与 Z 旋转关键形；保留 classic 重建路径。新增 TapHead／Greet，改善 Idle／Nod／Shake、发梢物理及官方动作／表情淡入淡出；中性参数每帧恢复，停止／隐藏／休息时关闭嘴型、清空原生队列。
- 官方 Core 6.0.1 一致性、损坏负例与 35 姿态检查通过；111 项相关回归、TypeScript 和隔离 Vite 构建通过。机械重新打包后的 PSD SHA-256 与已编译输入一致，PowerShell authoring 入口语法检查通过。未把 2026-10-01 的全套 1300 测试当作新模型的重跑结果。
- Chrome 插件在严格同源 CSP 的真实 WebGL2 预览中验收了 412×960、完整人物显示、直接双击招呼、模拟口型、开心／害羞／难过／兴奋、停止闭嘴、休息与隐藏、减少动态、StrictMode／compact 重建、两实例及卸载、context loss／无 WebGL2 回退；横向内容宽度为 412。新版静态与说话截图未出现旧领口横线。
- 网页静态资源已经先复制核对、再原子替换 index；44 个公网 HTML／两代模型／Framework／Core／shader／许可资源 SHA-256 读回全部匹配。后台 PID 34828 未变，账号状态与 token 字节、下载包大小／mtime、稳定更新清单均保持。旧模型和旧静态资源保留。
- Chrome 实际访问公网 HTTPS、登录 test 后显示新版人物。正式首页的 layout viewport 为 412×960，横向内容宽度 412、人物画布 379×515.8125；正常桌面尺寸与窄屏截图均已保存。正式首页与私人预览的尺寸分别测量。

此轮为网页体验更新，没有重打 0.9.6 客户端或修改升级清单。本轮预览口型使用模拟播放进度与能量输入，不能表述为新模型的真实 TTS／ASR 实测；旧版真实 TTS 证据见下方历史记录。官方 Editor 的 CMO3 打开／保存／再导出，以及 Android／Ubuntu／Windows 实机外观仍未验收。

本轮私有检查记录位于忽略的 `evidence/cubism-20261002/`：regression.log、core-corrected.json、chrome-lifecycle.json、chrome-v2-*.jpg、chrome-public*.json、chrome-public-v2*.jpg、public-readback.json 与 deployment.json。

## 历史 classic：2026-10-01

以下为旧模型的历史验收。该轮为共享前端与网页更新，0.9.6 客户端、版本、冻结 tag 和签名升级清单保持原状。

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
