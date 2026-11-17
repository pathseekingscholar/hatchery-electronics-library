"""One uniform 16:10 catalog image per record (public/catalog-thumbs/<draft_id>.jpg, 560x350).

    python -I scripts/inventory/catalog_thumbs.py

Order of preference for each record:
  1. its openly licensed representative photo (src/data/representative-images.json), center-cropped
  2. a close-up cut around its pin in the drawer photo (inventory/source/photo-pins.json)
  3. its drawer's public view, center-cropped
Crops stay inside each photo's privacy-safe crop box, blur areas are applied first, and EXIF is
stripped. Writes src/data/catalog-thumbs.json.
"""
import json
from pathlib import Path

from PIL import Image, ImageFilter, ImageOps

ROOT = Path(__file__).resolve().parents[2]
W, H = 560, 350
OUT = ROOT / "public" / "catalog-thumbs"
# Records students never see (hidden, or folded into another record) are not deployed; their
# images go to a git-ignored folder used only by the review contact sheets.
STAFF_OUT = ROOT / "inventory" / "photos" / "staff-thumbs"
for d in (OUT, STAFF_OUT):
    d.mkdir(parents=True, exist_ok=True)
for old in OUT.glob("*.jpg"):
    old.unlink()
pins_cfg = json.loads((ROOT / "inventory" / "source" / "photo-pins.json").read_text(encoding="utf-8"))
reps = json.loads((ROOT / "src" / "data" / "representative-images.json").read_text(encoding="utf-8"))
draft = json.loads((ROOT / "inventory" / "inventory-draft.json").read_text(encoding="utf-8"))
hier = json.loads((ROOT / "inventory" / "source" / "hierarchy.json").read_text(encoding="utf-8"))
parent = {l["id"]: l["parent"] for l in hier["locations"]}

photos = dict(pins_cfg["photos"])
for k, v in pins_cfg.get("thumb_only", {}).items():
    if not k.startswith("_"):
        photos[k] = v

loc_photo = {}
for name, c in pins_cfg["photos"].items():
    for loc in [c["location"], *c.get("also_locations", [])]:
        loc_photo[loc] = name
pin_of = {}
for name, c in photos.items():
    for did, xy in c["pins"].items():
        pin_of.setdefault(did, (name, xy))

_cache = {}
def source(name):
    """Upright analysis image with blur applied (and rotated if the config says so)."""
    if name not in _cache:
        c = photos[name]
        im = Image.open(ROOT / "inventory" / "photos" / "analysis" / f"{name}.jpg").convert("RGB")
        w, h = im.size
        for b in c.get("blur", []):
            box = tuple(int(v / 100 * (w if i % 2 == 0 else h)) for i, v in enumerate(b))
            im.paste(im.crop(box).filter(ImageFilter.GaussianBlur(40)), box)
        _cache[name] = im
    return _cache[name]

def fit(im):
    return ImageOps.fit(im, (W, H), Image.LANCZOS, centering=(0.5, 0.5))

def closeup(name, xy):
    c = photos[name]
    im = source(name)
    w, h = im.size
    l, t, r, b = [v / 100 for v in c["crop"]]
    cw = (r - l) * w
    bw = cw * c.get("size", 34) / 100
    bh = bw * H / W
    bw, bh = min(bw, (r - l) * w), min(bh, (b - t) * h)
    cx, cy = xy[0] / 100 * w, xy[1] / 100 * h
    x0 = min(max(cx - bw / 2, l * w), r * w - bw)
    y0 = min(max(cy - bh / 2, t * h), b * h - bh)
    crop = im.crop((int(x0), int(y0), int(x0 + bw), int(y0 + bh)))
    if c.get("rotate180"):
        crop = crop.rotate(180)
    return fit(crop)

def drawer_view(loc):
    while loc and loc not in loc_photo:
        loc = parent.get(loc)
    if not loc:
        return None
    return fit(Image.open(ROOT / "public" / "location-photos" / f"{loc_photo[loc]}.jpg").convert("RGB"))

manifest = {}
staff_only = {}
kinds = {"representative": 0, "closeup": 0, "drawer": 0, "none": 0}
for it in draft["items"]:
    did = it["draft_id"]
    if did in reps:
        img, kind = fit(Image.open(ROOT / "public" / reps[did]["file"]).convert("RGB")), "representative"
    elif did in pin_of:
        img, kind = closeup(*pin_of[did]), "closeup"
    else:
        img, kind = drawer_view(it["location"]["id"]), "drawer"
    if img is None:
        kinds["none"] += 1
        continue
    public = it["searchable"] and not it["duplicate_of"]
    img.save((OUT if public else STAFF_OUT) / f"{did}.jpg", "JPEG", quality=78, optimize=True)
    if public:
        manifest[did] = {"file": f"catalog-thumbs/{did}.jpg", "kind": kind}
    else:
        staff_only[did] = {"kind": kind}
    kinds[kind] += 1

(ROOT / "src" / "data" / "catalog-thumbs.json").write_text(json.dumps(manifest, indent=0), encoding="utf-8")
(STAFF_OUT / "index.json").write_text(json.dumps(staff_only), encoding="utf-8")
print(kinds, f"public={len(manifest)} staff_only={len(staff_only)} of {len(draft['items'])}")
