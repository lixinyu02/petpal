# 0.3 表情资源生成记录

内置 image_gen，基于现有 idle.png 定点编辑；transparent_background=true，保持1024×1536与角色身份。原样复制到 public/avatars/akari，运行时只采样面部相关区域，不切整幅人物。

## round.png

Use case: precise-object-edit. Edit target: provided original transparent anime companion. Change ONLY the small mouth to a modest rounded O-shaped speech mouth, as if saying 'oh' or 'u'. Dark warm rose interior, softly drawn lip line, no teeth and no protruding tongue. Mouth centered EXACTLY on existing mouth. Preserve same face/eyes/brows/hair/skin/clothes/hands/pose and exact 1024x1536 canvas, same crop and pixel alignment, same genuinely transparent alpha background. No other change. This is a local mouth-shape texture for realtime speech animation, not a new character.

## curious.png

Use case: precise-object-edit. Edit target: provided original transparent anime companion. Change ONLY facial expression of the same adult woman to subtle curiosity: one eyebrow slightly raised, other gently drawn inward, eyes a touch wider and attentive with exactly same iris color and eye placement, small gently parted neutral lips (very slight). Warm, cute, thoughtful question, not worried or exaggerated. Preserve exact same character identity, hair strands, skin shading outside face, shoulders, clothes, hands, pose, body and canvas 1024x1536, crop and pixel alignment, silhouette and genuine transparent background. No tears, no text, no symbols, no change to hairstyle or face position. Intended local face overlay for realtime animation; keep original face proportions.

## warm.png

Use case: precise-object-edit. Edit target: provided original transparent anime companion PNG. Change ONLY facial microexpression to a warm delighted smile: gently raised lower eyelids (eyes still OPEN with amber irises visible, NOT closed eye arcs), relaxed eyebrows, subtle rosy cheeks, a slightly wider CLOSED smiling mouth. Adult gentle Japanese anime woman, sweet but restrained, not exaggerated. Preserve exact identity and original head/face geometry, hair strands, pose, shoulder/clothing/hands pixels, canvas dimensions 1024x1536 and perfectly aligned crop; genuinely transparent background and same silhouette. No hearts, symbols, teeth, tears, added props or lettering. For animation face overlay so do not shift face features.

## sad.png — 2026-09-30

内置 `image_gen` 编辑，目标 `public/avatars/akari/idle.png`，`transparent_background=true`；原样复制生成文件到 `public/avatars/akari/sad.png`，没有后期重绘。确认 1024×1536 RGBA、透明 alpha。只在运行时局部混合。

Use case: precise-object-edit. Edit target: the supplied transparent 1024x1536 PNG of the same adult Japanese anime woman. Asset type: pixel-aligned local facial expression texture for a real-time animated companion. Change ONLY her small facial expression into tender sadness: visibly raised inner eyebrow ends and lowered outer eyebrows, slightly drooping upper eyelids with amber irises still OPEN and visible, very delicate wet shine along lower eyelids but NO falling tears or tear streaks, a small CLOSED slightly downturned mouth, subdued cheeks. Keep her lovely and recognizable, restrained and gentle, no extreme distress. Absolutely preserve exact original head position, feature centers, face proportions, hair strands, bangs, skin tone/shading outside tiny facial-feature regions, head tilt, pose, clothes, hands, body silhouette, original canvas 1024x1536 and framing. Do not shift or scale anything. The existing mouth center is around normalized x .503 y .321; eyes centered around (.406,.247) and (.581,.239). Preserve exact pixel alignment so we can blend only the eye/eyebrow/mouth regions over the original. Genuine transparent alpha background, no backdrop, text, symbols, logos, new accessories, panels or additional character.
## pout.png — Galgame 风格轻微鼓腮（2026-09-30）

工具：内置 ImageGen；输入 `public/avatars/akari/idle.png`；输出原样保存为 `public/avatars/akari/pout.png`，保留透明 alpha。类型为 precise-object-edit，未对生成图像做后期重绘。

Use case: precise-object-edit. Asset type: eighth optional facial expression texture for the existing Akari anime companion. Edit only the provided original idle portrait to show a cute, gentle sulky pout (galgame-style 'mou…'), adult woman unchanged: softly narrowed eyes, slightly drawn-together eyebrows (playful displeasure, not threatening anger), subtly puffed cheeks only through interior shading without changing face silhouette, small CLOSED pursed pout mouth, no teeth/tongue, no crying. Preserve EXACT original face/feature positions and pixel alignment, eye centers approximately normalized (.406,.247) and (.581,.239), mouth center (.503,.321). Preserve head angle, hairstyle, every hair strand, face silhouette, pose, clasped hands, cream knit cardigan, pale orange blouse, skirt, hair bow, lighting, 1024x1536 canvas and original crop. Change ONLY the tiny eyes/eyebrows/closed-mouth facial regions and subtle cheek shading; do not redraw clothing or reposition the character. It must be recognizably the exact same character and overlay precisely on the original. Keep genuinely transparent alpha background; do not add background, glow, symbols, text, panels, accessories or additional people.
