# 小伴二次元形象

2026-09-26 使用内置 ImageGen 生成的原创成年角色立绘，按用户确认的温柔日系少女、奶油白与浅橘配色制作。

- `idle.webp`：原始透明立绘。
- `blink.webp`：保持对位，只改变闭眼区域；运行时只采样双眼局部。
- `talk.webp`：保持对位，只改变嘴部；运行时只采样口部局部。
- `round.webp`：圆口 O/U 近似形状，运行时按开口程度变形。
- `curious.webp`：好奇的眼睛和眉毛，运行时只采样眼眉局部。
- `warm.webp`：浅笑眼睛与微笑，用于喜悦、害羞的渐变。
- `sad.webp`：2026-09-30 使用内置 ImageGen 对 `idle.png` 精准编辑，同尺寸 RGBA；内眉上扬、垂眼、薄泪光和闭合的下垂嘴角。伤心与难过仅局部采样，朗读口型最后覆盖嘴部。
- `pout.webp`：2026-09-30 使用内置 ImageGen 对 `idle.png` 精准编辑，轻微鼓腮与闭合嘟嘴，只局部采样眼眉和嘴部；角色、服装、姿势与对位保持不变。它是可选的第八张贴图，不增加整张立绘切换。

图像为 1024×1536 RGBA。本项目使用连续网格形变与局部表情混合，不是 Cubism 模型包；不包含 `.moc3`、PSD、Cubism Core 或第三方角色。生成提示见 `docs/avatar-art-prompts.md`。

伤心和鼓腮素材的完整生成提示见 [`docs/avatar-expression-prompts.md`](../../../docs/avatar-expression-prompts.md)。运行时不整张切换人物。

2026-09-30 发布资源改为无损 WebP；原始 PNG 保存在 [`artwork/akari/`](../../../artwork/akari/)，不重复进入网页或安装包。使用现有 `cwebp -lossless -exact -m 6` 编码，8 张解码后 RGBA（包括全透明像素中的 RGB）均逐字节一致。总下载量从 17,899,049 降至 11,222,842 字节，减少 37.30%；首张 idle 从 2,356,254 降至 1,492,668 字节。分辨率和解码后的内存量没有降低。

可复现转换和完整像素审计：`python scripts/encode-avatar-webp.py`；只读复核：`python scripts/encode-avatar-webp.py --check`。这两个开发命令需要已有的 Pillow；重建额外需要已有的 cwebp，应用运行不需要这些工具。[`manifest.json`](manifest.json) 记录原始文件、发布文件及解码 RGBA 的哈希。

2026-10-10 新增独立的加载预览 `preview-1173a5b2a1df.webp`：从原始 `artwork/akari/idle.png` 按 LANCZOS 缩为 384×576，RGB 使用 WebP q85，alpha 与缩放源逐字节相同；58,004 字节。它只供模块／模型加载占位，8 张完整表情纹理、原始 PNG 与本目录的 `manifest.json` 均保持不变。文件名含内容 SHA256 前 12 位，避免更换预览后复用旧缓存。

`loading-preview.json` 记录源、编码参数、发布 SHA、解码 RGBA／alpha 哈希与小于 120 KB 的预算；`python scripts/optimize-avatar-loading.py --check` 会只读核验实际解码结果，不需要 cwebp。重建和完整像素测试参见 V12 README；应用不依赖编码工具。
