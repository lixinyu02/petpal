# Akari V4 统一前发源与编辑候选

本目录为当前默认目标的 V4 作者资产：一张统一透明前发、19 层 PSD、中性合成图与 CMO3 编辑候选，延续温柔日系、奶油白与浅橘少女。它保留原脸／后发与 [V2 连续身体](../akari-cubism-v2/README.md)，修正用户否定的 V3 静态大额头与过大眼睛。

`front-hair.png` 由内置 imagegen 生成并编辑刘海，来源提示在 [front-hair.imagegen.json](front-hair.imagegen.json)。[layout.json](layout.json) 将前发 `[4,22,1020,1248]` 等比采样到 `[170,4,680,832]`；眼组为 0.85，虹膜再乘 0.92，眉毛与其他五官原位保留。源 PNG 未经程序绘画，打包只执行机械 RGBA 采样、合成与 PSD 编码。

[pack-receipt.json](pack-receipt.json) 保存每层源 hash、有效位置及变换，并记录真实 PSD 读回的 19 层顺序／矩形／全部 RGBA 核对。先运行 `node scripts/authoring/pack-akari-unified-hair.mjs`，再以 `-Profile stable-portrait -InputPsd "$PWD/outputs/avatars/akari-cubism-v4/akari.psd"` 导出到新的空目录。完整方法见 [V4 作者说明](../../../docs/cubism/akari-unified-hair.md)。

运行资源入口为 [public V4](../../../public/avatars/akari-cubism-v4/akari.model3.json)，hash 与真实来源见 [V4 provenance](../../../docs/cubism/akari-unified-hair-provenance.json)，实际验收状态见 [验收记录](../../../docs/cubism/validation.md)。V4 的机械打包、独立导出、Core／几何、相关回归、Chrome 动态、正式网页互动、真实 TTS 和公网部署已经完成；412×960 为 Chrome viewport 模拟，ASR 与四端实体设备未在本轮重验，历史 V3 结果没有被转写为 V4 实测。

`akari.cmo3` 为工具生成的编辑候选，尚未通过官方 Cubism Editor 打开、保存或再导出。Core／浏览器通过也不能代替 Editor 兼容性确认；CMO3 的生成时间和 GUID 使整文件 hash 不承诺每次重建相同。
