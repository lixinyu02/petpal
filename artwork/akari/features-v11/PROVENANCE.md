# Akari V11 continuous facial features

The neutral portrait remains `artwork/akari/idle.png`. The generated clean underpaint
was produced with the built-in image-generation tool from that portrait in the
current task. Its original tool output was
`exec-0549ed16-b5c0-4ae3-ba66-e5d3c6367685.png` (1024 × 1536).
Only bounded eyebrow and eye regions are copied from the underpaint; no generated
hair, face contour, nose, mouth, clothes, or body pixels replace the reference.
The full generation prompt is preserved in [generation-prompt.md](generation-prompt.md).

`scripts/authoring/pack-akari-continuous-features.mjs` mechanically separates the
original brows, irises, and upper/lower eyelashes using polygon masks and inverse
source-over alpha recovery. Existing, previously generated independent eye-white
art fills the space behind the iris. It does not paint new facial features.

The generated transparent PNGs in this directory are the exact PSD layer data.
Character right is screen left. `outputs/avatars/akari-cubism-v11/pack-receipt.json`
records source hashes, actual layer bounds, pixel hashes, and the PSD hash. All 16
layers pass exact PSD pixel/position/visibility readback. The compositor applies
the same eye-white alpha mask to the iris as the native MOC. The eyelash residual
is recovered after this clipping, so upper/lower edge ink cannot accidentally be
owned only by an iris pixel removed at runtime. At neutral the visible RGB
difference from the original portrait is at most 1/255, caused by integer alpha
compositing. All pixels outside the feature masks remain unchanged within the
same rounding tolerance. This does not claim GPU mask filtering is identical to
the reference-resolution pixel simulation.

This is artwork and PSD packaging evidence. Actual MOC clipping, continuous
deformation, browser rendering, and official Editor round-trip are separate checks.
