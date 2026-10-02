# Akari V8 合手动作作者合同

V8 的 `reference-gestures` 使用 V7 原 PSD；不换脸、不调整眼睛大小、不改变刘海覆盖、不使用整张状态图切换动画。旧的 `reference-layered` profile 和 V7 资源保持。

## 原生绑定

| 参数 | 范围／默认 | 全幅源画布作用 |
| --- | --- | --- |
| ParamHandsLift | 0..1／0 | 交握双手共同向上最多 16 px |
| ParamHandsSway | -1..1／0 | 交握双手共同左右最多 6 px |
| ParamSleeveEase | 0..1／0 | 两侧衣袖柔和向内最多 3 px，手指区排除 |

三轴共有 27 组原生 ArtMesh position-delta 关键形。只细化 topwear 网格；手指、双手接触区及穿过该区的完整三角形共用一个平移平台。实际作者网格保护范围约 x290.97..724、y1225..1495.05，90 个相交三角形顶点参与保护，之后在衣袖／裙摆平滑衰减。y≤920 作者几何固定，为 Core 中 y≤860 的颈肩／领口提供插值余量。脸、头发、局部表情贴片的父级和形变合同沿用 V7。

官方 Core 在现有父变形器上计算网格位移时有细微非均匀插值；75 组手参数采样中双手共同位移残差最大 0.1996 个源像素，验收限为 0.25 px（412px 页面不足 0.1 CSS px），不能宣称位移逐位相同。颈肩固定、脸发不动、121 个头身／手部组合姿态无翻面及有限值分别测试。

九个 motion：Idle、Blink、Nod、Shake、TapHead、Greet、Shy、Sway、Bow。后三个时长为 2.6／2.8／2.45 秒，含平缓起落、短暂停顿与回位。产品曲线的手部幅度低于参数全幅；保留原交握姿势。上游 happy／gentle 语气每句最多触发一次 Sway，害羞和感谢文本驱动 Shy／Bow；点击互动优先。停止、缓冲、切换回复、语义动作结束或语气切换会取消语音来源动作；单独缺失情绪元数据且音频仍活跃时，不会立即撤销既有手势。隐藏、休息、减少动态清空动作。嘴型仍由实际播放进度／能量驱动，与动作来源分离。

## 重建

```powershell
./scripts/authoring/Build-AkariCubism.ps1 `
  -JavaHome "$PWD/.tools/jdk-21" `
  -GradleExecutable 'E:/Android/Gradle/gradle-9.8.0/bin/gradle.bat' `
  -InputPsd "$PWD/outputs/avatars/akari-cubism-v7/akari.psd" `
  -OutputDirectory "$PWD/.tools/cubism-authoring/reference-v8-new" `
  -Profile reference-gestures -Offline
```

工具仍使用固定 PSD2Live commit `2ac751fbb3ffdc8251a82e0d600d97afafafcaac`，704 个冻结源码文件未经修改；本机 JDK／Gradle 路径按环境替换。输出目录必须为空。审核原始导出后复制 runtime 文件到独立 V8 目录，CMO3 与 receipt 保存于 outputs；V7 不覆盖。

```sh
node scripts/authoring/prepare-akari-hand-motions.mjs
node scripts/authoring/verify-cubism-model.mjs public/avatars/akari-cubism-v8/akari.model3.json evidence/core-v8.json --profile reference-gestures --require-emotions
node --test tests/cubism-hand-model.test.mjs tests/cubism-hand-motion-runtime.test.mjs
```

动作整理器只写 V8，从 V7 审核过的曲线构建九组，重新计算分段／点数／曲线计数。原始导出与后处理产物在 provenance 中分开记录。

## 能力边界

当前是小幅合手和衣袖动作；原图未提供独立手臂、手指或被双手遮挡的衣服底图，因此不能独立伸指、大幅抬臂、张开双手或完整挥手。眼睑仍为局部闭眼覆片，没有连续半闭几何。CMO3 是真实生成的编辑候选，尚无官方 Editor roundtrip 验收。本轮网页验收不能替代安装包或实体客户端测试。
