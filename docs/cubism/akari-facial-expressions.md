# Akari V10 局部表情

V10 将实际表情素材从三套扩到六套，新增害羞（侧目与明显脸红）、惊讶（眉眼与轻启唇）、安心（柔和半垂眼睑）。沿用原有温柔、难过、鼓腮及自然脸。新素材由内置 imagegen 编辑原中性图，完整提示词见 [generation.json](../../artwork/akari/expressions-v10/generation.json)。运行时只使用局部面部像素，不采用生成图中的身体和头发。

## 模型合同

- 新 profile `reference-expressions`，真实 MOC5，14 ArtMesh、22 参数、2955 顶点。
- `ParamShy`／`ParamSurprise`／`ParamRelaxed` 均为 0..1，默认 0；与 Warm/Sad/Pout 共用已有头部变形器。
- 表情层在闭眼和 A/O 口型层之下。旧十一层图像逐像素相同；旧人物几何和十六组原生动作保留。
- 新模型由单一主导表情完整覆盖局部脸部；不同时半透明混合多套瞳孔、眉毛。姿态意图依然平滑，表情层在意图超过 0.08 后显示。
- V10 不再用连续眼睛开度近似困倦，因为这会让原闭眼素材半透明叠在新眼睑上。半垂眼睑来自新素材；自然眨眼、单眼眨眼和睡眠仍使用实际闭眼层。
- 三个参数按真实发现绑定；旧 V7–V9 与用户导入的同名路径不会自动继承新素材行为。

## 对话与语音

害羞、惊讶、安心／温柔／困倦意图分别驱动新脸部素材。补充“惊讶”“吃惊”“感到意外”的明确语义；否定、列举和“意外事故”不会误触发。上游语音情绪优先级不变；实际语音口型在表情、动作和物理之后写入。停止、隐藏与睡眠清理原有生命周期继续生效。

## 重建

```powershell
node scripts/authoring/pack-akari-facial-expressions.mjs
./scripts/authoring/Build-AkariCubism.ps1 `
  -JavaHome "$PWD/.tools/jdk-21" `
  -GradleExecutable 'E:/Android/Gradle/gradle-9.8.0/bin/gradle.bat' `
  -InputPsd "$PWD/outputs/avatars/akari-cubism-v10/akari.psd" `
  -OutputDirectory "$PWD/.tools/cubism-authoring/reference-v10-new" `
  -Profile reference-expressions -Offline
node scripts/authoring/verify-cubism-model.mjs .tools/cubism-authoring/reference-v10-new/akari.model3.json evidence/v10-core.json --profile reference-expressions --require-emotions
node scripts/authoring/prepare-akari-facial-expressions.mjs .tools/cubism-authoring/reference-v10-new
```

整理器拒绝覆盖已有不同的 V10 文件；需要改模型时应创建后继版本，不覆盖已发布资源。打包 PSD 的中性可见层逐像素保持；PSD 预览的透明边缘经过编码器白色 matte 舍入，因此不宣称预览全部 RGBA 字节一致。原始导出与运行时整理分开保存回执。

## 边界

半垂眼睑、侧目和眉形属于原生局部素材，不是独立眼球／眉毛／连续眼睑骨架。原合手姿势继续仅支持小幅整体动作。CMO3 已生成，未进行官方 Editor 打开、保存、重导出。本轮仅更新网页，未重打安装包；语音口型验收不能替代上游 ASR/TTS 服务重测。
