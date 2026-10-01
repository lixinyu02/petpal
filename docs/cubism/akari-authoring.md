# Akari Cubism 资产来源与重建

Akari 的美术由 PetPal 的 imagegen 流程生成，奶油白与浅橘配色延续原角色。模型由原创分层 PSD 编译生成；没有复制官方样例人物或第三方 MOC3。源 PNG、分层坐标、21 层 PSD 与机械打包说明在 [`outputs/avatars/akari-cubism`](../../outputs/avatars/akari-cubism/README.md)。

## 已验收与未验收

- **已验收**：真实 MOC3 v5 经官方 Cubism Core `06.00.0001` 读取和创建模型；一致性返回 1，损坏 magic 负例返回 0。35 个姿态覆盖头部、眼睛、嘴部、呼吸与情绪，几何、UV、索引和透明度均检查通过。
- **真实情绪绑定**：PSD 的 `blush`、`tears` 图层通过公开 `LayerClassificationOverride`，分别生成 `ParamCheek`、`ParamTear`（0…1、默认 0）。各有 0／1 两个透明度关键形；官方 Core 的 0／0.5／1 插值采样精确得到对应 drawable 透明度，其他层透明度不变；两层随头部 X／Y 四个端点同向移动。图层名与参数均进入实际 MOC3。
- **编辑项目未验收**：`akari.cmo3` 是 PSD2Live 生成的编辑候选。本次没有在**官方 Cubism Editor** 中打开、保存或再导出；官方 Core 通过不能替代 Editor 验收。交付可编辑格式不代表已经获得该编辑器的兼容性确认。
- **运行端验收独立**：本文件记录资产编译与 Core 检查；Chrome／WebView 画面、语音联动和上线结果由产品验收记录另行确认。

原始 21 层加两条编译生成的嘴唇轮廓，最终为 23 drawables、22 deformers、20 个真实参数、3838 顶点、5049 三角形和一张 2048×2048 图集。固定参数为 atlas=2048、meshSpacing=48、headTurnStrength=0.55、bodyStrength=0.65、upscale=1。没有启动 GUI、Native preview 或在线 upscaler。

## 固定的 authoring 工具

| 项目 | 版本／位置 |
| --- | --- |
| PSD2Live | [`2ac751fbb3ffdc8251a82e0d600d97afafafcaac`](https://github.com/tsunehimatoi/psd2live/tree/2ac751fbb3ffdc8251a82e0d600d97afafafcaac)，源码声明 1.6.0 |
| 上游源码 ZIP SHA-256 | `e97360577560c87ac6eae8bb2b96018a92cf2528af580a5b71385be9c7f4893e` |
| 工具链 | JDK 21；本次使用 Temurin 21.0.12.1、Gradle 9.8.0、Kotlin 2.4.10 |
| 冻结源文件清单 | [`scripts/authoring/psd2live-source-manifest.json`](../../scripts/authoring/psd2live-source-manifest.json)，704 个文件逐项大小与 SHA-256 |
| 自编参数绑定 runner | [`scripts/authoring/cubism/src/main/kotlin/PetPalAuthoring.kt`](../../scripts/authoring/cubism/src/main/kotlin/PetPalAuthoring.kt) |
| 重建入口 | [`Build-AkariCubism.ps1`](../../scripts/authoring/Build-AkariCubism.ps1) |
| 官方 Core 检查 | [`verify-cubism-model.mjs`](../../scripts/authoring/verify-cubism-model.mjs) |
| 当前交付来源摘要 | [`akari-authoring-provenance.json`](akari-authoring-provenance.json) |

runner 使用冻结工具的公开 API，没有修改上游源文件。它先 inspect 真实 PSD，按真实 layer ID 绑定 `blush`／`tears`，拒绝缺层或没有像素的素材，然后导出模型并校验真实参数范围。源码在仓库里，编译缓存、工具依赖和输出放在忽略的 `.tools/`；PetPal 的 Node 依赖和四端运行包不包含该 GPL 编译器。

交付入口已在上述固定环境下离线构建并新导出：MOC3、图集及其余 8 个 runtime／元数据文件与初次导出逐字节一致。CMO3 的容器与图包含上游生成的时间记录和 GUID，其整文件 hash 会变化；来源摘要分别记录交付项目与新导出项目的 hash，不承诺编辑容器逐字节可重复。

## Windows PowerShell 重建步骤

在仓库根目录执行。先准备已安装的 JDK 21 和 Gradle 9.8.0；不要使用下载源码内的 wrapper JAR。

1. 获取固定源码 ZIP，再只提取经过审核的 704 个源文件。脚本会检查整个 ZIP 与每个选中成员的 SHA-256，拒绝已有非空目标目录；样例模型、SDK/Core 二进制、wrapper JAR 和 release payload 不会被提取。

   ```powershell
   New-Item -ItemType Directory -Path .tools -Force | Out-Null
   Invoke-WebRequest -Uri 'https://codeload.github.com/tsunehimatoi/psd2live/zip/2ac751fbb3ffdc8251a82e0d600d97afafafcaac' -OutFile .tools/psd2live-pinned.zip
   ./scripts/authoring/Prepare-PinnedPSD2Live.ps1 -ArchivePath .tools/psd2live-pinned.zip
   ```

   已有经过相同清单审核的 source tree 时可直接使用；不要用提取入口覆盖它。`Build-AkariCubism.ps1` 每次构建前都会逐项复核冻结源码。

2. 需要重新机械生成 PSD 时执行 `node scripts/pack-cubism-art.mjs`；它只按 `layout.json` 裁切、采样、排布并编码 PSD，不绘制或重新生成美术。仓库已提供可直接编译的 PSD。

3. 首次构建会从上游声明的 Maven／Gradle 仓库取得依赖。设置实际工具路径，运行固定工具的 `writeRunArgs`（不启动 GUI），再编译独立 runner 并导出到新目录：

   ```powershell
   ./scripts/authoring/Build-AkariCubism.ps1 `
     -JavaHome 'C:/Tools/Temurin21' `
     -GradleExecutable 'C:/Tools/gradle-9.8.0/bin/gradle.bat' `
     -BuildUpstream `
     -OutputDirectory "$PWD/.tools/cubism-authoring/model-first"
   ```

   随后的导出可加 `-Offline` 并省略 `-BuildUpstream`，但仍必须使用新的空输出目录。`-SourceDirectory`、`-GradleUserHome` 可指定已有冻结 source tree 和独立缓存。脚本不覆盖 `public`，也不修改四端应用依赖；本机生成 receipt 为 `.tools/cubism-authoring/latest-authoring-receipt.json`。

4. 执行官方 Core 验证。默认使用产品内依法再分发的 `public/vendor/live2d/live2dcubismcore.min.js`；也可用 `--core <路径>` 指向已合法取得的官方 Core 文件。

   ```powershell
   node scripts/authoring/verify-cubism-model.mjs `
     .tools/cubism-authoring/model-first/akari.model3.json `
     .tools/cubism-authoring/model-first/core-validation.json `
     --require-emotions
   ```

   检查当前发布模型可将第一个参数改为 `public/avatars/akari-cubism/akari.model3.json`，receipt 仍写 `.tools/`。只有 `status: pass` 表示检查通过。验证脚本不修改模型，官方 Core 在无文件／网络接口的 VM 中执行。

5. 在实际浏览器／设备上检查外观、动效、口型与情绪，再审核要更新的 runtime 文件。CMO3 如需供官方 Editor 继续编辑，应单独完成打开、保存与再导出验收。

## 许可与再分发边界

PSD2Live 及其中的 Umamo 组件使用 GNU GPL version 3。独立 Kotlin runner 与它的 Gradle 构建源代码使用 `GPL-3.0-only`，源码顶部保留创建日期与版权说明，完整许可位于 [`scripts/authoring/cubism/LICENSE.GPL-3.0`](../../scripts/authoring/cubism/LICENSE.GPL-3.0)。上游工具的版权、许可与第三方 notice 保持原样，并由冻结 source-only 提取保留。它不是 PetPal 产品运行时模块。

GPL 第 2 节明确说，程序输出仅在其内容本身构成 covered work 时才受该 GPL 覆盖。这里输出的内容是原创图像、网格、参数、物理与动作数据，没有嵌入工具程序代码或其样例美术；编译器许可不会仅因运行工具而自动转移到这些美术数据。美术／模型来源与 SDK 许可分别记录。

若以后**单独分发编译器或编译后的 runner**，需按 GPL 第 4／5／6 节保留适用版权、修改说明、完整许可，并为二进制提供对应源码与构建脚本；不能把一个上游链接当作二进制对应源码交付的替代。当前仓库提供自编 runner 的源码和复现说明，没有把 GPL 编译器二进制打进 App。

Live2D Cubism Core 与 Framework 使用独立的 Live2D 条款，相关许可和 notice 随运行时保留；authoring 的 GPL 声明不会取代这些条款。Core 检查器读取用户依法获得的官方 runtime，没有复制官方样例模型。PSD2Live 并非 Live2D 官方产品，生成 `.cmo3` 的格式声明也不构成官方 Editor 认证。
