# 小伴二次元形象

2026-09-26 使用内置 ImageGen 生成的原创成年角色立绘，按用户确认的温柔日系少女、奶油白与浅橘配色制作。

- `idle.png`：原始透明立绘。
- `blink.png`：保持对位，只改变闭眼区域；运行时只采样双眼局部。
- `talk.png`：保持对位，只改变嘴部；运行时只采样口部局部。
- `round.png`：圆口 O/U 近似形状，运行时按开口程度变形。
- `curious.png`：好奇的眼睛和眉毛，运行时只采样眼眉局部。
- `warm.png`：浅笑眼睛与微笑，用于喜悦、害羞的渐变。
- `sad.png`：2026-09-30 使用内置 ImageGen 对 `idle.png` 精准编辑，同尺寸 RGBA；内眉上扬、垂眼、薄泪光和闭合的下垂嘴角。伤心与难过仅局部采样，朗读口型最后覆盖嘴部。

图像为 1024×1536 RGBA。本项目使用连续网格形变与局部表情混合，不是 Cubism 模型包；不包含 `.moc3`、PSD、Cubism Core 或第三方角色。生成提示见 `docs/avatar-art-prompts.md`。

伤心素材完整生成提示见 [`docs/avatar-expression-prompts.md`](../../../docs/avatar-expression-prompts.md)。运行时不整张切换人物。
