# Akari V10 局部表情模型

在 V9 的人物、头发、脸型与合手动作基础上，新增 shy（害羞）、surprise（惊讶）、relaxed（放松）三个局部面部素材及真实 Cubism opacity 参数。六种面部素材各自使用同一头部变形器；它们不拉伸五官，眨眼和 A/O 说话嘴型位于表情层之上。

本包为真实 MOC3：14 个 ArtMesh、22 个参数、2955 个顶点。原有十一层图像保持像素一致；十六组 V9 原生 motion 逐字节保留。新的表情不提供独立眉毛、连续半闭眼睑或虹膜几何，手部仍为交握姿势的小幅整体平移。CMO3 未经官方 Cubism Editor 打开、保存与重导出验收。

生成入口：`Build-AkariCubism.ps1 -Profile reference-expressions`，再运行 `node scripts/authoring/prepare-akari-facial-expressions.mjs`。模型作者素材和 CMO3 存于 `outputs/avatars/akari-cubism-v10`，不进入客户端运行时包。
