# Akari V6 眼部候选（非默认／随构建保留）

V6 是用户未接受的 Cubism 外观候选，未作为默认人物上线；它作为非默认候选静态资源随构建保留。V5 过去曾作为默认人物部署，但同样未获得用户外观认可。本轮已经恢复 [原 AnimeScene 完整立绘动画](../../../src/avatar/AnimeScene.tsx) 作为默认展示并原子部署，它不能称为完整 Cubism 模型。

V6 在 V5 登记布局上替换眼白与上睫毛四层，保留原虹膜、脸、眉、前发、软鼻和 [V2 连续身体](../akari-cubism-v2/README.md)。[eyes-soft-atlas.png](eyes-soft-atlas.png) 为 1448×1086，现有记录的 imagegen 输出文件名为 `exec-d17e3c85-533f-4572-960a-4ace91a6f57a.png`；完整 prompt 未保留，来源记录 [imagegen.json](imagegen.json) 明确为 `unknown`，没有编造生成提示。

[layout.json](layout.json) 规定四层裁切和位置，[pack-receipt.json](pack-receipt.json) 记录原始 PNG hash、采样及实际 PSD 读回。打包只是机械 RGBA 采样和 PSD 编码；[authoring-receipt.json](authoring-receipt.json) 记录 `stable-portrait` 独立导出。19 层 PSD hash 为 `6b685f594503e7a5ebe075922b60e016e10b3ea751303c5eb9544d9e181505f7`；本机 Core 6.0.1／35 姿态通过，实际模型为 19 drawables、20 参数、3180 顶点。这些结果没有转写为用户美术接受、默认人物展示或实体设备通过。

历史复现应先运行 `node scripts/authoring/pack-akari-unified-hair.mjs --v6`，再显式指定 `-Profile stable-portrait -InputPsd "$PWD/outputs/avatars/akari-cubism-v6/akari.psd"`，导出到新的空目录。不能把仅传 profile 时选择的默认输入当作 V6 重建。[public V6 候选](../../../public/avatars/akari-cubism-v6/README.md) 的静态文件随本轮构建部署保留，未作为默认人物上线；详细历史见 [比例与神态记录](../../../docs/cubism/akari-reference-proportions.md) 和 [provenance](../../../docs/cubism/akari-reference-proportions-provenance.json)。

`akari.cmo3` 是工具生成的编辑候选，尚未通过官方 Cubism Editor 打开、保存或再导出。Core 通过不能代替 Editor、浏览器画面和实体设备验收。
