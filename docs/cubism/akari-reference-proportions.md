# Akari V5／V6 比例与神态（历史候选）

V5 过去曾作为默认人物部署到网页，但用户仍否定其脸部比例与神态。后续 V6 未作为默认人物上线；它作为非默认候选静态资源随构建保留，用户也没有接受该候选。本轮已经将默认展示恢复为 [`src/avatar/AnimeScene.tsx`](../../src/avatar/AnimeScene.tsx) 的原完整立绘动画并原子部署。它是基于完整立绘的动画展示，不能称为完整 Cubism 模型；下面的 V5／V6 来源与技术检查保留作历史记录，不代表当前默认人物已采用这些资产。

## V5 已部署但未被接受

用户指出 V4 整体脸部比例和神态仍然奇怪，V5 曾直接对照最初温柔日系、奶油白与浅橘少女参考调整眉眼关系，保留稳定动作绑定。

眼组从 V4 的 85% 恢复到 90%，取消虹膜额外 92% 缩小；屏左眼稍低、屏右眼稍高，眉毛同步收小和登记。柔和鼻高光替换硬暗线，下颌登记向下延长 17px，嘴仍在原位。前发源通过 imagegen 缩短下半部，移除包住前胸的厚卷发；刘海上半部与眼部开口保持。内置稳定 profile 的平静状态保留 16% 微量腮红，动作退出后恢复这一基线；隐藏／休息清零，导入模型不加基线。机械 PSD 采样不是重新绘画，19 层源的实际变换可查 [source receipt](../../outputs/avatars/akari-cubism-v5/pack-receipt.json)。

来源、生成提示和重建入口见 [V5 源说明](../../outputs/avatars/akari-cubism-v5/README.md) 与 [provenance](akari-reference-proportions-provenance.json)。V5 使用稳定 profile；V3／V4／V5 的资产和记录都保留为历史。外部导入模型的作者参数合同与当前默认完整立绘动画是不同的运行路径。

V5 当时的官方 Core 与真实模型几何、口型和发根回归通过，Chrome 静态／动态比对与网页交付范围见 [验收记录](validation.md)。实际 V5 部署核对 117 个静态文件，103 个公网资源 hash 读回匹配；这项历史上线事实没有被用户后续否定的外观评价抹去，也没有被转写为美术获得接受。

## V6 非默认候选静态资源

V6 在 V5 的登记布局上替换左右眼白和上睫毛四个源层，保留虹膜、脸、眉、前发、鼻及连续身体来源。其眼图集本地文件为 [`eyes-soft-atlas.png`](../../outputs/avatars/akari-cubism-v6/eyes-soft-atlas.png)，实际 PNG 为 1448×1086、SHA-256 `d605eeebfe523761590eab369323f108b2b815c256532781bb9e7ff9b32d2b0e`。现有记录给出的 imagegen 输出文件名为 `exec-d17e3c85-533f-4572-960a-4ace91a6f57a.png`；完整生成 prompt 未保留，明确记录为 `unknown`，不根据最终图片或 layout 反推提示词。来源记录见 [V6 imagegen.json](../../outputs/avatars/akari-cubism-v6/imagegen.json)。

[`layout.json`](../../outputs/avatars/akari-cubism-v6/layout.json) 从图集采样两块 500×224 眼白和两块 570×282 上睫毛；睫毛额外偏移 `[0,-10]`。这些是机械裁切／采样登记，不是程序绘画。V6 的 19 层 PSD 真实读回和独立导出已完成；本机官方 Core 6.0.1 检查为 pass、35 姿态，实际读取 19 drawables、20 参数、3180 顶点。它只证明该本机模型的数据执行范围，没有证明人物外观符合用户要求，更不能作为公网或实体设备验收。

V6 来源与重建见 [候选源说明](../../outputs/avatars/akari-cubism-v6/README.md)。`public/avatars/akari-cubism-v6/` 的静态文件随 Vite 构建及本轮原立绘恢复部署保留，可作为非默认候选资源访问；V6 未作为默认人物上线，静态文件存在不代表页面选择了 V6。V5 的 Chrome、语音或人物展示验收结果不继承给 V6。

## 验收边界

自动检查证明数据执行与被覆盖的几何边界，不能替代用户对人物外观的评价。V5／V6 的 CMO3 均为工具生成的编辑候选，官方 Cubism Editor 打开、保存和再导出尚未验收；安装包与实体设备本轮不重验。默认人物已经恢复原完整立绘动画并上线，其实际网页结果由当前产品验收记录说明，不使用 Cubism 历史通过记录证明这条展示路径。
