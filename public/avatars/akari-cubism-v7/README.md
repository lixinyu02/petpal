# Akari V7 原生 Cubism 资源

本目录保存 `reference-layered` 最终原生模型：真实 MOC3、2048 图集、模型清单、参数／物理与动作 JSON；源 PSD、CMO3 和真实 receipt 见 [V7 作者源](../../../outputs/avatars/akari-cubism-v7/README.md)。人物来自同一 idle 原画的原比例分层，没有缩小脸或眼睛，也不使用完整状态立绘换帧。

模型有 11 个 ArtMesh 和 16 个实际参数，支持小幅头身动作、呼吸、发梢、独立左右闭眼覆片、局部 A／O 嘴型和三种表情覆片。没有独立眼球视线或连续半闭眼几何；完整能力与限制见 [作者合同](../../../docs/cubism/akari-reference-layered.md)。六个动作均经 [运行动作后处理](../../../scripts/authoring/prepare-akari-reference-motions.mjs) 过滤到实际参数并重算计数；TapHead／Greet 继承旧互动曲线，不沿用旧 profile 的虚拟眼球／眉毛参数。

MOC SHA-256 为 `cd23862cb34f5ea26801d638ebc87036f4ba1e08c5d506f27d320df3f7c7c0c9`，图集为 `7c3d2c7ab8762a0012f38977edbe3fc865d3c47cd8a0f194fee30574ddd94c66`。完整源与 runtime hash 见 [provenance](../../../docs/cubism/akari-reference-layered-provenance.json)，其中原始 authoring 输出与动作后处理文件分开标识。

本次官方 Core 58 姿态与专用 7 项／121 组合姿态检查通过。这是资产执行范围；源码默认已选择 CubismScene＋V7，Chrome 画面、真实语音、公网部署与实体设备仍由产品验收分别记录，不因文件位于 public 目录就宣称已上线。CMO3 官方 Cubism Editor 打开、保存和再导出尚未验收。
