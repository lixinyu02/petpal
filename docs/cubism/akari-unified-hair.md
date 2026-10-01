# Akari V4 统一前发与柔和眼睛

V4 延续最初选定的温柔日系少女、奶油白与浅橘配色，保留 Akari 的脸、眉、鼻、嘴、后发与 V2 连续颈肩身体。它针对用户仍不接受 V3 静态大额头、刘海覆盖不足和眼睛过大的反馈，替换统一前发并缩小眼组；[V3 的动态绑定修复](akari-stable-portrait.md) 继续使用，源图比例和动态执行分别检查。

当前源码默认入口为 `public/avatars/akari-cubism-v4/akari.model3.json`，可编辑源与生成记录在 [`outputs/avatars/akari-cubism-v4`](../../outputs/avatars/akari-cubism-v4/README.md)。机械 PSD 打包、独立导出、V4 真实 Core／几何、相关回归、Chrome 动态、正式网页互动、真实 TTS 及公网部署验收已经完成，范围见 [验收记录](validation.md)。412×960 为 Chrome viewport 模拟，ASR 与四端实体设备未在本轮重验；classic／V2／V3 的历史通过结果和生成的中性合成图没有被当作 V4 实测。

## 源美术与静态比例

[`front-hair.png`](../../outputs/avatars/akari-cubism-v4/front-hair.png) 是本轮唯一消费的新前发源。内置 imagegen 以原角色参考制作透明发型，并在同一前发图上补充自然侧分刘海覆盖；最终 PNG 按工具输出字节保存。提示与身份记录见 [`front-hair.imagegen.json`](../../outputs/avatars/akari-cubism-v4/front-hair.imagegen.json)。它只提供浅橘卷发、奶油蝴蝶结及前发覆盖，不提供替换脸、眼睛、皮肤、耳朵或衣服。程序没有绘画补丁或补画皮肤。

新前发统一了原来两块不一致的头顶和前发，并去掉旧右前发画入的耳部。PNG 原尺寸为 1024×1536；机械打包取 `[4,22,1020,1248]`，两轴等比缩放 2/3，放入原画布 `[170,4,680,832]`。布局以实际生成结果检查和登记，不假定 imagegen 精确遵循请求的像素位置。

[`layout.json`](../../outputs/avatars/akari-cubism-v4/layout.json) 同时指定 `eyeAdjustment: {scale: 0.85, irisScale: 0.92}`。每侧眼白中心作为共同 anchor，眼白、虹膜、睫毛与闭眼线一起缩小至原布局的 0.85；虹膜再按缩小后的自身中心缩小至 0.92。最终整数矩形经过取整，因此各层实际比例以 receipt 的 `effectiveTarget` 为准。眉毛、脸轮廓、鼻、嘴、脸红和眼泪的图层位置保持原值。此处是静态源布局调整，与 runtime 中和 `ParamEyeBallForm` 的拉伸几何不同。

身体直接复用 [V2 连续身体](akari-continuous-body.md) 的 `body-continuous.png`，仍将 `[0,0,1133,1388]` 放入 `[92,489,840,1029]`，没有重新生成身体。classic 的脸与五官源 PNG 也保持原字节。打包器先复核 classic／V2 的源 receipt、PNG SHA-256 和原始尺寸，再从原始 RGBA 采样。

最终 PSD 为 1024×1536、19 层：保留经典图层顺序，删除独立 `neck` 和两块旧前发，以连续 `topwear` 替代旧身体，最后追加一个 `front hair`。[`pack-akari-unified-hair.mjs`](../../scripts/authoring/pack-akari-unified-hair.mjs) 只进行采样、合成与 PSD 编码；实际 PSD 读回逐层比较名称顺序、矩形、尺寸及所有 RGBA 字节，全部通过后才替换输出。每层源 hash、采样区域、有效位置与变换记录在 [`pack-receipt.json`](../../outputs/avatars/akari-cubism-v4/pack-receipt.json)。

## 模型来源

本次独立导出使用固定 PSD2Live `2ac751fbb3ffdc8251a82e0d600d97afafafcaac` 和 PetPal 的 `stable-portrait` runner，上游 704 个冻结源文件未修改。工具与许可见 [classic authoring 说明](akari-authoring.md)；V4 的真实 authoring receipt 和 pack receipt 摘要见 [V4 provenance](akari-unified-hair-provenance.json)。该摘要区别原始作者输出与后续动作 overlay，不把原始 JSON 的 hash 当作已部署成员。

| 来源／产物 | SHA-256 |
| --- | --- |
| 前发 PNG | `7d137f65b9383f863a9fb4ca7efd1d086c3ebb670801ce4eace58e0f7e4c0577` |
| 连续身体 PNG（复用 V2） | `301ecb2c7539fbde65a448f94dba7e6f3352ed26fa14416b65ba0cb03824f74c` |
| 19 层 PSD | `4ef62d6405976149cbd614dd4ccb240f226e06f4c4798eaf57239052948cb01a` |
| 原始导出 MOC3 | `a2dd75ed234fb45cd97c6f1e26cc156c13bb8b671a9f70b7e7a21e882349ed26` |
| 原始图集 | `bdf66abcce40b3178e1383cf3dac4805675f3ec95d5c9a264fae018a896dbc6f` |

原始 authoring metadata 报告 MOC v5、19 drawables、22 deformers、20 个参数、一张 2048×2048 图集。V4 实际 Core 6.0.1 实例已独立读得 19 drawables、20 参数、3603 顶点、4898 三角形，35 姿态检查通过；组合形变与 Chrome 的实际范围见 [验收记录](validation.md)。CMO3 是生成的编辑候选，官方 Cubism Editor 打开、保存和再导出尚未验收。

## 重建顺序

在仓库根目录执行，工具准备与 JDK 21／Gradle 9.8.0 见 [authoring 说明](akari-authoring.md)。仅使用新空导出目录，不覆盖 `public` 或历史版本。

1. 先以保存的 PNG 与 layout 机械重建 V4 PSD：

   ```powershell
   node scripts/authoring/pack-akari-unified-hair.mjs
   ```

   输出为 V4 源目录的 `akari.psd`、`neutral-layout.png` 和 `pack-receipt.json`。pack 入口只接受固定源目录，不接收额外参数；原始 PNG 不修改，中性图排除闭眼／张口／脸红／泪光互斥层。

2. 再独立导出稳定人物 profile：

   ```powershell
   ./scripts/authoring/Build-AkariCubism.ps1 `
     -JavaHome 'C:/Tools/Temurin21' `
     -GradleExecutable 'C:/Tools/gradle-9.8.0/bin/gradle.bat' `
     -InputPsd "$PWD/outputs/avatars/akari-cubism-v4/akari.psd" `
     -OutputDirectory "$PWD/.tools/cubism-authoring/unified-hair-rebuild" `
     -Profile stable-portrait -Offline
   ```

   首次准备依赖时加 `-BuildUpstream`、省略 `-Offline`。profile 命令默认仍为 classic；明确指定 stable-portrait 时，省略 InputPsd 会选择 V4。复现 [历史 V3](akari-stable-portrait.md) 必须显式指定 V2 PSD，历史 V2 仍用 continuous-body。导出不启动 GUI、Native preview 或在线 upscaler。

3. 审核新 MOC／图集配对并纳入 overlay 支持后，应用 [动作与物理](akari-motion-polish.md)：

   ```powershell
   node scripts/authoring/polish-akari-motions.mjs .tools/cubism-authoring/unified-hair-rebuild
   ```

   overlay 拒绝未审核、混合或未知配对；只写动作、physics3 和 model3 JSON，不重新生成美术或修改 MOC。其资产 hash 与原始 authoring JSON 分开记录。

4. 验证实际导出目录的官方 Core：

   ```powershell
   node scripts/authoring/verify-cubism-model.mjs `
     .tools/cubism-authoring/unified-hair-rebuild/akari.model3.json `
     .tools/cubism-authoring/unified-hair-rebuild/core-validation.json `
     --require-emotions
   ```

   只有本次 receipt 的 pass 才证明该目录通过；现有回归须核对其实际模型路径后运行。历史 V3 的 Core／几何或测试通过均不能证明这个新目录已通过。

5. 用 Chrome 检查静态刘海、眉眼比例、前发遮挡、颈肩和衣服，再检查慢速组合姿态、轻发梢、点击／触控互动、开心／害羞／难过／兴奋、说话与停止、412×960、隐藏／休息、两实例和回退。真实 TTS／ASR、公网部署与资源读回、四端安装包与实体设备独立验收，并在 [验收记录](validation.md) 写明实际范围。

## 能力与许可边界

V4 保留 stable-portrait 的轻整体位移、刚性侧倾、呼吸、固定发际与下部发梢物理、独立眨眼、视线、眉毛、脸红、泪光及原嘴图透明度张合。它没有新增独立手臂、手指或肩部绑定，不宣称为完整商用 VTuber 精修模型。

新前发由项目 imagegen 生成，其他美术来自本项目已有源；没有复制官方样例角色或第三方 MOC3。独立 GPL authoring 工具与 runner 的源码和许可保留，不嵌入 App；Core／Framework 的独立 Live2D 许可与 notice 随运行时保留。运行 GPL 编译器本身不自动改变原创图像和模型数据的许可，解释见 [authoring 许可边界](akari-authoring.md#许可与再分发边界)。
