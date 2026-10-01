# 二次元 AI 伙伴方案研究

核实日期：2026-09-26。范围为公开 README、LICENSE 与一个官方模型清单；未下载或集成第三方角色、Cubism Core、SDK 二进制，也未执行外部项目代码。以下原始文本 URL 本轮均返回 HTTP 200；快照保存在 `evidence/research/`。分支 URL 会变化，实际引入代码时应固定版本和提交。

## 方案比较

| 方案 | 本轮核实的能力 | 许可证 | 对小伴的用途 |
| --- | --- | --- | --- |
| Open-LLM-VTuber | Web / 桌面透明伙伴、Live2D 表情映射、模块化 LLM / ASR / TTS、角色配置 | 项目源码 MIT；自带 Live2D 模型明确排除在 MIT 之外 | 参考角色设定、表情事件、语音管线与透明窗口的分离，无需替换现有后端和真实 Codex CLI |
| pixi-live2d-display | PixiJS 6 适配层；模型加载、命中测试、视线跟随、动作调度；可选 Cubism 2 或 4 bundle | 包源码 MIT；Core 与样例模型另行许可 | 可作为真正 Live2D 的 renderer adapter；先核对目标模型与 Core / Pixi 版本兼容 |
| CubismWebSamples / CubismWebFramework | 官方模型加载、渲染及参数更新参考；README 指向 Cubism 5.3 兼容说明 | Components 使用 Live2D Open Software License；Core 使用 Live2D Proprietary Software License；样例有素材许可与逐角色条款 | 以官方资源清单和生命周期为依据，建立独立 CubismRenderer；不能按 MIT 处理整个 SDK |
| AIRi | Live2D 与 VRM / Three 渲染，Web 和桌面 stage，共享角色领域层、音频管线及服务 SDK；移动 stage 为 experimental | 仓库 LICENSE 为 MIT，仍需逐依赖和角色资产核实 | 借鉴共享角色状态、多渲染器及各端壳的组织方式，无需迁移整套服务 |

pixi-live2d-display README 虽有“支持所有版本”的表述，具体要求仍列 PixiJS 6.x 与 Cubism Core 2.1 / 4，并说明 Cubism 4 向后兼容 Cubism 3；不能据此推断最新 Cubism 5.3 功能已兼容，需用具体模型验证。

## 已验证来源

- Open-LLM-VTuber：[README](https://raw.githubusercontent.com/Open-LLM-VTuber/Open-LLM-VTuber/main/README.md)、[MIT LICENSE](https://raw.githubusercontent.com/Open-LLM-VTuber/Open-LLM-VTuber/main/LICENSE)、[Live2D 模型许可](https://raw.githubusercontent.com/Open-LLM-VTuber/Open-LLM-VTuber/main/LICENSE-Live2D.md)。LICENSE 明确样例模型例外，模型条款另有角色名称、设计修改和版权标注要求。
- pixi-live2d-display：[README](https://raw.githubusercontent.com/guansss/pixi-live2d-display/master/README.md)、[MIT LICENSE](https://raw.githubusercontent.com/guansss/pixi-live2d-display/master/LICENSE)。README 要求先提供 Core，且不建议生产环境直接依赖文中列出的在线 Core 链接。
- CubismWebSamples：[README](https://raw.githubusercontent.com/Live2D/CubismWebSamples/develop/README.md)、[LICENSE](https://raw.githubusercontent.com/Live2D/CubismWebSamples/develop/LICENSE.md)。Core 不在仓库中，需从官方 SDK 包取得。LICENSE 分列发行、开放软件、专有 Core、免费素材与样例角色条款。
- CubismWebFramework：[README](https://raw.githubusercontent.com/Live2D/CubismWebFramework/develop/README.md)、[LICENSE](https://raw.githubusercontent.com/Live2D/CubismWebFramework/develop/LICENSE.md)。Framework 必须与 Core 配合，仓库不含 Core。
- AIRi：[README](https://raw.githubusercontent.com/moeru-ai/airi/main/README.md)、[MIT LICENSE](https://raw.githubusercontent.com/moeru-ai/airi/main/LICENSE)。README 架构图列 `stage-web`、`stage-tamagotchi`、实验性的 `stage-pocket`，共享 `stage-ui`、`core-agent/core-character`、`pipelines-audio`、`stage-ui-live2d` 和 `stage-ui-three`。
- 官方清单：[Hiyori.model3.json](https://raw.githubusercontent.com/Live2D/CubismWebSamples/develop/Samples/Resources/Hiyori/Hiyori.model3.json)。本轮只读取 JSON 结构，没有下载模型或贴图。

## 真正导入 `.moc3` 的边界

`.moc3` 是模型数据，不能当作图片独立显示。通常以 `.model3.json` 为入口，解析 `FileReferences` 的 Moc、Textures、Physics、Pose、Expressions、Motions 等。核实的 Hiyori 清单实际引用 `.moc3`、两张 PNG、physics / pose / userdata / display-info JSON，以及 Idle / TapBody 动作；`Groups` 声明 EyeBlink 和 LipSync 参数，`HitAreas` 声明 Body。未提供的可选字段应允许缺省。

SDK、Core 与角色资产是三层许可：

1. 适配器的 MIT 许可只授予该适配器代码的使用权。
2. 官方 Framework / Samples 使用 Live2D Open Software License；Core 单独使用 Proprietary Software License，并从 SDK 官方渠道取得。官方 LICENSE 还定义需要 Cubism SDK Release License 的 business 范围，英文阈值为最近财年营收超过 1,000 万日元；发行时按正式条款核对。
3. 模型插画、名称、动作和贴图遵从作者授权。官方样例使用 Free Material License 加逐角色条款，例如本轮读到的 Hiyori 条款限制设计修改。购买或自制模型也应附作者允许的使用范围。开源 VTuber 仓库的 MIT 许可不会覆盖这些角色资产。

未来导入器只接收模型数据和已固定的 SDK 运行库。ZIP 导入应限制解压总大小、文件数量和纹理尺寸，拒绝绝对路径、`..`、符号链接和目录逃逸；模型引用必须落在导入目录。拒绝远程 URL、包内 JS / HTML 插件，防止模型导入改变运行代码。校验引用完整、Core 兼容、资源释放及 WebGL context 恢复后再启用。这里是后续导入设计，尚未实现导入功能。

Android 独立悬浮 WebView 只读 APK 内资源、没有 native JS 桥、禁止网络回退。Cubism 接入时，Core 和模型需走许可核实后的本地打包或明确新增的受限资产存储，不能直接照抄 README 的 CDN script。现有 CSP 禁止 eval；具体 SDK 如需 WASM 编译能力，须实测后仅增加必要指令。本次没有为第三方 SDK 放宽限制。

## 小伴采用的组织方式

聊天 / Codex 会话和 LLM provider 不依赖外观。共享状态为 `companionKind: 'anime' | 'cat'`，默认 anime；猫保留 Three.js 模型，二次元角色使用独立分层 2D 渲染器。角色消费 idle、thinking、speaking、happy、sleep 等高层状态，由 renderer 负责眨眼、视线、呼吸、动作淡入淡出和资源释放。

“Live2D 风格”人物与“支持官方 Live2D `.moc3` 模型”是不同交付项：自绘分层 2D 动画可以先实现前者；真实接入 Core、模型加载与许可核实后，才能标注后者已支持。

- Web / Electron 主场景把 `{ kind, dirty }` 原子写入 `localStorage['petpal.companionPreference']`，并镜像旧 `petpal.companionKind` 供兼容诊断。无存储权限时仍保留内存选择；离线选择跨重载保留 dirty，恢复连接后的 hydrate 会串行补发 PATCH，旧响应不能确认较新的选择。同源 Electron 桌宠监听 storage 事件，并在挂载时读取选项。
- 后端 `settings.companionKind` 持久保存选项；角色切换不新建会话或更改 Codex 工作区。
- Android 主 App 调用 `PetOverlay.showPet({ companionKind })`，旧 `start({ companionKind })` 保持兼容。原生端二次校验 enum，生成固定本地 `?overlay=1&avatar=anime` 或 `cat`；运行中的窗口可原地重载角色。独立悬浮 WebView 不读取主 App localStorage，也没有 JS/native 桥。
- 选择 anime 时不应继续运行隐藏的 Three.js 猫；选择 cat 时销毁 2D 动画实例。熄屏、页面隐藏、窗口关闭时暂停或释放各自资源。

本轮只借鉴公开项目的结构经验，没有复制其实现代码或角色资产。若以后复制 MIT 代码，需要保留对应版权与许可证。

## 2026-10-01 动作迭代复核

本轮重新读取官方 Cubism Framework / Samples、pixi-live2d-display、Kalidokit、MediaPipe Face Landmarker 和 three-vrm 的公开文档，未安装或运行其代码。官方 Framework / Samples 当前声明兼容 Cubism 5.3；实际模型仍需 `.model3.json`、`.moc3`、纹理及对应物理/动作资源。现有八张整幅表情 WebP 没有独立发丝、眼球或身体绑定，接入 SDK 本身不会补齐这些模型数据。

pixi-live2d-display 的 npm stable 0.4.0 与 Pixi 6 配套，0.5.0-beta 面向 Pixi 7；README、master 与 npm 发布版本不能混用，接入时需锁定完整组合。Kalidokit 官方已标记 deprecated；MediaPipe 提供面部 landmarks / blendshapes，需要另行映射到角色参数，也不能替代模型绑定。three-vrm 则要求 VRM 3D 资产，不适用于现有立绘。Cubism Core、Framework 与角色素材继续分别核对许可；允许用户导入任意模型的产品还需核对 Expandable Application 的专门条款，不能套用一般小企业发行豁免。

因此 issue-72 沿用原创人物与现有渲染器：增加眼、头、身体的不同响应速度，积分呼吸相位，按真实头姿驱动发梢，修复 PCM 换字闭嘴与点头相位跳变。WebGL 与 DOM 共用动作状态；DOM 是较小的刚性人物移动，不具备局部虹膜或发丝位移。本轮没有新增 Cubism 模型导入、面捕、SDK 或摄像头权限。

复核来源：[CubismWebFramework](https://github.com/Live2D/CubismWebFramework)、[CubismWebSamples](https://github.com/Live2D/CubismWebSamples)、[官方模型参数更新](https://github.com/Live2D/CubismWebSamples/blob/develop/Samples/TypeScript/Demo/src/lappmodel.ts)、[pixi-live2d-display](https://github.com/guansss/pixi-live2d-display)、[Kalidokit](https://github.com/yeemachine/kalidokit)、[MediaPipe Face Landmarker Web](https://ai.google.dev/edge/mediapipe/solutions/vision/face_landmarker/web_js)、[three-vrm](https://github.com/pixiv/three-vrm)。本轮访问均为 HTTP 200，版本信息应在正式接入时再次核实。
