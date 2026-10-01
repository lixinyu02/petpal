# Akari V3 稳定人物模型（历史）

2026-10-02 的 V3 `stable-portrait` 修复针对动作中脸和身体被拉扯、五官与发际不协调的问题，历史入口为 `public/avatars/akari-cubism-v3/akari.model3.json`。V3 保留同一 Akari 的原美术，复用 [`outputs/avatars/akari-cubism-v2/akari.psd`](../../outputs/avatars/akari-cubism-v2/akari.psd) 中的原脸、眼口、头发和连续颈肩身体；没有重新生成角色图片，也没有替换人物身份。当前默认目标已进入 [V4 统一前发](akari-unified-hair.md)。

V3 导出当时通过 Core、几何及 Chrome 动态检查并更新网页，相关 hash 与实际结果保留在 [验收记录](validation.md) 和 [V3 来源清单](akari-stable-portrait-provenance.json)。用户随后仍指出静态额头过大、前发覆盖不足及眼睛过大；动态参数检查没有解决源图比例，故 V3 不作为人物美术已被用户接受的结论。编辑候选保存为 [`outputs/avatars/akari-cubism-v3/akari.cmo3`](../../outputs/avatars/akari-cubism-v3/akari.cmo3)，PSD 复用 V2 的原文件。

## 修复范围

- 全身 XY 改为小幅整体位移，Z 与呼吸使用按实际画布比例计算的刚性旋转和抬升，避免头部继承躯干的非等比拉伸。
- 脸轮廓、五官和头发共享头部位移，取消各局部重复的角度透视形变。保留原中性关键形坐标及父子关系，避免把像素坐标和父级 UV 坐标混用。
- 前发上部 3/4、后发上部 2/3 的控制点固定，保留下部发梢的小幅物理运动。前后发梢按各自父级的实际尺寸换算像素位移，端点横向预算分别为 6 和 8 像素，抬升分别为 0.8 和 1 像素，避免不同局部坐标导致摆幅失真。
- 停用 `PhysicsEyeJelly`，并把虹膜 `ParamEyeBallForm` 的几何关键形恢复为中性形状；开心等表情不再把眼球缩放当作笑眼。独立眨眼、视线、眉毛、脸红和泪光仍使用真实绑定。
- 关闭工具额外生成的嘴唇轮廓，用原闭嘴／张嘴图层的透明度关键形切换，保留原口部几何关键形。当前内置 V3 的语音开度限制为 0.6；其他导入模型保留各自的完整开度范围。
- Nod／Shake／TapHead／Greet 及其淡出阶段拥有的头身角度不再叠加指针转动。每帧从中性参数重新组合，朗读张合最后写入，停止、隐藏与休息时闭嘴并取消原生队列。

这些修改提供轻微位移、侧倾、呼吸、发梢、表情与口型，没有新增手臂、手指、肩部或完整三维转头绑定。动作范围和轻微侧倾是模型关键形的合同，不应把控制参数值直接写成实际渲染角度。

## 作者工具与来源

独立 Kotlin runner 使用冻结 PSD2Live `2ac751fbb3ffdc8251a82e0d600d97afafafcaac` 的公开编辑 API，不改上游 704 个冻结源文件。工具准备、JDK 21、Gradle 9.8.0 与许可说明见 [classic authoring](akari-authoring.md)；V2 连续身体的生成来源见 [连续颈肩说明](akari-continuous-body.md)。GPL 编译器及 runner 的编译依赖不进入产品运行包，官方 Framework／Core 保留独立 Live2D 许可及 notice。

`Build-AkariCubism.ps1` 保留 `classic`、`continuous-body` 与 `stable-portrait` 三个 profile。命令默认 profile 仍为 classic；stable-portrait 现在默认输入 V4 统一前发 PSD。复现历史 V3 必须明确传 `-Profile stable-portrait` 与 `-InputPsd "$PWD/outputs/avatars/akari-cubism-v2/akari.psd"`，避免误用 V4 输入。

stable-portrait 保留真实参数 ID 与范围，中性网格、父级和正常眨眼／眉毛／口部几何关键形均由 runner 检查。它对全身和头部关键形验证刚性格点，对发际固定区与发梢预算、虹膜中性几何做独立断言；这些断言不能代替最终 MOC 与动态画面检查。

## 重建顺序

在仓库根目录执行，先准备已审核的冻结 source tree 与离线依赖。导出目标必须为新的空目录，不能直接覆盖 `public` 或旧版本模型。

1. 只有需要重新机械打包 PSD 时才执行以下命令；它复用保存的源 PNG，只进行 RGBA 采样与 PSD 编码，不生成新美术：

   ```powershell
   node scripts/authoring/pack-akari-continuous-body.mjs
   ```

2. 用稳定人物 profile 独立导出：

   ```powershell
   ./scripts/authoring/Build-AkariCubism.ps1 `
     -JavaHome 'C:/Tools/Temurin21' `
     -GradleExecutable 'C:/Tools/gradle-9.8.0/bin/gradle.bat' `
     -InputPsd "$PWD/outputs/avatars/akari-cubism-v2/akari.psd" `
     -OutputDirectory "$PWD/.tools/cubism-authoring/stable-rebuild" `
     -Profile stable-portrait -Offline
   ```

   首次环境使用 `-BuildUpstream` 并省略 `-Offline`。导出生成 MOC3、图集、原始动作与 CMO3 编辑候选，并写 authoring receipt；不会启动 GUI、Native preview 或在线 upscaler。CMO3 含生成时间和 GUID，不承诺整个编辑容器每次重建字节相同。

3. 待 MOC／图集配对经审核并纳入 overlay 支持后，对这个独立目录应用动作和物理数据：

   ```powershell
   node scripts/authoring/polish-akari-motions.mjs .tools/cubism-authoring/stable-rebuild
   ```

   使用显式目录；overlay 不编译 MOC、不改源美术，拒绝未知或混合的 MOC／图集配对。stable-portrait 仅保留 `PhysicsHairBack` 与 `PhysicsHairFront`，旧 profile 的三项 physics 合同保留。

4. 执行官方 Core 验证与真实模型回归：

   ```powershell
   node scripts/authoring/verify-cubism-model.mjs `
     .tools/cubism-authoring/stable-rebuild/akari.model3.json `
     .tools/cubism-authoring/stable-rebuild/core-validation.json `
     --require-emotions
   node --test tests/cubism-deformation-geometry.test.mjs tests/cubism-deformation-runtime.test.mjs tests/cubism-frame.test.mjs tests/cubism-native-frame.test.mjs
   ```

   回归使用其当前配置的模型路径，后续可随默认目标切换到 V4；复现历史 V3 时必须核对测试实际读取 V3 资产。独立导出目录须先与对应候选逐项核对，不能把现有公开候选的测试当成刚生成目录的验证。

5. 用 Chrome 检查单参数、组合姿态和慢速动态：头身／五官比例、发际与颈肩、指针和互动同时输入、表情、真实语音口型及停止、412×960、隐藏／休息、两实例和回退。最终候选的浏览器与公网读回验收独立记录，通过后再更新静态资源。

## 验收边界

真实 Core 的 MOC 一致性与几何检查只能说明模型可执行及被覆盖的形变合同。Chrome 可视检查、真实 TTS／ASR、Android／Ubuntu／Windows 实体设备与安装包运行是不同的证据。

CMO3 仍是工具生成的编辑候选，尚未在官方 Cubism Editor 打开、保存和再导出。导出 CMO3、Core 读取 MOC3 和浏览器显示人物都不能替代官方 Editor 兼容性验收。classic／V2 的源与历史记录保留，不能以其验收结果证明本轮最终模型。
