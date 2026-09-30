"""Rebuild and audit lossless Akari textures; requires Pillow and the cwebp CLI.

The application does not need either tool. --check reads the committed assets
and manifest without encoding or modifying files; cwebp is only needed to rebuild.
"""
import argparse
from hashlib import sha256
import json
import os
from pathlib import Path
import subprocess
import tempfile

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
ORIGINALS = ROOT / "artwork" / "akari"
PUBLISHED = ROOT / "public" / "avatars" / "akari"
NAMES = ("idle", "blink", "talk", "round", "curious", "warm", "sad", "pout")
OPTIONS = ("-lossless", "-exact", "-m", "6")


def digest(file):
    return sha256(file.read_bytes()).hexdigest()


def audit(name, encoded):
    source = ORIGINALS / f"{name}.png"
    with Image.open(source) as original, Image.open(encoded) as published:
        if original.mode != "RGBA" or published.mode != "RGBA":
            raise ValueError(f"{name}: RGBA format must be retained")
        if original.size != (1024, 1536) or original.size != published.size:
            raise ValueError(f"{name}: original texture dimensions must be retained")
        rgba = original.tobytes()
        if rgba != published.tobytes():
            raise ValueError(f"{name}: decoded RGBA differs, including transparent pixels")
        return {
            "name": name, "width": original.width, "height": original.height,
            "originalBytes": source.stat().st_size, "publishedBytes": encoded.stat().st_size,
            "originalSha256": digest(source), "publishedSha256": digest(encoded),
            "decodedRgbaSha256": sha256(rgba).hexdigest(), "rgbaEqual": True,
        }


def receipt(entries):
    return {
        "schemaVersion": 1, "format": "webp-lossless", "encoderOptions": list(OPTIONS),
        "entries": entries,
        "originalTotalBytes": sum(entry["originalBytes"] for entry in entries),
        "publishedTotalBytes": sum(entry["publishedBytes"] for entry in entries),
        "decodedRgbaTotalBytes": sum(entry["width"] * entry["height"] * 4 for entry in entries),
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="verify existing textures and manifest without writes")
    parser.add_argument("--cwebp", default="cwebp", help="path to an existing cwebp binary for a rebuild")
    args = parser.parse_args()
    manifest = PUBLISHED / "manifest.json"
    if args.check:
        current = receipt([audit(name, PUBLISHED / f"{name}.webp") for name in NAMES])
        recorded = json.loads(manifest.read_text(encoding="utf-8"))
        if current != recorded:
            raise ValueError("Avatar manifest does not match the original and published assets")
    else:
        PUBLISHED.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(prefix=".avatar-webp-", dir=PUBLISHED) as temporary:
            stage = Path(temporary)
            entries = []
            for name in NAMES:
                encoded = stage / f"{name}.webp"
                subprocess.run([args.cwebp, "-quiet", *OPTIONS, str(ORIGINALS / f"{name}.png"), "-o", str(encoded)], check=True)
                entries.append(audit(name, encoded))
            current = receipt(entries)
            # Publish only after every texture has passed a full RGBA comparison.
            (stage / "manifest.json").write_text(json.dumps(current, indent=2) + "\n", encoding="utf-8")
            for name in NAMES:
                os.replace(stage / f"{name}.webp", PUBLISHED / f"{name}.webp")
            os.replace(stage / "manifest.json", manifest)
    print(json.dumps({"ok": True, "textures": len(current["entries"]),
                      "originalBytes": current["originalTotalBytes"], "publishedBytes": current["publishedTotalBytes"],
                      "rgbaEqual": True, "mode": "check" if args.check else "rebuild"}))


if __name__ == "__main__":
    main()
