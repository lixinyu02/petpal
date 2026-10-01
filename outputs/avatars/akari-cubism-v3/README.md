# Akari V3 编辑候选（历史）

`akari.cmo3` 来自 V3 `stable-portrait` 作者流程，修正动态脸部、虹膜、嘴部重叠和额头／发根滑动。画稿沿用 [V2 PSD](../akari-cubism-v2/akari.psd)，无需复制或重新生成美术。用户仍否定其静态额头覆盖与大眼比例，当前默认目标改为 [V4](../akari-cubism-v4/README.md)。

运行时资产在 [public V3](../../../public/avatars/akari-cubism-v3/akari.model3.json)，重建方法见 [作者说明](../../../docs/cubism/akari-stable-portrait.md)，hash 与检查边界见 [来源清单](../../../docs/cubism/akari-stable-portrait-provenance.json) 和 [验收记录](../../../docs/cubism/validation.md)。

重建历史 V3 时需要显式传入 V2 PSD：`-Profile stable-portrait -InputPsd "$PWD/outputs/avatars/akari-cubism-v2/akari.psd"`；该 profile 默认输入现为 V4，不能只传 profile 来重建 V3。

CMO3 是独立保存的工具生成候选，尚未通过官方 Cubism Editor 打开／保存／再导出验证。历史 Core 和 Chrome 验收针对 V3 MOC3；没有以此代替 Editor 兼容性、用户美术接受或 V4 验收。
