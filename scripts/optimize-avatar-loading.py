"""Build and audit Akari's loading-only preview and exact Cubism transport texture.

Development requires Pillow; rebuilding also requires an existing official cwebp
CLI. The app needs neither tool. --check only reads committed assets and compares
the complete main texture RGBA, including RGB stored in fully transparent pixels.
"""
import argparse
from copy import deepcopy
from hashlib import sha256
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
MODEL = "public/avatars/akari-cubism-v12"
SOURCE_TEXTURE = "public/avatars/akari-cubism-v11/akari.2048/texture_00.png"
SOURCE_PREVIEW = "artwork/akari/idle.png"
TEXTURE_RECEIPT = f"{MODEL}/texture-transport.json"
PREVIEW_RECEIPT = "public/avatars/akari/loading-preview.json"
TEXTURE_OPTIONS = ("-lossless", "-exact", "-m", "6")
PREVIEW_OPTIONS = ("-q", "85", "-alpha_q", "100", "-exact", "-m", "6")
PREVIEW_SIZE = (384, 576)
PREVIEW_BUDGET = 120_000


def digest(file):
    return sha256(file.read_bytes()).hexdigest()


def json_text(value):
    return json.dumps(value, ensure_ascii=False, indent=2) + "\n"


def local_path(root, relative):
    if not isinstance(relative, str) or not relative or "\\" in relative:
        raise ValueError("Asset reference must be a local relative path")
    value = Path(relative)
    if value.is_absolute() or ".." in value.parts or ":" in relative:
        raise ValueError("Asset reference must be a local relative path")
    target = (root / value).resolve()
    if not target.is_relative_to(root.resolve()):
        raise ValueError("Asset reference escapes the project")
    return target


def manifest_without_textures(manifest):
    retained = deepcopy(manifest)
    del retained["FileReferences"]["Textures"]
    return sha256(json.dumps(retained, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def native_assets(root, manifest):
    refs = manifest["FileReferences"]
    files = [refs[key] for key in ("Moc", "Physics", "DisplayInfo")]
    files += [motion["File"] for entries in refs["Motions"].values() for motion in entries]
    return {name: digest(local_path(root / MODEL, name)) for name in sorted(set(files))}


def load_rgba(file, expected_size, expected_format=None):
    with file.open("rb") as stream, Image.open(stream) as image:
        if image.mode != "RGBA" or image.size != expected_size:
            raise ValueError(f"{file.name}: RGBA format and {expected_size} dimensions are required")
        if expected_format and image.format != expected_format:
            raise ValueError(f"{file.name}: expected {expected_format} encoding")
        return image.tobytes()


def check_filename(file, expected_prefix):
    if not re.fullmatch(re.escape(expected_prefix) + r"-[a-f0-9]{12}\.webp", file.name):
        raise ValueError("Content addressed WebP filename is invalid")
    if file.name != f"{expected_prefix}-{digest(file)[:12]}.webp":
        raise ValueError("Content addressed WebP filename does not match its bytes")


def audit_texture(root, encoded, relative, manifest):
    source = local_path(root, SOURCE_TEXTURE)
    original = load_rgba(source, (2048, 2048), "PNG")
    published = load_rgba(encoded, (2048, 2048), "WEBP")
    if original != published:
        raise ValueError("Main texture decoded RGBA differs, including transparent RGB")
    return {
        "schemaVersion": 1, "format": "webp-lossless-exact",
        "encoderOptions": list(TEXTURE_OPTIONS), "source": SOURCE_TEXTURE,
        "published": relative, "width": 2048, "height": 2048,
        "originalBytes": source.stat().st_size, "publishedBytes": encoded.stat().st_size,
        "sourceSha256": digest(source), "publishedSha256": digest(encoded),
        "decodedRgbaSha256": sha256(original).hexdigest(), "rgbaEqual": True,
        "modelWithoutTexturesSha256": manifest_without_textures(manifest),
        "nativeAssetsSha256": native_assets(root, manifest),
    }


def resized_preview(root):
    with local_path(root, SOURCE_PREVIEW).open("rb") as stream, Image.open(stream) as source:
        if source.mode != "RGBA" or source.size != (1024, 1536):
            raise ValueError("Loading preview source must be the original 1024x1536 RGBA idle image")
        return source.resize(PREVIEW_SIZE, Image.Resampling.LANCZOS)


def audit_preview(root, encoded, relative):
    source = local_path(root, SOURCE_PREVIEW)
    expected = resized_preview(root)
    published = load_rgba(encoded, PREVIEW_SIZE, "WEBP")
    expected_alpha, published_alpha = expected.tobytes()[3::4], published[3::4]
    if expected_alpha != published_alpha:
        raise ValueError("Loading preview alpha differs from the resized source")
    if encoded.stat().st_size >= PREVIEW_BUDGET:
        raise ValueError("Loading preview exceeds its 120 KB transport budget")
    return {
        "schemaVersion": 1, "format": "webp-lossy-rgb-lossless-alpha",
        "encoderOptions": list(PREVIEW_OPTIONS), "resizeFilter": "Pillow-LANCZOS",
        "source": SOURCE_PREVIEW, "published": relative,
        "width": PREVIEW_SIZE[0], "height": PREVIEW_SIZE[1],
        "originalBytes": source.stat().st_size, "publishedBytes": encoded.stat().st_size,
        "sourceSha256": digest(source), "publishedSha256": digest(encoded),
        "decodedRgbaSha256": sha256(published).hexdigest(),
        "resizedSourceAlphaSha256": sha256(expected_alpha).hexdigest(),
        "decodedAlphaSha256": sha256(published_alpha).hexdigest(), "alphaEqual": True,
        "maximumPublishedBytesExclusive": PREVIEW_BUDGET,
    }


def check(root=ROOT):
    manifest = json.loads((root / MODEL / "akari.model3.json").read_text(encoding="utf-8"))
    recorded_texture = json.loads((root / TEXTURE_RECEIPT).read_text(encoding="utf-8"))
    textures = manifest["FileReferences"]["Textures"]
    if len(textures) != 1 or not re.fullmatch(r"akari\.2048/texture_00-[a-f0-9]{12}\.webp", textures[0]):
        raise ValueError("Cubism manifest must reference the single content addressed texture")
    relative = f"{MODEL}/{textures[0]}"
    encoded = local_path(root, relative)
    check_filename(encoded, "texture_00")
    texture = audit_texture(root, encoded, relative, manifest)
    if texture != recorded_texture:
        raise ValueError("Main texture transport receipt differs from actual assets")
    recorded_preview = json.loads((root / PREVIEW_RECEIPT).read_text(encoding="utf-8"))
    relative = recorded_preview["published"]
    if not re.fullmatch(r"public/avatars/akari/preview-[a-f0-9]{12}\.webp", relative):
        raise ValueError("Loading preview reference is invalid")
    encoded = local_path(root, relative)
    check_filename(encoded, "preview")
    preview = audit_preview(root, encoded, relative)
    if preview != recorded_preview:
        raise ValueError("Loading preview receipt differs from actual assets")
    return texture, preview


def rebuild(cwebp, root=ROOT):
    model_file = root / MODEL / "akari.model3.json"
    manifest = json.loads(model_file.read_text(encoding="utf-8"))
    legacy = root / MODEL / "akari.2048/texture_00.png"
    # Only remove the exact duplicated V12 source after the retained V11 bytes match.
    if legacy.exists() and legacy.read_bytes() != (root / SOURCE_TEXTURE).read_bytes():
        raise ValueError("V12 source PNG differs from retained V11 source; do not remove it")
    evidence = root / "evidence/performance-next-20261010"
    evidence.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="asset-stage-", dir=evidence) as temporary:
        stage = Path(temporary)
        texture_file, preview_file = stage / "texture.webp", stage / "loading.webp"
        subprocess.run([cwebp, "-quiet", *TEXTURE_OPTIONS, str(root / SOURCE_TEXTURE), "-o", str(texture_file)], check=True)
        texture_relative = f"{MODEL}/akari.2048/texture_00-{digest(texture_file)[:12]}.webp"
        texture = audit_texture(root, texture_file, texture_relative, manifest)
        resized_preview(root).save(stage / "preview.png", format="PNG")
        subprocess.run([cwebp, "-quiet", *PREVIEW_OPTIONS, str(stage / "preview.png"), "-o", str(preview_file)], check=True)
        preview_relative = f"public/avatars/akari/preview-{digest(preview_file)[:12]}.webp"
        preview = audit_preview(root, preview_file, preview_relative)
        updated = deepcopy(manifest)
        updated["FileReferences"]["Textures"] = [texture_relative.removeprefix(f"{MODEL}/")]
        if manifest_without_textures(updated) != texture["modelWithoutTexturesSha256"]:
            raise ValueError("Unexpected native model manifest change")
        for name, data in (("texture-transport.json", texture), ("loading-preview.json", preview), ("akari.model3.json", updated)):
            (stage / name).write_text(json_text(data), encoding="utf-8")
        # Publish only after both outputs pass their full pixel audit. Replace the
        # model manifest last so it never references an unpublished texture.
        os.replace(texture_file, root / texture_relative)
        os.replace(preview_file, root / preview_relative)
        os.replace(stage / "texture-transport.json", root / TEXTURE_RECEIPT)
        os.replace(stage / "loading-preview.json", root / PREVIEW_RECEIPT)
        os.replace(stage / "akari.model3.json", model_file)
        if legacy.exists():
            legacy.unlink()
    return check(root)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="verify existing assets without writing or encoding")
    parser.add_argument("--cwebp", default="cwebp", help="existing official cwebp binary for rebuilding")
    args = parser.parse_args()
    texture, preview = check() if args.check else rebuild(args.cwebp)
    print(json.dumps({"ok": True, "mode": "check" if args.check else "rebuild", "texture": texture, "preview": preview}))


if __name__ == "__main__":
    main()
