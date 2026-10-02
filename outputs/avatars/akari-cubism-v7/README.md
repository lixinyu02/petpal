# Akari V7 原画分层 Cubism 源

V7 使用 `reference-layered` 作者 profile 生成真实 MOC3、图集及 CMO3 编辑候选。唯一中性母稿为 [`artwork/akari/idle.png`](../../../artwork/akari/idle.png)，不缩放脸、眼睛或整个人物；头、身体及两侧发梢机械分层后保留原比例。闭眼、A／O 嘴型和 warm／sad／pout 仅消费同一角色表情母稿的局部覆片，不在运行时切换完整人物图片。

[pack-receipt.json](pack-receipt.json) 记录 7 张母稿 SHA-256、11 个源层的 donor／矩形及中性合成比较。实际 PSD 使用 Photoshop 的上到下 children 顺序，7 个可选覆片默认隐藏；真实读回核对层状态、矩形和全部 RGBA。中性合成与 idle 的 RGB 最大差为 0，alpha 最大差为 1；机械源检查不能证明 Core 或浏览器渲染。原 ImageGen 记录见 [原画提示](../../../docs/avatar-art-prompts.md) 与 [表情提示](../../../docs/avatar-expression-prompts.md)。V7 未新画脸、眼睛、身体或遮挡后的底图。

[authoring-receipt.json](authoring-receipt.json) 是最终 `reference-layered` 导出的真实 receipt，输入 PSD 为 `5541bc800828515499fa8112afe96d47aaaa79e1c370c196fdcd6ba97bc15322`。已保存的 `akari.cmo3` 与运行 MOC／图集均核对导出 hash。CMO3 是实际工具生成的编辑候选，尚未在官方 Cubism Editor 打开、保存和再导出。

原生模型包含 11 个 ArtMesh、16 个实际参数；没有独立眼球视线参数，也没有连续上下眼睑／半闭形变。当前眨眼使用独立左右眼的局部原生闭眼覆片，A／O 可见性与局部嘴唇几何由真实参数控制；具体参数、父级与形变边界见 [作者合同](../../../docs/cubism/akari-reference-layered.md)。

历史复现先运行 `node scripts/authoring/pack-akari-reference-layered.mjs`，再以 `-Profile reference-layered -InputPsd "$PWD/outputs/avatars/akari-cubism-v7/akari.psd"` 导出到新的空目录。[prepare-akari-reference-motions.mjs](../../../scripts/authoring/prepare-akari-reference-motions.mjs) 是运行资源后处理入口，固定处理 `public/avatars/akari-cubism-v7/`：六个动作均过滤至 16 个真实参数并重算曲线／分段／点数，TapHead／Greet 继承 V6 已审核互动曲线。它不是任意空目录的导出命令，须先审核并复制对应作者产物。原始 authoring JSON 与最终 runtime JSON hash 分别记录在 [provenance](../../../docs/cubism/akari-reference-layered-provenance.json)。

本次官方 Core 58 姿态及专用原生模型 7 项／121 组合姿态检查通过，属于资产执行与被覆盖的几何证据。源码默认已选择 CubismScene＋V7；Chrome、真实语音、公网部署及实体设备由产品验收单独确认，本来源说明不代替这些结果。作者工具不进入 App，GPL authoring 与独立 Live2D Core／Framework 许可分别保留。
