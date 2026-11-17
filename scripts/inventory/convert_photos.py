"""Convert the original workspace photos (HEIC) into derived images.

    python -I scripts/inventory/convert_photos.py

Reads   inventory/photos/original/*.HEIC        (untouched evidence, git-ignored)
Writes  inventory/photos/analysis/<name>.jpg   full resolution, upright (git-ignored, for close inspection)
        inventory/photos/web/<name>.jpg        max 2000 px, metadata stripped (used by the review UI)
        inventory/photos/thumb/<name>.jpg      max 480 px, metadata stripped
        inventory/photos/photo-basics.json     dimensions, capture time, file sizes
"""
import json
import sys
from pathlib import Path

from PIL import Image, ImageOps
import pillow_heif

pillow_heif.register_heif_opener()

ROOT = Path(__file__).resolve().parents[2] / "inventory" / "photos"
ORIGINAL = ROOT / "original"
OUT = {"analysis": (ROOT / "analysis", None, 92), "web": (ROOT / "web", 2000, 84), "thumb": (ROOT / "thumb", 480, 80)}


def main() -> int:
    sources = sorted(p for p in ORIGINAL.iterdir() if p.suffix.lower() in {".heic", ".heif", ".jpg", ".jpeg", ".png"})
    if not sources:
        print(f"No photos in {ORIGINAL}")
        return 1
    for folder, _, _ in OUT.values():
        folder.mkdir(parents=True, exist_ok=True)

    basics = []
    for src in sources:
        with Image.open(src) as im:
            exif = im.getexif()
            taken = exif.get(36867) or exif.get(306)  # DateTimeOriginal / DateTime
            if not taken:
                try:
                    taken = exif.get_ifd(0x8769).get(36867)
                except Exception:
                    taken = None
            upright = ImageOps.exif_transpose(im).convert("RGB")
        name = src.stem + ".jpg"
        for key, (folder, max_side, quality) in OUT.items():
            img = upright
            if max_side and max(img.size) > max_side:
                img = img.copy()
                img.thumbnail((max_side, max_side), Image.LANCZOS)
            img.save(folder / name, "JPEG", quality=quality, optimize=True)  # no exif= -> metadata stripped
        basics.append({
            "file": src.name,
            "derived": name,
            "width": upright.width,
            "height": upright.height,
            "orientation": "portrait" if upright.height > upright.width else "landscape",
            "taken_at": str(taken) if taken else None,
            "original_bytes": src.stat().st_size,
        })
        print(f"{src.name}: {upright.width}x{upright.height} {taken or ''}")

    (ROOT / "photo-basics.json").write_text(json.dumps(basics, indent=2), encoding="utf-8")
    print(f"Converted {len(basics)} photos")
    return 0


if __name__ == "__main__":
    sys.exit(main())
