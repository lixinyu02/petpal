# Akari v2 连续颈肩源资产

2026-10-02。保留原 Akari 的脸、浅橘头发和奶油白服装身份，将颈肩、衣服、双手和裙底制作成一个连续层，替代旧素材重叠的 `neck` 与 `topwear` 皮肤。

## 文件

- `body-continuous.png`：内置 imagegen 编辑生成的 1133×1388 透明身体源，保存最终生成输出原字节。alpha≥32 时只有一个主体，仍有少量低透明度外围像素。
- `body-continuous.imagegen.json`：两轮提示、参考输入角色、来源和图像检查边界；不包含私有截图路径或生成缓存路径。
- `layout.json`：原 1024×1536 画布；身体源采样到 `[92,489,840,1029]`，其余层复用原目录坐标。
- `akari.psd`：20 层可编辑 PSD；复用原脸／头发等层，只有一个完整 `topwear`，没有独立 `neck`。
- `neutral-layout.png`：机械组合的中性检查图，排除互斥闭眼／张口与情绪层。它不是 runtime 截图。
- `pack-receipt.json`：每层源文件、布局和 hash。
- `akari.cmo3`：重新导出的编辑候选；尚未在官方 Cubism Editor 打开、保存或再导出验收。

源脸和头发 PNG 仍位于 `../akari-cubism/layers/`，未重复复制。重新打包执行 `node scripts/authoring/pack-akari-continuous-body.mjs`；代码只采样、合成和编码 PSD，不绘制美术。

## 编译与验收

使用 [`Build-AkariCubism.ps1`](../../../scripts/authoring/Build-AkariCubism.ps1) 的 `-Profile continuous-body`，未传 `-InputPsd` 时自动选择本目录 `akari.psd`，也可显式指定输入。打包器要求布局中的身体文件名与已审核 `body-continuous.png` 一致。固定 PSD2Live source tree 未修改，自编 runner 使用公开 keyform API 将 Z 旋转关键形角度缩至 0.20，保留 pivot、scale 和中性位置；XY／body 强度为 0.25／0.30。完整命令、来源、许可和验收边界见 [`akari-continuous-body.md`](../../../docs/cubism/akari-continuous-body.md)。

当前 runtime 家族位于 `public/avatars/akari-cubism-v2/`。新的 MOC3／图集已通过官方 Core 6.0.1 一致性、损坏负例及 35 姿态检查，得到 22 drawables、20 参数、3552 顶点和 4659 三角形；这些检查不替代浏览器外观、语音或真实设备验收。当前完整 hash 见 [`akari-motion-polish-provenance.json`](../../../docs/cubism/akari-motion-polish-provenance.json)。

该素材未使用官方样例人物或第三方 MOC3。GPL authoring 工具与 Live2D Core／Framework 的许可边界分别保留；生成模型不等于官方 Cubism Editor 兼容性确认。
