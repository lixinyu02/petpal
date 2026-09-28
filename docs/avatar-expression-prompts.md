# 0.3 表情资源生成记录

内置 image_gen，基于现有 idle.png 定点编辑；transparent_background=true，保持1024×1536与角色身份。原样复制到 public/avatars/akari，运行时只采样面部相关区域，不切整幅人物。

## round.png

Use case: precise-object-edit. Edit target: provided original transparent anime companion. Change ONLY the small mouth to a modest rounded O-shaped speech mouth, as if saying 'oh' or 'u'. Dark warm rose interior, softly drawn lip line, no teeth and no protruding tongue. Mouth centered EXACTLY on existing mouth. Preserve same face/eyes/brows/hair/skin/clothes/hands/pose and exact 1024x1536 canvas, same crop and pixel alignment, same genuinely transparent alpha background. No other change. This is a local mouth-shape texture for realtime speech animation, not a new character.

## curious.png

Use case: precise-object-edit. Edit target: provided original transparent anime companion. Change ONLY facial expression of the same adult woman to subtle curiosity: one eyebrow slightly raised, other gently drawn inward, eyes a touch wider and attentive with exactly same iris color and eye placement, small gently parted neutral lips (very slight). Warm, cute, thoughtful question, not worried or exaggerated. Preserve exact same character identity, hair strands, skin shading outside face, shoulders, clothes, hands, pose, body and canvas 1024x1536, crop and pixel alignment, silhouette and genuine transparent background. No tears, no text, no symbols, no change to hairstyle or face position. Intended local face overlay for realtime animation; keep original face proportions.

## warm.png

Use case: precise-object-edit. Edit target: provided original transparent anime companion PNG. Change ONLY facial microexpression to a warm delighted smile: gently raised lower eyelids (eyes still OPEN with amber irises visible, NOT closed eye arcs), relaxed eyebrows, subtle rosy cheeks, a slightly wider CLOSED smiling mouth. Adult gentle Japanese anime woman, sweet but restrained, not exaggerated. Preserve exact identity and original head/face geometry, hair strands, pose, shoulder/clothing/hands pixels, canvas dimensions 1024x1536 and perfectly aligned crop; genuinely transparent background and same silhouette. No hearts, symbols, teeth, tears, added props or lettering. For animation face overlay so do not shift face features.
