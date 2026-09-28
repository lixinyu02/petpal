# PetPal kitten animation source receipt

- Generated source: `exec-e9fe380e-587d-484e-8d06-d5fec0995d13.png` (1254 × 1254).
- Source method: OpenAI ImageGen. The parent task provided the generated source.
- Assigned source layout: 4 × 4 orange-and-cream kitten poses on an opaque magenta matte. Rows are wave, jump, cuddle, sleep; columns are four successive poses.
- Postprocessing: FFmpeg chroma key and magenta spill suppression, uniform atlas resize, cell extraction, endpoint holds, palette encoding, and 2 × 2 preview composition. No new poses or optical-flow interpolation.
- Reproduce from the project root: `node scripts/render-pet-animations.mjs`. The saved `source-sprites-magenta.png` is used by default after the first run.
- Override tool paths with `FFMPEG_PATH`, `FFPROBE_PATH`, and `PETPAL_FONT` when needed.

## Exact final ImageGen prompt

> Convert this exact cute kitten4x4 sprite atlas into a CLEAN CHROMA-KEY ANIMATION SOURCE image. Keep the same16 kitten poses and identity with green collar. Replace ALL background and ALL stray speckles outside each kitten silhouette with a perfectly uniform saturated magenta background RGB255,0,255 (#FF00FF), flat single color, absolutely no texture, no shadow, no lighting gradient, no flecks, no haze, no alpha transparency. Smooth fur edges but no white halos. Preserve cute plush kitten detailed artwork. Four equal columns and four equal rows, centered in each equal square cell with6% safe padding, every pose isolated from neighboring cells. The existing scattered white/yellow/red background noise MUST disappear completely into the uniform MAGENTA matte. Output one square flat magenta-backed animation atlas. No text/grid lines. Full-size clean animation production sheet.

See `render-receipt.json` for source/output SHA-256 values, every FFmpeg argument, frame sequences, probes, and alpha/color checks.
