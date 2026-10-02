# Akari V9 神态动作包

V9 完整复用 V8 的真实 Cubism rig：11 个 ArtMesh、19 个参数、2550 个顶点。MOC、纹理、物理、显示信息、图层元数据与原有九组动作逐字节保留，没有新增绑定、重绘人物或重新导出模型。

新增七组原生 motion：Curious（好奇歪头）、Think（思考）、Listen（专注倾听）、Surprise（轻微惊讶）、Reassure（安慰）、Wink（右眼短眨）、Doze（短暂困倦后恢复）。合计 16 组。所有动作从中性开始并返回中性；不写嘴型和整脸情绪覆片，以免打断朗读或叠加表情。

手部仍为原有交握姿势的小幅轻抬和轻摆，不具备独立手臂、指骨或完整挥手。眼睛使用原有局部闭眼素材；没有新增连续眼睑或眼球绑定。Doze 是一次短动作，不是长期睡眠状态。

生成入口：`node scripts/authoring/prepare-akari-expression-motions.mjs`，仅写入 V9 目录。MOC SHA-256：`29ebb1c652f658b2033996583409b920beecd94d2c2b3667b6c67e6820694246`。原始模型作者说明与 Editor 验收边界见 [V8 说明](../akari-cubism-v8/README.md)。
