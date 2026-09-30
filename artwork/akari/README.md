# 小伴原始立绘

此目录保留 8 张 ImageGen 原始 PNG，尺寸 1024×1536 RGBA，未经重绘或缩放。生成提示和素材来源见 [原始立绘提示](../../docs/avatar-art-prompts.md) 与 [表情提示](../../docs/avatar-expression-prompts.md)。

网页和安装包只发布 [`public/avatars/akari/`](../../public/avatars/akari/) 中的无损 WebP，避免两份相同立绘进入安装包。源码包保留本目录，便于继续编辑和复现。`python scripts/encode-avatar-webp.py` 将这些原始图编码为 WebP，编码参数为 `-lossless -exact -m 6`；全部解码像素验证一致后才发布。`--check` 对已有资源和清单做只读完整 RGBA 审计。

转换需要开发机已有的 Pillow 和 cwebp，不引入应用依赖。不要用仅忽略透明区域 RGB 的比较代替完整 RGBA 比较。
