# 二次元伙伴自然动作验收

- Date: 2026-10-01
- Issue: issue-72
- Result: passed for source and live Web; existing client packages remain 0.9.6
- Live page: https://magicdatou.top:44318/

## 改动与审查

新增解析阻尼跟随：眼睛先响应，头部随后，身体以更小幅度跟随。呼吸相位与语音点头相位采用积分，避免音量变化引发跳动；发梢依据实际头姿响应。持续有声 PCM 的估计换字只更新嘴形，不再强制闭嘴；静音、停止、结束、隐藏、倒退与换回复继续清除口型。

WebGL 与 DOM 共用 presence 输出，并统一世界/CSS 坐标方向。DOM 保留较小的刚性人物姿态，不具备 WebGL 的局部虹膜及发丝变形。睡眠、低动态和隐藏清空额外动作，恢复不补跑暂停时间。没有新增依赖、贴图、摄像头权限或表情按钮。源码自审及独立只读审查均无阻塞问题；本轮固定使用原来的同一人物。

## 自动验证

- 相关 avatar / anime / speech / voice / scene-loop / companion 回归 **300/300** 通过，含新增 7 个 presence 和 5 个语音连续性测试。
- TypeScript 检查与隔离 Vite 生产构建通过。共用 Three chunk 的既有 500 kB 提示保留，无新增 shader 构建错误。
- presence 测试包含 30/60/120 Hz 一致性、逆向跟随、有界输出、一小时运行、无效输入和取消后恢复；语音测试覆盖换字、静音、缓冲、结束、倒退、换回复及长时间点头相位。
- 日志：`evidence/avatar-presence-20261001/regression-final.log`、`build.log`。首次误把需要显式 WAV 参数的 fixture server 作为测试执行的失败日志保留在 `regression.log`，修正为仅选择 `*.test.mjs` 后上述 300 项全部通过。

## Chrome 实测

使用 Chrome 插件操作真实页面。CSS viewport 实际为 **412×960**，`innerWidth / clientWidth / scrollWidth` 均为 412；不是仅按截图尺寸判断。

| 检查 | 结果 |
| --- | --- |
| 本地完整人物、眼/头/身体分层响应 | 可见，新 dataset 为 `spring2d`；采样显示不同跟随速度 |
| 倾听/思考 | 进入对应 phase；倾听截图保存 |
| PCM 模拟 | 有声嘴巴持续张开，切换静音及停止后为 0；明确是模拟测试 |
| 睡眠/唤醒 | 睡眠闭眼，跟随/呼吸/发丝/嘴型为 0，唤醒恢复 |
| 低动态 | 跟随、呼吸、发丝及额外动作即时归零 |
| 隐藏/恢复 | 隐藏期间两次 `renderFrames` 均为 49，恢复继续绘制 |
| WebGL context 失效 | 主动测试切换 DOM，完整人物、触摸和 PCM 嘴型仍可用；重新加载恢复 WebGL |
| 公网主页及 Chat 窄屏 | 都加载新版人物，无横向溢出；触摸头部触发 pet / happy / tilt |
| 实际 CosyVoice | 已有验收消息的 `/api/voice/synthesize/stream` 返回 200、24 kHz 单声道 PCM，完整一轮收到 41 个音频块；连续 25 次取样中 14 次有声，口型最大 0.328 |
| 实际停止朗读 | 在口型 0.090 的有声播放中点击停止，随后 `speaking=false`、口型 0.000 |

没有新发 Chat 或 Agent 任务、改模型、改语音设置。只选择已有测试会话并朗读已有回复。浏览器缩放下 Mouse/locator 坐标有偏差，因此测试按钮使用键盘语义输入，人物互动使用 CDP 真正 touch 输入；未通过修改页面状态伪造动作。

初次本地图片加载超时后通过界面重新加载，八张角色图返回 200 并正常绘制。fixture 热更新曾产生重复 createRoot 的诊断，重载后继续测试；不是生产入口新增错误。系统朗读尝试收到本地中文音色和分段结束事件，却未观测到 active/start，未计为实际系统语音验收通过；实际语音结论来自上述 CosyVoice 播放。

证据在 `evidence/avatar-presence-20261001/`：`browser-checks.json`、`online-browser-checks.json`、`online-desktop.png`、`online-chat-412.png`、`online-touch-412.png`、`dom-fallback-412.png`。`online-touch.gif` 是线上真实触摸动作的 32 帧 / 4 秒录制；早期 `preview-412*.png` 受到缩放影响，不作为 412 CSS viewport 验收证据。

测试后已停止朗读、退出 test 账号、关闭两张测试标签页，清除尺寸/触摸/低动态 emulation，并精确停止本轮 5178 Vite 预览。4318 后端保持运行。

## 网页上线与边界

只推广隔离构建的静态资源：校验 30 个文件，新复制 8 个 hashed 文件，21 个已有资源哈希一致。保留旧资源，用原子替换发布 index，旧 HTML 保存在私有 `.data/https/` 回退目录。后台 PID 260292 未变，无重启。

推广前后 state/token 原始字节一致，下载文件 size/mtime 和 stable 签名更新清单保持。可信公网 HTTPS 回读 index 与本机构建一致，15 个 JS/CSS 文件逐一 SHA-256 相同，健康接口仍为 0.9.6。回执 `deployment.json`、`public-verification.json`。

本轮只交付新版网页与源码，不修改 v0.9.6 tag、安装包或升级签名清单；Windows、Ubuntu、Android 实机没有据此新增动画版本验收。VTuber / Cubism / VRM 的接入资源与许可复核追加在 `docs/avatar-research.md`，本轮没有引入官方 Cubism 模型或模型导入器。
