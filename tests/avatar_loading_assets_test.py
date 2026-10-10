"""Developer pixel-audit tests; run with Python/Pillow, outside the app runtime."""
import importlib.util
import json
from pathlib import Path
import shutil
import sys
import tempfile
import unittest

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location("avatar_loading", ROOT / "scripts/optimize-avatar-loading.py")
assets = importlib.util.module_from_spec(spec)
spec.loader.exec_module(assets)


class PixelAuditTests(unittest.TestCase):
    def fixture(self):
        temporary = tempfile.TemporaryDirectory(prefix="pixel-fixture-", dir=ROOT / "evidence/performance-next-20261010")
        self.addCleanup(temporary.cleanup)
        root = Path(temporary.name)
        manifest = json.loads((ROOT / assets.MODEL / "akari.model3.json").read_text(encoding="utf-8"))
        texture = json.loads((ROOT / assets.TEXTURE_RECEIPT).read_text(encoding="utf-8"))
        preview = json.loads((ROOT / assets.PREVIEW_RECEIPT).read_text(encoding="utf-8"))
        files = [assets.SOURCE_TEXTURE, assets.SOURCE_PREVIEW, assets.TEXTURE_RECEIPT, assets.PREVIEW_RECEIPT,
                 f"{assets.MODEL}/akari.model3.json", texture["published"], preview["published"],
                 *(f"{assets.MODEL}/{name}" for name in assets.native_assets(ROOT, manifest))]
        for relative in files:
            target = root / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(ROOT / relative, target)
        return root, manifest, texture, preview

    def test_actual_assets_decode_to_all_original_rgba_and_resized_alpha(self):
        texture, preview = assets.check()
        self.assertTrue(texture["rgbaEqual"])
        self.assertTrue(preview["alphaEqual"])

    def test_hidden_transparent_rgb_change_is_rejected(self):
        root, manifest, texture, _ = self.fixture()
        source = root / assets.SOURCE_TEXTURE
        with source.open("rb") as stream, Image.open(stream) as original:
            image = original.copy()
        pixels = list(image.getdata())
        index = next(i for i, pixel in enumerate(pixels) if pixel[3] == 0)
        red, green, blue, alpha = pixels[index]
        pixels[index] = ((red + 1) % 256, green, blue, alpha)
        image.putdata(pixels)
        image.save(source, format="PNG")
        with self.assertRaisesRegex(ValueError, "including transparent RGB"):
            assets.audit_texture(root, root / texture["published"], texture["published"], manifest)

    def test_preview_alpha_change_is_rejected(self):
        root, _, _, preview = self.fixture()
        encoded = root / preview["published"]
        with encoded.open("rb") as stream, Image.open(stream) as original:
            image = original.copy()
        red, green, blue, alpha = image.getpixel((192, 240))
        image.putpixel((192, 240), (red, green, blue, (alpha + 1) % 256))
        image.save(encoded, format="WEBP", lossless=True)
        with self.assertRaisesRegex(ValueError, "preview alpha differs"):
            assets.audit_preview(root, encoded, preview["published"])

    def test_content_addressed_filename_detects_changed_transport_bytes(self):
        root, _, texture, _ = self.fixture()
        encoded = root / texture["published"]
        encoded.write_bytes(encoded.read_bytes() + b"changed")
        with self.assertRaisesRegex(ValueError, "filename does not match"):
            assets.check(root)

    def test_unrelated_manifest_change_is_rejected(self):
        root, manifest, _, _ = self.fixture()
        manifest["Groups"][0]["Ids"].reverse()
        (root / assets.MODEL / "akari.model3.json").write_text(assets.json_text(manifest), encoding="utf-8")
        with self.assertRaisesRegex(ValueError, "transport receipt differs"):
            assets.check(root)

    def test_native_motion_change_is_rejected(self):
        root, _, _, _ = self.fixture()
        motion = root / assets.MODEL / "akari.idle.motion3.json"
        motion.write_bytes(motion.read_bytes() + b"\n")
        with self.assertRaisesRegex(ValueError, "transport receipt differs"):
            assets.check(root)

    def test_receipt_cannot_supply_a_nonlocal_preview(self):
        root, _, _, preview = self.fixture()
        preview["published"] = "../../external.webp"
        (root / assets.PREVIEW_RECEIPT).write_text(assets.json_text(preview), encoding="utf-8")
        with self.assertRaisesRegex(ValueError, "preview reference is invalid"):
            assets.check(root)


if __name__ == "__main__":
    (ROOT / "evidence/performance-next-20261010").mkdir(parents=True, exist_ok=True)
    unittest.main()
