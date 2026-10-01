# Akari 连续颈肩模型

2026-10-02 的修正以原 Akari 为基础，保留脸、头发、眼睛和情绪图层，将颈部、锁骨、胸口、衣服、双手与裙底合成一个连续美术层。当前资源位于 `public/avatars/akari-cubism-v2/`；可编辑源位于 [`outputs/avatars/akari-cubism-v2`](../../outputs/avatars/akari-cubism-v2/README.md)。

## 变形原因与修正

旧 `neck.png` 和 `topwear.png` 都包含锁骨与胸口皮肤，两层静态组合即有横向拼接线。头部 Z 旋转与身体层不同步，进一步扩大了领口附近的脱节。降低 `headTurnStrength` 只影响原工具的 XY 形变，不能同时缩小 Z 旋转关键形。

本次用内置 imagegen 的透明编辑流程制作完整无头身体，保留奶油开衫、浅杏蝴蝶结上衣、灰褐裙与腰前相合的双手。第二轮只清理切图外围碎片；生成输出以原字节保存，没有用程序绘画修补皮肤。提示、参考角色与检查结果见 [`body-continuous.imagegen.json`](../../outputs/avatars/akari-cubism-v2/body-continuous.imagegen.json)。原截图仅用于诊断，没有把截图 UI 或背景写入美术。

源 PNG 为 1133×1388，真实 alpha 透明背景。在 alpha≥32 时只有一个主体；黑底检查仍可见少量低透明度外围像素，因此不宣称边缘零噪点。打包器在 1024×1536 原画布内复用原脸／头发坐标，将整个身体源 `[0,0,1133,1388]` 采样放入 `[92,489,840,1029]`，用一个 `topwear` 层取代旧 `topwear`，删除独立 `neck`，产生 20 层 PSD。打包代码只进行 RGBA 采样、组合与 PSD 编码。

## Authoring profile

[`Build-AkariCubism.ps1`](../../scripts/authoring/Build-AkariCubism.ps1) 提供 `classic|continuous-body`，默认仍为 `classic`，以保留历史模型重建方法。未传 `-InputPsd` 时按 profile 自动选择对应 classic／v2 PSD，也可显式指定仓库内的输入。`continuous-body` 必须有一个含像素的 `topwear` 且不存在独立 `neck`，否则停止导出。

| 配置 | classic | continuous-body |
| --- | --- | --- |
| atlasSize／meshSpacing／upscale | 2048／48／1 | 2048／48／1 |
| headTurnStrength（XY） | 0.55 | 0.25 |
| bodyStrength | 0.65 | 0.30 |
| 头部 Z 关键形角度倍率 | 原始 | 0.20，实际极值 ±6° |

独立 Kotlin runner 在相同图层 classification override 下重新建立 preview，通过冻结 PSD2Live 的公开 `RigKeyformSetEdit`、`RigKeyformGeometryEdit` API 修改 `DeformHeadRotation` 的 Z 关键形。它检查轴为 `ParamAngleZ`、key 为 `[-30,0,30]`，只把角度乘以 0.20，保留各关键形的 pivot、scale 与中性位置。导出后再断言角度不超过 ±6°、中性角度为 0。参数控制范围仍为 -30…30，并非将 CDI 改成 ±6。

上游 `2ac751fbb3ffdc8251a82e0d600d97afafafcaac` 的 704 个冻结源文件未修改；变化位于 PetPal 自编 runner。新 MOC3 为 v5，官方 Core 得到 22 drawables、20 个真实参数、3552 顶点、4659 三角形和一张 2048×2048 图集。身体保持单层，没有新增独立手臂、手指或肩部绑定。

## 重建顺序

在仓库根目录执行。工具源码准备、JDK 21／Gradle 9.8.0 和首次依赖下载见 [原 authoring 说明](akari-authoring.md)。不要用构建入口覆盖公开资源目录。

1. 从已保存的原始层与连续身体 PNG 机械生成 PSD：

   ```powershell
   node scripts/authoring/pack-akari-continuous-body.mjs
   ```

   `akari.psd`、`neutral-layout.png` 和 `pack-receipt.json` 写到 v2 源目录。入口要求 `layout.body.file` 为已审核的 `body-continuous.png`，拒绝与布局记录不一致的源文件名称。中性合成图排除互斥闭眼／张口及情绪层，便于检查拼接和比例；它不是实际 runtime 截图。

2. 在新的空输出目录导出 `continuous-body`。已有完整离线依赖和编译 classpath 时使用：

   ```powershell
   ./scripts/authoring/Build-AkariCubism.ps1 `
     -JavaHome 'C:/Tools/Temurin21' `
     -GradleExecutable 'C:/Tools/gradle-9.8.0/bin/gradle.bat' `
     -InputPsd "$PWD/outputs/avatars/akari-cubism-v2/akari.psd" `
     -OutputDirectory "$PWD/.tools/cubism-authoring/continuous-rebuild" `
     -Profile continuous-body -Offline
   ```

   首次环境需要 `-BuildUpstream` 并省略 `-Offline`。入口每次复核冻结 source tree，拒绝非空输出和 `public` 输出；不会启动 GUI、Native preview 或在线 upscaler。

3. 为导出目录应用动作 overlay：

   ```powershell
   node scripts/authoring/polish-akari-motions.mjs .tools/cubism-authoring/continuous-rebuild
   ```

   overlay 只接受已审核的完整 MOC／纹理 hash 配对，保护旧公开包。五个动作、物理与 model3 的细节见 [动作说明](akari-motion-polish.md)。

4. 验证官方 Core 与当前 runtime：

   ```powershell
   node scripts/authoring/verify-cubism-model.mjs `
     .tools/cubism-authoring/continuous-rebuild/akari.model3.json `
     .tools/cubism-authoring/continuous-rebuild/core-validation.json `
     --require-emotions
   node --test tests/cubism-frame.test.mjs tests/cubism-native-frame.test.mjs tests/cubism-motion-assets.test.mjs
   ```

5. 在浏览器和目标 WebView 检查静态颈肩、转头、摸头、招呼、表情、口型及生命周期。完成后再审核要发布的成员。Core 几何通过不能代替这些画面验收；本文件不作为部署回执。

## 交付哈希与验收边界

| 成员 | SHA-256 |
| --- | --- |
| `body-continuous.png` | `301ecb2c7539fbde65a448f94dba7e6f3352ed26fa14416b65ba0cb03824f74c` |
| `akari.psd` | `ff47f7fb5348877ea6972eae13f1067188aece2682b2a35b31a3c8e523ca291a` |
| `akari.moc3` | `29185d2b500ac0b2e1e15f2b053b3fd6444ba72e93a8b33a388f4da8edb04f0b` |
| `texture_00.png` | `e1f468582ecf6a000068128deaa74c2878ec2c01a2529d3c89ef307cc9d62020` |

完整字节数、源脚本和当前 runtime 成员 hash 见 [来源摘要](akari-motion-polish-provenance.json)。官方 Core 6.0.1 的一致性返回 1、损坏 magic 负例被拒绝，35 个姿态与真实情绪绑定采样通过。真实 Framework 的动作合成／结束复位／队列取消由 native-frame 回归检查。浏览器与真实 TTS／设备验收仍应使用各自实际结果，模拟口型不能当作上游语音验收。

新 `akari.cmo3` 是可编辑候选，尚未在官方 Cubism Editor 打开、保存或再导出。CMO3 含导出时间和 GUID，整文件 hash 用于标识此次交付，不能承诺每次重建相同。

## 许可边界

美术由 PetPal imagegen 流程生成并复用本项目已有源层，未使用官方样例人物或第三方 MOC3。独立 PSD2Live／Umamo 工具及自编 Kotlin runner 按 GPL-3.0-only 保留对应源码和许可，未嵌入 App。输出为本项目图像、网格和参数数据；运行 GPL 工具本身不会自动改变输出的许可，是否受覆盖取决于输出内容。完整解释见 [原 authoring 许可说明](akari-authoring.md#许可与再分发边界)。

官方 Cubism Core／Framework 的独立 Live2D 条款和 notice 随运行时保留，GPL 声明不替代这些条款。PSD2Live 不是 Live2D 官方产品，生成 CMO3 也不是官方 Editor 兼容性认证。
