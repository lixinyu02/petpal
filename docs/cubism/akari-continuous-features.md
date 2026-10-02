# Akari V11 连续五官与区域互动

V11 使用真实 Cubism MOC3。眉毛、上下睫毛、眼白和虹膜分别拆层，并绑定原生参数；表情可以经过中间状态。当前包含 16 个 ArtMesh、22 个真实参数、3261 个顶点。保留原人物的头发、身体、合拢双手和 16 组动作。

- 虹膜水平 ±3、垂直 ±2 源像素平移，由原生眼白 mask 裁切；闭眼不压缩虹膜。
- 独立眼睑五个几何关键点连续插值，眉高 ±4 源像素、眉角 ±4°。统一头部变形器保留脸型和刘海。
- 旧六套整脸情绪贴图已移除。情绪由既有文本/语音意图映射到眉眼、视线与身体姿态。
- 嘴部仍为 A/O 局部朗读素材及既有开口几何，不宣称独立唇形或嘴角绑定。双手仍是交握姿态的整体小幅移动，不是分指手势。

## 交互与倾听

鼠标在头部停留 650ms 或轻抚移动，会触发摸头回应；合手处停留 900ms 或轻触，会触发温柔轻摆；身体点击给出问候。悬停与点击有冷却，区域切换在冷却结束后仍能回应。拖动其他内容经过人物、多指、取消及手机纵向滚动不会误触。

头、手、身体反馈的手势装饰不同。命中坐标跟随 Cubism 实际 contain 比例和画布位移/缩放。双击问候、长按休息、键盘操作保持。

语音输入 listening/recognizing 期间维持轻微前倾、专注眉眼和缓慢点头。识别草稿更新不重启入场动作；结束后平滑回落。普通动作取消时逻辑立即停止，身体姿态约 0.42 秒缓退；V11 原生头身与手关节增加约 63ms 平滑交接。朗读停止仍立即闭嘴。隐藏、睡眠、减少动态仍立即清理相应动作。

## 素材及复现

原画 `artwork/akari/idle.png`，仅眼眉下方局部底色由内置 imagegen 补画；完整提示词和路径见 [generation-prompt.md](../../artwork/akari/features-v11/generation-prompt.md)。机械分层包含真实 iris×eye-white clipping 的合成逻辑，防止原生渲染时眼周出现白边。中性可见像素与原图差不超过 1/255。

入口顺序：

1. `node scripts/authoring/pack-akari-continuous-features.mjs`
2. `Build-AkariCubism.ps1 -Profile reference-features`，显式提供 JDK、Gradle、PSD 与全新隔离输出目录。
3. `verify-cubism-model.mjs <raw>/akari.model3.json <receipt> --profile reference-features`
4. `prepare-akari-feature-motions.mjs <raw>`，按实际 Core 参数过滤动作并重新统计曲线；所有目标预检后写入，manifest 最后落地。

运行时目录 `public/avatars/akari-cubism-v11/`。PSD/CMO3 和来源回执保存在 `outputs/avatars/akari-cubism-v11/`，不进入运行时包。已经发布的不同内容不能覆盖，应创建后继版本。CMO3 仍未经过官方 Cubism Editor 打开、保存及重导出验收。
