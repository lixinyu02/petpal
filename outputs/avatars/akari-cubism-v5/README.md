# Akari V5 原参考比例修正

当前网页默认模型的作者资产。V4 的脸部神态未被用户接受，本次对照最初 [参考图](../akari-cubism/reference.png) 协调眉眼、鼻尖、下颌与发型体积。

内置 imagegen 编辑 V4 前发的下半截，移除胸前大卷发；新鼻素材使用柔和高光与浅色鼻尖线。两张 PNG 按生成原字节保存，提示见 [imagegen.json](imagegen.json)。真 alpha 检查后依 [layout.json](layout.json) 机械采样：前发仍等比 2/3 注册，眼组 90%、虹膜不额外缩小，左右眼微调高低，眉毛 92%，脸层下颌登记延长 17px，嘴和连续身体保持原位。图像生成没有保证指定像素位置；实际成品由源合成和浏览器检查。

重打源：`node scripts/authoring/pack-akari-unified-hair.mjs --v5`。无参数入口仍生成历史 V4，三份原有 V4 产物逐字兼容。19 层 PSD 经原生 RGBA 读回，变换和来源 hash 在 [pack-receipt.json](pack-receipt.json)。

以 `Build-AkariCubism.ps1 -Profile stable-portrait -InputPsd outputs/avatars/akari-cubism-v5/akari.psd` 独立导出到空目录，使用保留的刚性头身、固定发根和发梢轻动绑定。先经官方 Core 验证，再将完整 MOC/atlas pair 纳入 motion overlay；当前 [运行入口](../../../public/avatars/akari-cubism-v5/akari.model3.json)。重建输入及 runtime 产物记录见 [provenance](../../../docs/cubism/akari-reference-proportions-provenance.json)，范围见 [验收记录](../../../docs/cubism/validation.md)。

`akari.cmo3` 为生成的编辑候选，尚未通过官方 Cubism Editor 打开、保存和再导出。本轮网页验收不代表重新验收四端安装包或实体设备，自动测试不代表用户接受美术。
