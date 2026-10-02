# V12 原生眼睑任务

## issue-1

- ID: issue-1
- 标题: 统一自然闭合弧线和原生裁剪边界
- 范围: 作者生成器、隔离 V12 候选、真实 Core 测试、Chrome 逐帧验收
- 依赖: 已有 V11 PSD/纹理和官方 Core；TapHead 节奏修复保持
- 验收标准: 睁眼原貌与无关网格保持，眼角稳定，半闭贴合、闭合为柔缓下弧，无透明淡出；不改冻结包
- 状态: done
- 验证方式: 原生几何/纹理对比与 Chrome 逐帧截图；编译成功不是视觉验收
- commit: 与点击眼睑修复合并为 fix(issue-1): align Cubism eyelids and touch blinking

### 已完成的作者/原生验证

- `reference-natural-lids` 为独立作者 profile，仍读取 V11 PSD；历史 `reference-features` 可按原方法复现，不覆盖历史发布资产。
- 最终隔离输出 `.tools/cubism-authoring/akari-v12-natural-attempt5`。runtime `evidence/blink-repair-20261003/v12-candidate-attempt5` 的 23 文件已逐哈希提升至 `public/avatars/akari-cubism-v12`；匹配 editable/receipts `v12-authoring-attempt5` 的 3 文件已逐哈希保存到 `outputs/avatars/akari-cubism-v12`。
- 官方 Core 6.0.1 / MOC5 验证 16 ArtMesh、22 原生参数、3774 顶点、106 组合姿态通过；新增测试对每侧 101 个闭合值检查原生 mask、虹膜刚性、所有眼睑三角形方向和正常闭合不透明淡出。
- 276 项 Cubism/avatar/companion/gesture/interaction 回归通过，`git diff --check` 通过。真实睫毛 alpha 中心的下弧方向检查通过；纹理逐字节保持，头发/身体/眉毛/虹膜/嘴部在组合姿态下保持既有几何。
- 主线程随后补齐 V11/V12 touch 与默认/导入路径集成后，报告 284 项回归与 TypeScript 检查通过。提升后的 public V12 又用 `--profile reference-natural-lids` 完成 106 个真实 Core 姿态验证；该 profile 额外检查正常半闭眼白/虹膜/下睫毛不会透明淡出。
- CMO3 在本次构建原编辑图上，仅 reconcile 眼部 mesh/geometry/channels，保留原 atlas identity 与 physics 引用；codec 读回全部网格 rest positions/UV/indices、六个新网格所有关键点、参数、顶点数、clipping，以及眼白/虹膜的 0/.003/1 末端 opacity 关键点。没有 unsupported atlas rebind notice；六处 `WeldDivergence` 只说明作者替换了原网格，官方 Editor 打开/保存/重导出仍未验。
- 101 个实际 Core 闭合样本的 X 重建误差最大 0.0434265 源像素（完整闭合端点 <0.000023 源像素）；验证器改用既有 0.08 源像素 bake 容差，未放宽到可见眼宽变形。
- MOC SHA256 `c174352f594b1823bdb9cc14b503d64f41cd2be58d9baa6c4dc82450c93c6195`；CMO SHA256 `110970cc85f18d74c1e3afda31cb5bc30db25f06a58bb799041419526745fd0b`；纹理 SHA256 `f38011cf7cd81fe3f09008dfa988b397ef5d82fafb88155b34f9cf8d52586977`。

### 视觉验收

主线程已捕获 V11/V12 闭眼对比及 .75/.5/.25/0 逐帧姿态，确认闭合从笑眼上拱改为自然下弧，未见眼白越过睫毛；随后动态 Wink、自然眨眼和摸头截图检查通过。默认模型已完成集成/上线，frozen 0.9.7 包保持原字节。

## 网页验收完成

V12 已经提升并上线，桌面点击眼部、412×960 触控和实际资源读取通过；详细证据与冻包边界见 ../cubism/akari-natural-eyelids-acceptance.md。0.9.7 云端发布完成后再提交本修复；v0.9.7 标签保持指向原冻结源码。
