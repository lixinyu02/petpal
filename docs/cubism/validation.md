# 原创 Cubism 网页验收

## 当前 V11 continuous-features：2026-10-03（网页已上线）

独立眉毛、眼睑、虹膜与原生裁剪；连续表情、头部/合手区域交互和持续语音倾听。修复动作退场跳变及眼周白边。340 项回归、官方 Core、Chrome 公网冷启动/交互和 412×960 检查通过。详见 [V11 验收](continuous-features-validation.md) 与 [模型能力说明](akari-continuous-features.md)。

## 历史 V10 facial-expressions：2026-10-02

新增害羞、惊讶、安心三套实际局部表情和真实参数，共六套表情；保留原人物几何与十六组动作。289 项回归、官方 Core、Chrome 组合表情／对话状态及 412×960 检查通过。另修正公网 Core 首加载预算过短的问题。详见 [V10 验收](facial-expressions-validation.md)、[作者与能力说明](akari-facial-expressions.md) 和 [来源](akari-facial-expressions-provenance.json)。

## 历史 V9 expressive-presence：2026-10-02（当时网页已上线）

默认角色为真实 Cubism V9 动作包，完整复用 V8 骨架和原画；增加七组语境动作、三种低频待机神态及既有表情贴片的细分映射。271 项相关回归、官方 Core、Chrome 连续状态、412×960 与 170 个公网资源哈希核对通过。详见 [V9 验收](expressive-presence-validation.md) 和 [动作说明](akari-expressive-presence.md)。

## 历史 V8 reference-gestures：2026-10-02（当时网页已上线）

默认角色为真实 Cubism V8，沿用 V7 的脸部、刘海与原图，补入合手轻抬、左右轻摆、衣袖跟随，以及 Shy／Sway／Bow 原生动作。相关回归 248/248、Core／Chrome／412×960 与正式 HTTPS 资源读回通过。完整结果、语音测试范围和手部能力限制见 [V8 验收](hand-gestures-validation.md)。

## 历史 V7 reference-layered：2026-10-02（当时网页已上线）

默认角色现为真实 Cubism V7，保留原完整人物比例并重新绑定头身、发根、局部眼口与情绪。源图、Core、Chrome、实际语音和正式 HTTPS 的分项结果与限制见 [V7 验收](reference-layered-validation.md)。下方是历史记录，其中“当前”指当时版本，不能作为当前模型通过或用户已接受外观的证明。

## 历史 V4 统一前发：2026-10-02

当前源码默认角色为 `public/avatars/akari-cubism-v4/akari.model3.json`。V4 保留温柔日系、奶油白与浅橘少女的原脸、后发、身体及衣服，把两块不协调的旧前发替换为一张统一透明前发；眼白／睫毛／闭眼／虹膜整体缩小至 0.85，虹膜再缩小至 0.92，眉毛不动。来源与重建见 [V4 作者说明](akari-unified-hair.md) 和 [V4 来源摘要](akari-unified-hair-provenance.json)。

- **已完成源打包**：1024×1536 画布、19 层 PSD；`pack-receipt.json` 的真实 PSD 读回检查通过名称顺序、矩形、尺寸与全部 RGBA 像素。该检查属于 PSD 数据核对，不是 Core 或外观验收。
- **静态覆盖通过**：直接解码 PSD 原生 alpha，在三条额头采样列观测连续露肤 2／17／60 像素，两侧眼白被前发遮挡均少于 0.002%。同一检查拒绝真实 V2 的两条大额头负例；这些采样不能替代完整美术判断。
- **已完成独立导出**：输入 PSD SHA-256 为 `4ef62d6405976149cbd614dd4ccb240f226e06f4c4798eaf57239052948cb01a`，原始 MOC 为 `a2dd75ed234fb45cd97c6f1e26cc156c13bb8b671a9f70b7e7a21e882349ed26`，图集为 `bdf66abcce40b3178e1383cf3dac4805675f3ec95d5c9a264fae018a896dbc6f`。冻结工具与真实 authoring receipt 记录在来源摘要；原始导出统计为 19 drawables、22 deformers、20 参数。
- **Core／几何通过**：官方 Core 6.0.1 实际读取 19 drawables、20 参数、3603 顶点、4898 三角形；MOC 一致性返回 1，损坏 magic 负例拒绝，35 姿态及真实情绪绑定检查通过。V4 组合形变检查中发根相对脸滑动为 0 像素，前发梢最大位移 5.11916 像素、后发 7.05252 像素。
- **相关回归与构建通过**：avatar／anime／Cubism／speech 相关回归为 210 pass、0 fail／cancelled；TypeScript 与隔离 Vite `v4-dist` 构建完成。这是本轮相关检查，没有把历史全套测试当作 V4 重跑。
- **Chrome 动态通过**：真实双实例 V3／V4 对照覆盖中性、半眨眼、微笑、O 口型、左上组合、点头加视线；慢速巡检保存 16 帧并生成 `chrome-v4-motion-compare.gif`。该对照检查属于实际渲染，未把中性 PSD 合成图作为截图。
- **公网部署与窄屏通过**：97 个静态文件核对后原子替换 HTML，83 个公网 HTML／模型／Framework／Core／shader／许可资源 hash 读回匹配。后端 PID 34828 未重启，账号 state、token、稳定更新清单字节及下载包大小／mtime 保持；旧资源保留。Chrome 公网首页使用 Cubism，412×960 下 width 与 scrollWidth 均为 412，人物画布 379×570.8125，无横向溢出。
- **正式网页互动通过**：Chrome 手机 viewport 模拟下以鼠标长按进入休息，双眼闭合、motion=false、嘴型=0；Enter 唤醒；直接点击触发 TapHead，实际 petAction=pet、expression=happy。减少动画偏好使 motion=false、呼吸和嘴型为 0，恢复后继续正常活动；临时偏好及 viewport 已还原。此处是鼠标／键盘与屏幕尺寸模拟，触控事件由共享回归覆盖，没有作为安卓实机证据。
- **V4 真实 TTS 通过**：朗读已有长欢迎语，没有新发 Chat／Agent 请求；`/api/voice/synthesize/stream` 返回 HTTP 200、`application/x-ndjson`，人物实际为 speaking／playback-progress，观测嘴型开度 0.190、shape=A；手动停止后 idle／开度 0。ASR 与四端实体设备尚未在本轮重验，历史 V3 语音结果没有转写为 V4 结果。
- **官方 Editor 未验收**：V4 CMO3 为生成的编辑候选，尚未在官方 Cubism Editor 打开、保存和再导出；Android／Windows／Ubuntu 安装包与实体设备也未在本轮验收。

V3 已改善动态绑定，但用户仍否定其静态大额头／刘海覆盖不足和眼睛过大的比例。V4 的源图修正针对这项反馈；是否符合期待须以 V4 实际画面与用户判断确认。

V4 私有证据仍在忽略的 `evidence/cubism-deformation-20261002/`，包括 authoring-v4-receipt.json、core-v4.json、tests-v4.log、build-v4.log、chrome-v4-poses.json、chrome-v4-sweep.json、chrome-v4-motion-compare.gif、chrome-public-v4-home.jpg、chrome-public-v4-412x960.jpg、chrome-public-v4-mobile.json、chrome-public-v4-interaction.json、tts-mouth-v4.json、tts-active-v4.json、public-readback-v4.json 与 deployment-v4.json。此轮为网页体验更新，未重打客户端。

## 历史 V3 stable-portrait：2026-10-02

该轮模型为 `public/avatars/akari-cubism-v3/akari.model3.json`。V3 保留原 Akari 美术和 V2 连续颈肩 PSD，修复动作中身体与脸部的重复非等比形变、发际漂移、眼球伸缩和嘴部叠画；独立 authoring、动作参数所有权与验收方法见 [V3 稳定人物说明](akari-stable-portrait.md)。下列结果仅属于 V3；用户后续指出其静态比例仍不协调，不能视为人物美术已被接受。

- 最终 `stable-portrait` MOC SHA-256 为 `a2d249efa9d9cccd357555aae59afcca3f5d951d619bc52bde8001eb2a46ced4`，图集为 `a1a6d18d18ee055c41eb679047cb0b8db282b347852ce5c4fb0226099feead2e`。20 drawables、20 个参数、3301 顶点；输入复用 V2 PSD，最终 CMO3 编辑候选独立保存。来源清单见 [V3 provenance](akari-stable-portrait-provenance.json)。
- 官方 Core 6.0.1 一致性、损坏负例及 35 姿态通过。真实 MOC 的 121 组合姿态中，脸／眼／眉／鼻／身体的边长和五官中心间距误差均小于 0.1%；虹膜 Form 不再拉伸。头发正反端点与组合头身姿态中，额头以上发根相对脸滑动为 0 像素，实际低处前发顶点最大位移 5.05 像素、后发 7.04 像素。相同验收函数拒绝真实 V2 的滑发与虹膜拉长负例。
- 本次最终模型的 90 项相关回归、TypeScript 与隔离 Vite 构建通过。保留正常眨眼、眉毛与口部关键形，开闭嘴图层交叉淡入，没有工具附加唇线；内置 V3 最大开度为 0.6，外部模型仍使用其完整范围。
- Chrome 插件检查中性、左上组合、微笑／A／O 口型，以及完整连续转头、侧倾、呼吸、眨眼和模拟说话巡检，保存 16 帧真实对照。V3 发际与五官保持附着，发梢保留轻微摆动。实际公网首页登录后使用 Cubism，直接点击进入 TapHead，长按进入休息并闭眼／闭嘴，点击唤醒和减少动画开关／恢复均正常。两实例共存通过对照页验收；隐藏／队列清理与异常回退由本轮回归覆盖，未把历史浏览器故障注入结果算作 V3 重跑。
- 实际公网首页 412×960 时横向内容宽度为 412，没有水平溢出；人物画布为 379×570.8125，额头、头发与身体完整显示。临时 viewport 和减少动画覆盖均已恢复。
- 在公网聊天页朗读已有欢迎语，`/api/voice/synthesize/stream` 返回 200 NDJSON；V3 为 speaking／playback-progress，实测意图口型开度 0.127，手动停止后为 idle／0.000。未新增聊天／Agent 请求；ASR 和四端实体设备没有在本轮重验。
- 网页静态先复制核对，再原子替换 index；56 个公网 HTML／三代模型／Framework／Core／shader／许可资源的 SHA-256 读回匹配。部署时账号状态、token、下载大小／mtime与稳定升级清单均保持，后端 PID 34828 未重启，旧资源及回退 index 保留。本轮没有重打客户端。

V3 的 CMO3 仍为编辑候选，官方 Cubism Editor 打开、保存与再导出尚未验收。下方 classic／V2 记录仅代表当时的候选，不能转写为 V3 验收；以上测试不能代替用户对人物美术与动作自然度的判断。

本轮私有检查保存在忽略的 `evidence/cubism-deformation-20261002/`：authoring-final-receipt.json、core-anchored.json、regression-anchored.log、build.log、chrome-motion-compare.gif、chrome-public-412x960.jpg、tts-playback.json、tts-mouth.json、public-readback.json 与 deployment.json。

## 历史 V2：2026-10-02

以下为连续身体 V2 的历史验收。该轮静态领口拼接与基本执行检查通过后，用户仍报告动作中五官、身体和发际不协调，后续修复因此进入 V3；历史通过范围不能扩展为动态比例已全面合格。

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
