# Akari 动作 overlay 与复现

当前源码默认目标为 `public/avatars/akari-cubism-v4/` 的 V4 `stable-portrait`。它保留 [V3 稳定人物](akari-stable-portrait.md) 的动态修复，另以统一前发和缩小眼组修正静态比例；V4 源图、19 层 PSD 与重建见 [统一前发说明](akari-unified-hair.md)。V2 的连续身体来源见 [akari-continuous-body.md](akari-continuous-body.md)，classic／V2／V3 的来源与实际验收保留为历史，不能证明 V4 已通过。

动作 overlay 本身只写动作、physics3 和 model3 JSON，不生成美术或 MOC3。它按完整 SHA-256 配对审核支持 `classic`、`continuous-body` 与 `stable-portrait`；新导出的最终 MOC／图集须先完成配对审核，不能沿用早期候选的 hash。官方 Core／Framework 检查与画面、语音和设备验收分开记录；参数和网格通过不代表外观已经合格，也不代表网页已部署。

## 来源与复现顺序

原 PSD、PSD2Live 冻结源码、Kotlin authoring 与官方 Core 的来源仍见 [akari-authoring.md](akari-authoring.md)。原基线提交为 `f2e775177faa9cea5c9168b31f2f1591d5cf0d45`。这次新增的 [polish-akari-motions.mjs](../../scripts/authoring/polish-akari-motions.mjs) 是 PetPal 自编的 Node overlay，没有嵌入编译器代码。runner 先导出该 profile 的原始动作，再应用 overlay 才能复现本轮动效。

在仓库根目录按以下顺序执行：

1. 按 [V4 重建说明](akari-unified-hair.md) 先运行 `pack-akari-unified-hair.mjs`，再用 `stable-portrait` profile 导出到新的空目录，例如 `.tools/cubism-authoring/model-motion-base`。复现历史 V3 必须显式 `-InputPsd "$PWD/outputs/avatars/akari-cubism-v2/akari.psd"`；历史 V2 用 `continuous-body`，classic 用 `classic`。不要将旧公开包作为可覆盖的构建目录。

2. 为现有导出目录应用动作 overlay：

   ```powershell
   node scripts/authoring/polish-akari-motions.mjs .tools/cubism-authoring/model-motion-base
   ```

   入口只接受仓库内已经存在的模型目录，验证完整 MOC3／图集 SHA-256 配对、20 个 CDI 参数以及 profile 对应的物理设置。不同 profile 的 MOC 与图集不能混用。它保护旧 `public/avatars/akari-cubism/`，只替换五个 motion3、physics3、model3 JSON；缺失目录或不匹配的模型在写入前报错。每个文件先写临时成员再原子替换，重新执行会得到相同字节。重建始终显式传入新的导出目录，避免覆盖 V2 历史资源。

3. 验证完整候选模型及其情绪绑定：

   ```powershell
   node scripts/authoring/verify-cubism-model.mjs `
     .tools/cubism-authoring/model-motion-base/akari.model3.json `
     .tools/cubism-authoring/model-motion-base/core-validation.json `
     --require-emotions
   ```

4. 核对独立导出候选的 MOC／图集及七个 overlay 文件与对应版本候选，确认回归实际读取该版本，再运行资产和动态比例回归：

   ```powershell
   node --test tests/cubism-motion-assets.test.mjs tests/cubism-deformation-geometry.test.mjs tests/cubism-deformation-runtime.test.mjs
   ```

5. 完成浏览器／设备的动效、指针交互和语音口型验收后再发布审核过的资源。官方 Core／Framework 的通过结果属于资产执行验证，不能代替浏览器或 WebView 的画面验收。

早期 `classic` 动作候选从基线提交独立导出并连续应用两次 overlay，七个文件逐字节一致；V2 后续重新导出连续身体 MOC／图集并应用动作数据。它们的来源与交付哈希见 [V2 来源摘要](akari-motion-polish-provenance.json)，V3 的真实来源见 [稳定人物来源摘要](akari-stable-portrait-provenance.json)。这些结果是历史依据，不能证明 V4 或其 overlay 已通过验收；本轮状态见 [验收记录](validation.md)。缺失目标、旧 classic 公开包、未配对 MOC／图集会在写入前被拒绝。

## 真实 rig 能力

V3／V4 的 stable-portrait 作者合同保留 classic／V2 的以下 20 个真实参数 ID 和范围，动作不使用 Framework 为未知 ID 生成的虚拟索引。范围表示控制参数，不等于最终渲染旋转角度；stable-portrait 的头部 Z 关键形作者极值为 ±3°，每代 MOC 的读取与动态检查独立记录。

| 真实参数 | 范围 | 能力 |
| --- | --- | --- |
| `ParamAngleX` | -45…45 | 头部左右转向 |
| `ParamAngleY`、`ParamAngleZ` | -30…30 | 抬低头、侧倾 |
| `ParamBodyAngleX/Y/Z` | -10…10 | 身体轻微重心变化 |
| `ParamEyeLOpen`、`ParamEyeROpen` | 0…1 | 独立眼睑开合 |
| `ParamEyeBallX/Y`、`ParamEyeBallForm` | -1…1 | 视线；stable-portrait 保留 Form 参数但中和其虹膜伸缩几何 |
| `ParamBrowLY`、`ParamBrowRY` | -1…1 | 眉毛抬低 |
| `ParamMouthForm` | -1…1 | 现有嘴形变化 |
| `ParamMouthOpenY` | 0…1 | 语音张合 |
| `ParamBreath` | 0…1 | 轻呼吸 |
| `ParamHairFront`、`ParamHairBack` | -1…1 | 前后发梢惯性 |
| `ParamCheek`、`ParamTear` | 0…1 | 已绑定腮红与眼泪透明度 |

当前模型没有手臂／手指、肩部、额外笑眼或眉角绑定。因此 Greet 用轻点头、抬眉和微笑回应；没有把动作命名当作已经实现挥手。眼泪仍由情绪系统驱动，动作不擅自增加泪水。

## 动作编排

| 动作 | 时长 | 内容 | 淡入／淡出 |
| --- | --- | --- | --- |
| Idle | 9 秒循环 | 4.5 秒一次轻呼吸，头部 X 参数小于 1.25 的漂移，轻微重心变化 | 0.65／0.50 秒 |
| Nod | 1.70 秒 | 一次轻点头，头部 Y 参数峰值 8.5，眼睑略放松后复位 | 0.14／0.35 秒 |
| Shake | 1.95 秒 | 小幅否定，头部 X 参数峰值不超过 9，收尾减弱并复位 | 0.14／0.40 秒 |
| TapHead | 2.65 秒 | 眼睑放松、轻微歪头、腮红与微笑逐渐出现后复位 | 0.16／0.50 秒 |
| Greet | 2.15 秒 | 轻点头、抬眉、眼睑微弯和浅微笑后复位 | 0.18／0.45 秒 |

全部曲线采用受限三次 Bezier，计数、时间单调性、实际参数范围与末尾姿态均有检查。Idle 起末姿态一致，且不控制眼睑，避免与自动眨眼同时驱动；非循环动作末尾回到对应中性值。原 Blink 文件保留不变。

所有动作都不写 `ParamMouthOpenY`、头发物理输出或 `ParamTear`。表情用的 `ParamMouthForm` 只在安静时组合；说话期间由语音口型优先控制，取消朗读后嘴巴张合必须绝对关闭。这一组合行为由产品 runtime 与相关回归负责。

## 物理与执行验收

stable-portrait 仅保留前后发梢两项 physics，不加载 `PhysicsEyeJelly`。发梢使用既有 overlay 权重与粒子调整，并由新的固定发际关键形限定真实位移。头部／身体平移输入权重为 30／20，角度输入为 36／24；后发梢输出放大为 1.25，前发梢为 0.85。classic／V2 重建仍保留历史三项 physics 合同。

历史 V2 连续身体 MOC3 已做 Core 6.0.1 一致性、损坏 magic 负例、35 姿态及情绪透明度插值检查。真实 native-frame 回归使用固定官方 Framework 5-r.5，覆盖动作组合、结束复位与原生队列取消；deformation 回归覆盖组合姿态中的比例、虹膜、口部和发际。运行前须核对它们实际读取的模型版本，测试定义与历史 V3 通过不代表 V4 已通过，本轮状态见 [验收记录](validation.md)。现有头发 rig 的输入是左右转头与侧倾，纯上下点头不会虚构另一维头发摆动。

以下为本轮早期 `classic` 动作候选的数值对比，保留用于说明同一套 physics 调整的效果；不将这些网格帧数或峰值转写为新连续身体模型的独立测量。该历史候选的五个动作在 60 fps 下累计执行 1,347 帧真实网格检查。

额外使用相同的 15 秒输入进行原版／新版对比：前 7 秒左右转头幅度 20°、侧倾幅度 8°、身体转向幅度 3°，随后 8 秒保持中性；各帧率的输入使用相同连续时间函数。

| 帧率 | 原前发梢峰值 | 新前发梢峰值 | 原后发梢峰值 | 新后发梢峰值 |
| --- | --- | --- | --- | --- |
| 30 fps | 0.190540 | 0.104004 | 0.228520 | 0.130082 |
| 60 fps | 0.222836 | 0.104042 | 0.228484 | 0.130142 |
| 120 fps | 0.226368 | 0.104055 | 0.228331 | 0.130126 |

新发梢峰值在各帧率之间相差小于 0.05%；以 60 fps 为例，前后发梢幅度分别减小约 53% 与 43%，保留实际运动。原版与新版在此输入下均没有饱和帧，停止后的最后一秒峰值均为 0，因此这里不宣称原版存在饱和故障。新版 30／60／120 fps 共 3,150 个物理时间步检查通过。

runtime 每帧从固定中性 baseline 开始，再合并淡出／当前动作拥有的参数，避免腮红、眉毛或姿态残留。stable-portrait 的互动动作及其淡出阶段拥有的头身角度不再叠入指针转动；摸头／招呼不被同帧的程序点头覆盖。口型 Form 使用短平滑，说话张合优先，停止、休息或隐藏时立即闭嘴。`presence.headY` 只跟随视线，程序点头不重复叠入。

V4 独立导出会生成新的 CMO3 编辑候选；官方 Cubism Editor 打开、保存和再导出仍未验收。classic／V2／V3 CMO3 保留为历史资产，不能作为 V4 的 Editor 兼容性证据。
