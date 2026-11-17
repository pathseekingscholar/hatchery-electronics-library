"""Crop a region of a full-resolution workspace photo for close inspection.

    python -I scripts/inventory/crop.py IMG_1024 0.15 0.05 0.85 0.40 [out_name] [max_side]

Box is fractional (left top right bottom, 0-1) of the upright photo. Reads
inventory/photos/analysis/<name>.jpg and writes inventory/photos/crops/<out_name>.jpg.
Cropping never adds detail: if text is unreadable in the crop, it is unreadable.
"""
import sys
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[2] / "inventory" / "photos"


def main() -> None:
    name, l, t, r, b = sys.argv[1], *map(float, sys.argv[2:6])
    out = sys.argv[6] if len(sys.argv) > 6 else f"{name}_{int(l*100)}_{int(t*100)}_{int(r*100)}_{int(b*100)}"
    max_side = int(sys.argv[7]) if len(sys.argv) > 7 else 1800
    img = Image.open(ROOT / "analysis" / f"{name}.jpg")
    w, h = img.size
    crop = img.crop((int(l * w), int(t * h), int(r * w), int(b * h)))
    crop.thumbnail((max_side, max_side), Image.LANCZOS)
    (ROOT / "crops").mkdir(exist_ok=True)
    path = ROOT / "crops" / f"{out}.jpg"
    crop.save(path, quality=88)
    print(path, crop.size)


if __name__ == "__main__":
    main()
