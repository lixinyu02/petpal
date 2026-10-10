# Akari V12 自然闭合眼睑

复用 V11 原 PSD/纹理，保持原生 22 参数、16 ArtMesh、16 组动作。仅修订上下睫毛与眼白局部网格，使闭合沿柔缓下弧并保留原生虹膜 mask；正常闭合不通过透明淡出来隐藏眼睛。

CMO3 经生成器 codec 读回，尚未经官方 Editor 打开/保存/重导出。Core 验证不能替代浏览器逐帧验收。

2026-10-10 主贴图仅改为同尺寸 `cwebp -lossless -exact -m 6` 运输编码：3,142,568 → 1,504,778 字节，减少 52.12%。`akari.2048/texture_00-61e2fb82b9f4.webp` 完整解码后的 RGBA 与保留的 V11 `texture_00.png` 逐字节相同，包括完全透明像素内的 RGB。V12 重复 PNG 在与 V11 字节相同的核验后移除；原源文件保留于 V11 与 Git 历史。

`akari.model3.json` 仅更换 Textures 引用；MOC、16 组动作、物理、显示信息及其他 manifest 字段保持不变。`texture-transport.json` 记录源／发布哈希、完整 RGBA 哈希及每个原生资源哈希。真实浏览器解码、渲染和逐帧验收仍需独立完成。

开发重建：`python scripts/optimize-avatar-loading.py --cwebp <已安装的官方cwebp路径>`；只读核验：`python scripts/optimize-avatar-loading.py --check`。需要现有 Pillow，重建额外需要 cwebp；应用不依赖这两个开发工具。完整像素与篡改拒绝测试：`python tests/avatar_loading_assets_test.py`。旧作者脚本若固定要求 PNG，不应直接用新版发布包重放。
