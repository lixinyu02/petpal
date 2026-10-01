# Cubism 模型与运行时

当前源码默认角色为原创 Akari V4 `stable-portrait`，入口为 `public/avatars/akari-cubism-v4/akari.model3.json`。V4 保留原脸、后发与 V2 连续颈肩身体，换用一张统一前发并缩小眼组与虹膜，延续温柔日系、奶油白与浅橘少女的设计。美术来源、19 层 PSD 与重建方法见 [V4 统一前发说明](akari-unified-hair.md) 和 [V4 来源摘要](akari-unified-hair-provenance.json)。

V4 已完成机械 PSD 打包、独立导出、真实 Core／几何、210 项相关回归、Chrome 动态、正式网页互动、真实 TTS 与公网部署验收，范围见 [验收记录](validation.md)。412×960 使用 Chrome viewport 模拟，ASR 与四端实体设备未在本轮重验。[V3 稳定人物说明](akari-stable-portrait.md) 保留历史动态修复及其真实验收，但用户仍否定其静态额头覆盖与大眼比例，这些问题推动了 V4；每代结果分别记录。CMO3 是生成的编辑候选，尚未通过官方 Cubism Editor 打开、保存和再导出验收；Core 可执行和 Editor 兼容性不能互相替代。

[V2 连续身体来源](akari-continuous-body.md)、[动作与物理说明](akari-motion-polish.md)、[V2 来源摘要](akari-motion-polish-provenance.json)、[V3 来源摘要](akari-stable-portrait-provenance.json)、[classic 作者记录](akari-authoring.md) 和 [classic 来源摘要](akari-authoring-provenance.json) 保留为历史依据。V4 只消费新生成的统一前发，原脸与身体源不重画；作者工具在独立目录导出新的模型与 CMO3 候选。

独立 GPL authoring 源码位于 [`scripts/authoring`](../../scripts/authoring/)，其编译器和依赖不进入产品运行包。Core 与 Framework 保持各自的 Live2D 许可与 notice。

网页上线、口型与设备验收边界见 [验收记录](validation.md)；classic 与 V3 的真实 TTS 测试、V2 的模拟语音预览均不能替代 V4 真实语音验收。
