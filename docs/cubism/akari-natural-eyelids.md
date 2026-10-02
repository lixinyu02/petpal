# Akari V12 自然眼睑

V12 修复真实 Cubism 模型的闭眼形状。V11 的上睫毛整体下移后仍保留睁眼上拱，闭眼像笑眯眼；半闭时又与压成直线的眼白不贴合。V12 让上下睫毛和眼白沿同一柔缓下弧闭合，以原生网格与 mask 裁切虹膜。

原 V11 PSD、RGB/alpha 纹理字节、16 个 ArtMesh、22 个原生参数和 16 组动作保持。仅六个眼睑/眼白网格改为共享 X 列拓扑，顶点总数从 3261 改为 3774；虹膜继续刚性移动，头发、头身、眉毛、合手和嘴部几何不变。正常闭合不再在最后四分之一共同淡出；仅 `EyeOpen <0.003` 的亚像素残余隐藏。

运行时目录为 `public/avatars/akari-cubism-v12/`，匹配的 CMO3 与作者/打包回执保存在 `outputs/avatars/akari-cubism-v12/`。原 PSD 继续复用 `outputs/avatars/akari-cubism-v11/akari.psd`，无新增生成图片。运行时 deformation profile 仍为 `reference-features`；作者构建 profile 独立为 `reference-natural-lids`，所以旧 V11 仍能按旧入口复现。

## 复现

先选择全新的隔离导出目录，不覆盖已存在的模型或 live `dist`：

```powershell
./scripts/authoring/Build-AkariCubism.ps1 `
  -JavaHome "$PWD/.tools/jdk-21" `
  -GradleExecutable 'E:/Android/Gradle/gradle-9.8.0/bin/gradle.bat' `
  -Profile reference-natural-lids `
  -OutputDirectory "$PWD/.tools/cubism-authoring/akari-v12-review" -Offline

node scripts/authoring/prepare-akari-natural-eyelids.mjs `
  .tools/cubism-authoring/akari-v12-review `
  evidence/v12-review/runtime evidence/v12-review/editable

node scripts/authoring/verify-cubism-model.mjs `
  evidence/v12-review/runtime/akari.model3.json `
  evidence/v12-review/core.json --profile reference-natural-lids

$env:PETPAL_NATURAL_LIDS_MANIFEST="$PWD/evidence/v12-review/runtime/akari.model3.json"
node --test tests/cubism-natural-eyelids.test.mjs
Remove-Item Env:PETPAL_NATURAL_LIDS_MANIFEST
```

打包器核对作者回执、PSD 与 V11 纹理逐字节一致后才输出候选，明确拒绝写入 live `dist`、冻结安装包或覆盖 V11。CMO3 基于本次构建自己的编辑图，只更新眼部 mesh/geometry/channels，保留原图层、atlas identity 和 physics 引用；不把旧 CMO3 当成新模型。

## 验收边界

官方 Core 6.0.1 / MOC5 的 106 个组合姿态、左右各 101 个连续闭合值、mask/虹膜刚性/三角形方向、纹理与无关网格保持检查通过；276 项相关回归通过。CMO3 经 codec 读回参数、全部网格 rest positions/UV/indices、眼睑几何关键点、clipping 和眼白/虹膜末端 opacity 关键点，并保留六处作者网格替换的 `WeldDivergence` 提示。

主线程 Chrome 已检查睁眼至完全闭合的五个姿态，闭眼从上拱笑眼改为自然下弧，未见半闭眼白越过睫毛边缘。动态、桌面点击、412×960 触控模拟及公网部署已完成，见 [实际验收](akari-natural-eyelids-acceptance.md)。CMO3 尚未经官方 Cubism Editor 打开、保存及重导出；原生结构检查不能代替该验收。

V11 资产和冻结 0.9.7 包保持原字节。新 V12 网页资产或默认配置变更不会自动进入这些旧安装包；后续打包需要单独纳入。
