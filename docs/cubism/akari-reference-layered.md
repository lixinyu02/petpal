# Akari 原画分层 Cubism 作者 profile

`reference-layered` 把同一角色的原中性原画像素机械分层后，使用冻结 PSD2Live 的公开 API 生成真正 MOC3、模型清单、图集与 CMO3 编辑候选。它不使用整张状态图切换动画，不把头发、眼睛和嘴分别套用自动透视，也不改变原画的人物比例。`classic`、`continuous-body` 与 `stable-portrait` 保留原有行为。

## PSD 图层与参数合同

此 profile 只接受 1024×1536、无重复且非空的图层。必需图层为 `topwear`、`face`、`front hair 1`、`front hair 2`、`blink-left`、`blink-right`、`mouth-a`、`mouth-o`；`warm`、`sad`、`pout` 可选。旧的 iris、eye-white、lash、blush、tears 拆件不属于这个合同。

| 图层 | 实际参数 | 范围／默认 | 行为 |
| --- | --- | --- | --- |
| blink-left | ParamEyeLOpen | 0..1／1 | 角色左眼，即屏幕右眼；闭眼覆片在 0..0.60 为全可见，0.62..1 隐藏 |
| blink-right | ParamEyeROpen | 0..1／1 | 角色右眼，即屏幕左眼；同上 |
| mouth-a | ParamMouthA | 0..1／0 | 发声底嘴覆片；0 隐藏，0.08 以后全可见 |
| mouth-o | ParamMouthO | 0..1／0 | 在 A 上方的圆口覆片；0 隐藏，0.08 以后全可见 |
| mouth-a / mouth-o | ParamMouthOpenY | 0..1／0 | 仅局部唇区纵向收合，原外部肤色及覆片边固定 |
| warm / sad / pout | ParamWarm / ParamSad / ParamPout | 0..1／0 | 存在图层才产生绑定；运行桥选择主导表情并平滑强度 |

运行桥在有可闻语音时打开 A 底嘴；圆口时在其上打开 O，其余口型关闭 O。停声、隐藏和休息时 A、O、OpenY 归零。A 与 O 可同时为 1，顺序是 A 底层、O 上层；不要把两个覆片做互斥渐入而暴露原闭嘴。生成器明确按名称写 draw order：身体 100、脸 200、发梢 210、情绪 300、闭眼 310、A 320、O 330。

源 PSD 可将可选表情和口眼覆片设为隐藏，使美术软件打开时呈现中性原画。作者 profile 在分析／导出时明确启用这些图层，再由真实参数关键形控制默认透明度；不能将其作为 editor guide 或在导出时删除。

## 形变边界

`face` 和所有表情、眼口覆片共享新增的 `DeformReferenceHead`；躯干独立位于 `DeformReferenceBody`。新增 child warp 使用原父级 UV 空间，按父网格细分到头部 40×32、身体 18×12，保留原中性控制点和 mesh 坐标。头发 follow 只在相同 UV 空间移动到新头部 child，发梢再经过自己的物理 warp。

- 所有工具生成的头、身体、脸轮廓、五官透视和独立头旋转关键形恢复中性。头部动作由新增 child 实现，而不是叠加多次局部形变。
- y≤620 的头脸区域同幅刚性运动；衰减起点选 622 后的第一个节点，终点选 678 前的最后节点，保留 2 像素作者／Core 标定余量。这样跨格插值后真实 y≤620 的上脸仍刚性、y≥680 的颈肩交界仍固定。三个头角度的最大组合约 1.8°，不是完整三维转头。
- 身体固定区延伸至 860 后的第一个网格节点，保证插值后 y≤860 的真实 mesh 颈部与肩部固定；下方平滑承接身体角度和呼吸。最大横移 2.2 像素、纵移 1.85 像素；头部不继承这项身体形变。
- 发梢前两行控制点固定，下部最大横移 1.25 像素、抬升 0.15 像素。原分层没有新绘制遮挡后的底图，不能无限增大发梢摆动。
- 嘴覆片独立加密网格。`ParamMouthOpenY` 只改变嘴唇附近的纵向坐标，x 不变；画布 x≤474、x≥562、y≤465、y≥529 固定。作者位移上限为 11.8 像素，给 Core 的像素标定留出余量，真实 Core 验收仍保持最大 12 像素。两覆片在全开关键形保持原像素形状。

作者断言检查原中性 lattice、drawable rest mesh、父级、上脸刚性与等距、颈肩固定、发根固定、实际动作非静态、覆片默认隐藏、真实参数范围、局部嘴唇位移与外边界固定。官方 Core 仍须对本次目录单独读取 MOC 并测量参数；Chrome 截图和动态画面决定可视验收，作者断言不能替代它们。

此 profile 移除没有真正几何或透明度作用的七个工具默认参数：`ParamEyeBallX`、`ParamEyeBallY`、`ParamEyeBallForm`、`ParamBrowLY`、`ParamBrowRY`、`ParamMouthForm`、`ParamHairBack`。原画五官不能单独转动眼球或抬眉；当前头姿态、眨眼、局部唇形和三种表情覆片具备真实绑定。含完整 11 层时导出 16 个有效参数；旧 profile 的参数合同保持原样。

当前眨眼是快速切换的局部原生闭眼覆片，并未建立连续上下眼睑形变。睁眼与闭眼图片长期透明度混合会产生双眼线或灰色虹膜，所以过渡缩至 EyeOpen 0.60..0.62；完整闭眼、独立左右眼与正常快速眨眼保留。表情需要静态半闭眼时，应由运行桥选择睁眼或闭眼状态，不能将透明度叠图宣称为真正半闭能力。

## 重建

`Build-AkariCubism.ps1 -Profile reference-layered` 默认读取 `outputs/avatars/akari-cubism-v7/akari.psd`。先完成原画分层和 provenance 审核，使用全新的空输出目录。离线环境实测可用的命令为：

```powershell
./scripts/authoring/Build-AkariCubism.ps1 `
  -JavaHome "$PWD/.tools/jdk-21" `
  -GradleExecutable 'E:/Android/Gradle/gradle-9.8.0/bin/gradle.bat' `
  -InputPsd "$PWD/outputs/avatars/akari-cubism-v7/akari.psd" `
  -OutputDirectory "$PWD/.tools/cubism-authoring/reference-v7-review" `
  -Profile reference-layered -Offline
```

JDK／Gradle 路径是本机工具位置，其他机器应传入自己的 JDK 21 和匹配缓存的 Gradle。8.11.1 的 Kotlin 插件 variant 与本机缓存不匹配，不能把缺失离线依赖误认为作者源编译错误。编译器和 Kotlin runner 为独立作者工具，不嵌入产品包，也没有修改上游冻结源码。

PSD2Live 旧语义检查仅认识 eye／mouth PRESET，无法描述此 profile 的 FACE_DETAIL+TOGGLE 与手工局部唇形。作者断言成功后，输出 `.psd2live.json` 的 `generatedBaseWarnings` 保留原诊断，`warnings` 改为实际绑定和未实现眼球视线／连续眼睑能力的说明；`deformerHierarchy` 与 `nativeBoundParameterIds` 记录编辑后的真实合同。生成 CMO3 仍不等同已通过官方 Cubism Editor 的打开、保存和再导出验收。

## 原画来源与资产 provenance

本次 V7 的唯一中性母稿为 [`artwork/akari/idle.png`](../../artwork/akari/idle.png)，原尺寸 1024×1536，脸、眼睛与人物整体没有缩放或重新绘制。另六张同角色母稿 `blink`、`talk`、`round`、`warm`、`sad`、`pout` 仅提供局部眼口及表情像素。原始 ImageGen 提示分别保留在 [原画提示](../avatar-art-prompts.md) 与 [表情提示](../avatar-expression-prompts.md)；V7 没有新生成另一张脸或身体，也没有绘制遮挡后不存在的底图。

[`pack-akari-reference-layered.mjs`](../../scripts/authoring/pack-akari-reference-layered.mjs) 做原尺寸机械分层和 PSD 编码。[pack receipt](../../outputs/avatars/akari-cubism-v7/pack-receipt.json) 的 7 个母稿 hash 已与原文件逐一核对；11 层 PSD 使用 Photoshop 上到下顺序，可选覆片默认隐藏，真实读回核对矩形、状态及所有 RGBA。按实际可见层合成与保存的中性预览完全一致，与 idle 相比 RGB 最大差为 0、alpha 最大差为 1。这些只属于源图／PSD 核对，不作为 MOC、Core 或浏览器证明。

最终 `reference-layered` 的真实 [authoring receipt](../../outputs/avatars/akari-cubism-v7/authoring-receipt.json)、PSD、CMO3 与 [runtime 资源](../../public/avatars/akari-cubism-v7/README.md) 的 hash 汇总在 [来源清单](akari-reference-layered-provenance.json)。独立作者工具使用固定 PSD2Live `2ac751fbb3ffdc8251a82e0d600d97afafafcaac`，上游 704 个冻结源文件未改；最终原生模型为 11 个 ArtMesh、16 个实际参数。[prepare-akari-reference-motions.mjs](../../scripts/authoring/prepare-akari-reference-motions.mjs) 固定处理 V7 public 目录，将六个动作过滤到这些真实参数并重算曲线／分段／点数，两个互动动作继承 V6 已审核曲线。原始 authoring JSON 与后处理 runtime JSON 的 hash 分开记录，不以 raw receipt 冒充后处理清单。

本次最终 MOC 的官方 Core 58 姿态和专用原生模型 7 项／121 组合姿态检查已通过；源码默认已选择 CubismScene＋V7，Chrome、真实语音、部署和实体设备结果不在这份来源说明中推定。CMO3 是真实生成的编辑候选，官方 Cubism Editor 打开、保存和再导出尚未验证；没有独立眼球视线或连续半闭眼几何的边界保持如上。
