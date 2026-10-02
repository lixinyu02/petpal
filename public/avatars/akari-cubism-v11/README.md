# Akari V11 连续五官模型

独立左右眉毛、眼白、虹膜和眼睑网格，通过真实 Cubism 参数连续控制眉高、眉角、凝视与闭眼；虹膜使用原生眼白遮罩。整脸表情切换层已移除。保留原有头发、身体、合手动作和 A/O 朗读嘴型，未新增连续嘴角几何。

Official Core 实际读出 16 个 ArtMesh、22 个参数、3261 个顶点。16 组原生 motion 继承 V10，仅保留新 MOC 存在的参数并重新计算曲线元数据。

生成入口：`Build-AkariCubism.ps1 -Profile reference-features`，再运行 `node scripts/authoring/prepare-akari-feature-motions.mjs <raw-export-directory>`。CMO3 尚未经过官方 Cubism Editor 打开、保存与重导出验收。Core 结构验证不能替代浏览器视觉验收。
