# Cubism 模型与运行时

当前内置角色为原创 Akari V2。连续颈肩源层与新的模型编译流程见 [V2 资产来源与重建](akari-continuous-body.md)，动作、物理与运行时衔接见 [动作说明](akari-motion-polish.md)，当前哈希见 [V2 来源摘要](akari-motion-polish-provenance.json)。[classic 作者记录](akari-authoring.md) 和 [classic 来源摘要](akari-authoring-provenance.json) 保留为旧版重建依据。

真实 MOC3 已通过官方 Core 的一致性、模型创建和 35 组姿态检查。CMO3 是生成的编辑候选，尚未通过官方 Cubism Editor 打开、保存和再导出验收；两者不能互相替代。

独立 GPL authoring 源码位于 [`scripts/authoring`](../../scripts/authoring/)，其编译器和依赖不进入产品运行包。Core 与 Framework 保持各自的 Live2D 许可与 notice。

网页上线、口型与设备验收边界见 [当前验收记录](validation.md)；其中 2026-10-01 的真实 TTS 测试属于 classic 历史记录。
