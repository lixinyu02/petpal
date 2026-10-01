# 小伴 Akari 原创 Cubism 素材

2026-10-01；保持奶油白＋浅橘少女的原始身份，未使用官方样例角色或第三方模型。

## 编辑资源

- `reference.png`：内置 imagegen 的 identity-preserve 模式生成的正面参考。
- `parts-atlas.png`：内置 imagegen 生成的 16 个独立透明部件。
- `face-parts.png`：内置 imagegen 补充的闭眼、鼻子和闭口部件。
- `emotion-parts.png`：内置 imagegen 制作的双侧腮红和泪光，分别绑定真实 ParamCheek/ParamTear。
- `layout.json`：源矩形与 1024×1536 画布坐标；角色左右与画面相反。
- `layers/`：机械分层后的 21 个 RGBA PNG。
- `akari.psd`：RGB8 分层 PSD v1，可编辑源文件。
- `akari.cmo3`：独立 PSD2Live 编译器产生的编辑候选；尚未在官方 Cubism Editor 打开、保存或再导出验收。
- `assembled.png`：所有源层的组合检查图，包含互斥的张口/闭口、睁眼/闭眼，不能当成 runtime 待机截图。
- `pack-receipt.json`：源 PNG、PSD、每层 hash 与坐标。所有美术由 imagegen 制作；代码只做裁切、采样、布局、PSD 编码。

重新打包：`node scripts/pack-cubism-art.mjs`。

## 生成提示与模式

使用内置 imagegen，无 CLI/API fallback。所有调用均要求透明背景；原始生成文件保留在 Codex generated_images。`parts-atlas.png` 与 `face-parts.png` 保留生成的 alpha。图像查看器在黑底上可能放大 alpha=1 的透明边缘痕迹，应以实际 Core 的同源渲染验收。

参考提示：保留原成年少女的琥珀眼、浅橘波浪发、奶油蝴蝶结、奶油开衫、浅杏上衣与灰褐裙；正面、头部摆正、双手腰前相合，日系 galgame 柔和线稿，没有背景或外部光晕。

分层提示：4×4 透明 production atlas；后发、无五官面部、衣服和双手、颈肩；前发两组、左右眼白；左右完整虹膜、左右上睫毛；左右眉毛、最大张嘴口腔、闭口。要求遮挡区域补全、每项独立、无文字或网格。

补充提示：2×2 透明面部 atlas，只含左右闭眼睫毛线、微小鼻部高光和阴影、完全闭口的温柔微笑线；禁止头部、眼白、虹膜、牙齿、舌头及嘴内开口。

情绪提示：透明图片只含两组对称面部效果；上半部为柔和桃粉腮红与三条淡淡斜线，下半部为细小透明浅蓝泪滴及弯曲泪光线；左右间距相同，没有人物、眼睛、皮肤矩形、文字或背景。

另一次透明边缘清理尝试未改善结果，没有用于最终模型。

## 模型构建与验证

独立工具 [PSD2Live](https://github.com/tsunehimatoi/psd2live/tree/2ac751fbb3ffdc8251a82e0d600d97afafafcaac)，固定 `2ac751fbb3ffdc8251a82e0d600d97afafafcaac`，GPL-3.0。工具源码和运行时只在忽略的 `.tools`，没有嵌入应用；输出不是复制样例 MOC。使用 Java21 与已审计的离线 CLI，upscale=1，不运行 Native preview 或在线 upscaler。

可复现的自编 runner 源码、固定上游 704 个源文件哈希清单、构建／导出／官方 Core 验证入口已保存在非忽略的 [`scripts/authoring/`](../../../scripts/authoring/)。详细步骤及 GPL／SDK 许可边界见 [`docs/cubism/akari-authoring.md`](../../../docs/cubism/akari-authoring.md)，当前输入与输出 hash 见 [`akari-authoring-provenance.json`](../../../docs/cubism/akari-authoring-provenance.json)。CMO3 的官方 Editor 验收与 MOC3 的 Core 验收分开记录。

最终 runtime 家族在 `public/avatars/akari-cubism/`。MOC3 v5 由官方 Core 06.00.0001 真实读取，一致性返回1，损坏 magic 负例返回0，35个姿态/眼口/呼吸/情绪采样通过。原始21层产生23drawables、20parameters、3838vertices/5049triangles、一张2048纹理。独立 custom runner 通过真实图层 classification override 绑定腮红与泪光的0/1透明度关键形（各2个key，默认0），并通过0/.5/1插值采样和两层随头部姿态移动的检查；没有将虚拟参数或 exp3 文件当作真实绑定。

Core 与 Framework 使用独立 Live2D 许可，许可通知随软件保留；这些素材不改变 SDK 的再分发条款。此次仅发布固定原创人物，没有开放任意模型导入。
