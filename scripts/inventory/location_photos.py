"""Make the public drawer views + pin data from inventory/source/photo-pins.json.

    python -I scripts/inventory/location_photos.py

Writes public/location-photos/<IMG>.jpg (cropped, blurred where listed, max 1400 px, metadata
stripped) and src/data/location-photos.json. The original photos are never copied: only these
cropped views are published.
"""
import json
from pathlib import Path

from PIL import Image, ImageFilter

ROOT = Path(__file__).resolve().parents[2]
SRC = ROOT / "inventory" / "photos" / "analysis"
OUT = ROOT / "public" / "location-photos"
cfg = json.loads((ROOT / "inventory" / "source" / "photo-pins.json").read_text(encoding="utf-8"))["photos"]
hier = json.loads((ROOT / "inventory" / "source" / "hierarchy.json").read_text(encoding="utf-8"))
code = {l["id"]: l["code"] for l in hier["locations"]}
OUT.mkdir(parents=True, exist_ok=True)

data = {"photos": {}, "locations": {}, "pins": {}}
for name, c in cfg.items():
    im = Image.open(SRC / f"{name}.jpg").convert("RGB")
    W, H = im.size
    for b in c.get("blur", []):
        box = tuple(int(v / 100 * (W if i % 2 == 0 else H)) for i, v in enumerate(b))
        im.paste(im.crop(box).filter(ImageFilter.GaussianBlur(40)), box)
    l, t, r, btm = c["crop"]
    im = im.crop((int(l / 100 * W), int(t / 100 * H), int(r / 100 * W), int(btm / 100 * H)))
    if c.get("rotate180"):
        im = im.rotate(180)
    im.thumbnail((1400, 1400), Image.LANCZOS)
    im.save(OUT / f"{name}.jpg", "JPEG", quality=80, optimize=True)  # no exif -> metadata stripped
    data["photos"][name] = {"file": f"location-photos/{name}.jpg", "width": im.width, "height": im.height}
    for loc in [c["location"], *c.get("also_locations", [])]:
        data["locations"][code[loc]] = name
    for draft_id, (x, y) in c["pins"].items():
        px = (x - l) / (r - l)
        py = (y - t) / (btm - t)
        if c.get("rotate180"):
            px, py = 1 - px, 1 - py
        assert 0 <= px <= 1 and 0 <= py <= 1, (name, draft_id)
        data["pins"][draft_id] = {"photo": name, "x": round(px, 4), "y": round(py, 4)}
    print(name, im.size)

(ROOT / "src" / "data" / "location-photos.json").write_text(json.dumps(data, indent=1), encoding="utf-8")
print(f"{len(data['photos'])} photos, {len(data['locations'])} locations, {len(data['pins'])} pins")
