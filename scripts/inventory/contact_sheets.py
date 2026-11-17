"""Contact sheets of every catalog image, grouped by zone, for human review.

    python -I scripts/inventory/contact_sheets.py

Writes inventory/review-sheets/<zone>.jpg (git-ignored is not needed: these only contain the
published, already privacy-cropped images). Each tile shows draft id, image source and name.
Tag colors: green = licensed web photo, blue = close-up from our photo, orange = drawer view
(location reference, not a product photo), gray border = hidden from the public catalog.
"""
import json
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[2]
draft = json.loads((ROOT / "inventory" / "inventory-draft.json").read_text(encoding="utf-8"))
thumbs = json.loads((ROOT / "src" / "data" / "catalog-thumbs.json").read_text(encoding="utf-8"))
for did, v in json.loads((ROOT / "inventory" / "photos" / "staff-thumbs" / "index.json").read_text(encoding="utf-8")).items():
    thumbs[did] = {"file": f"../inventory/photos/staff-thumbs/{did}.jpg", "kind": v["kind"], "staff_only": True}
locs = {l["id"]: l for l in draft["locations"]}
OUT = ROOT / "inventory" / "review-sheets"
OUT.mkdir(exist_ok=True)

ZONES = [("ss", "Soldering Station"), ("z1", "Zone I"), ("z2", "Zone II"), ("z3", "Zone III"), ("z4", "Zone IV")]
TAG = {"representative": ((40, 130, 70), "WEB PHOTO"), "closeup": ((40, 90, 170), "CLOSE-UP"), "drawer": ((200, 110, 20), "DRAWER VIEW")}
TW, TH, PAD, COLS = 280, 175, 8, 6
f = ImageFont.truetype("arial.ttf", 14)
fb = ImageFont.truetype("arialbd.ttf", 13)
ft = ImageFont.truetype("arialbd.ttf", 30)

def wrap(text, width):
    words, lines, cur = text.split(), [], ""
    for w in words:
        if f.getlength(cur + " " + w) > width:
            lines.append(cur)
            cur = w
        else:
            cur = (cur + " " + w).strip()
    lines.append(cur)
    return lines[:2]

summary = {}
for zid, zname in ZONES:
    items = [i for i in draft["items"] if i["location"]["zone"] == zid]
    rows = (len(items) + COLS - 1) // COLS
    cell_h = TH + 70
    sheet = Image.new("RGB", (COLS * (TW + PAD) + PAD, 60 + rows * (cell_h + PAD)), "white")
    d = ImageDraw.Draw(sheet)
    d.text((PAD, 12), f"{zname} — {len(items)} records", fill="black", font=ft)
    counts = {}
    for n, it in enumerate(items):
        t = thumbs[it["draft_id"]]
        counts[t["kind"]] = counts.get(t["kind"], 0) + 1
        x = PAD + (n % COLS) * (TW + PAD)
        y = 60 + (n // COLS) * (cell_h + PAD)
        im = Image.open(ROOT / "public" / t["file"]).convert("RGB").resize((TW, TH))
        sheet.paste(im, (x, y))
        color, label = TAG[t["kind"]]
        d.rectangle([x, y, x + f.getlength(label) + 12, y + 20], fill=color)
        d.text((x + 6, y + 3), label, fill="white", font=fb)
        if t.get("staff_only"):
            d.rectangle([x, y, x + TW - 1, y + TH - 1], outline=(120, 120, 120), width=6)
            d.text((x + TW - 150, y + 3), "NOT DEPLOYED", fill="white", font=fb, stroke_width=2, stroke_fill="black")
        if it["duplicate_of"]:
            d.text((x + TW - 110, y + TH - 18), f"→ {it['duplicate_of']}", fill="white", font=fb, stroke_width=2, stroke_fill="black")
        d.text((x, y + TH + 3), f"{it['draft_id']}  ·  {it['location']['code']}", fill=(110, 30, 20), font=fb)
        for k, line in enumerate(wrap(it["name"], TW)):
            d.text((x, y + TH + 21 + k * 17), line, fill="black", font=f)
    sheet.save(OUT / f"{zid}-{zname.replace(' ', '-').lower()}.jpg", quality=80)
    summary[zname] = (len(items), counts)
for k, v in summary.items():
    print(k, v)
