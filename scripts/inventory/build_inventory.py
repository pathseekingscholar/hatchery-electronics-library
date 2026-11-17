"""Build the human-reviewable inventory deliverables from the hand-written source files.

    python -I scripts/inventory/build_inventory.py

Sources (edit these):  inventory/source/hierarchy.json, inventory/source/items-*.json
Outputs (generated):   inventory/workspace-hierarchy.json, photo-manifest.json, inventory-draft.json,
                       inventory-review.csv, storage-opportunities.json, inventory-analysis.md

Validation fails loudly if an item points at an unknown location or photo, ids repeat, or a photo
in inventory/photos/web is not accounted for in the manifest.
"""
import csv
import json
import sys
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2] / "inventory"
SRC = ROOT / "source"
SNAPSHOT = "2026-11-16"

CATEGORIES = {
    "Resistors", "Capacitors", "Diodes", "LEDs & Lighting", "Transistors", "ICs", "Microcontrollers", "Sensors",
    "Motors & Drivers", "Power", "Switches & Buttons", "Connectors", "Displays", "Audio", "Wireless",
    "Cables & Wire", "Tools & Misc",
}
TYPES = {"component", "module", "assortment", "kit", "tool", "consumable", "equipment", "container"}


def fail(msg: str) -> None:
    print(f"ERROR: {msg}")
    sys.exit(1)


def main() -> None:
    h = json.loads((SRC / "hierarchy.json").read_text(encoding="utf-8"))
    locs = {l["id"]: l for l in h["locations"]}
    if len(locs) != len(h["locations"]):
        fail("duplicate location ids")
    codes = Counter(l["code"] for l in h["locations"])
    if any(n > 1 for n in codes.values()):
        fail(f"duplicate location codes: {[c for c, n in codes.items() if n > 1]}")
    for l in h["locations"]:
        if l["parent"] and l["parent"] not in locs:
            fail(f"{l['id']}: unknown parent {l['parent']}")

    basics = {}
    basics_file = ROOT / "photos" / "photo-basics.json"
    if basics_file.exists():
        basics = {Path(b["file"]).stem: b for b in json.loads(basics_file.read_text(encoding="utf-8"))}
    manifest_files = {p["file"] for p in h["photos"]}
    on_disk = {p.stem for p in (ROOT / "photos" / "web").glob("*.jpg")} if (ROOT / "photos" / "web").exists() else set()
    missing = on_disk - manifest_files
    if missing:
        fail(f"photos not in manifest: {sorted(missing)}")

    def path(lid: str) -> list:
        out = []
        cur = locs.get(lid)
        while cur:
            out.insert(0, cur)
            cur = locs.get(cur["parent"]) if cur["parent"] else None
        return out

    def zone_of(lid: str) -> str:
        p = path(lid)
        return p[1]["id"] if len(p) > 1 else p[0]["id"]

    # ---- items
    items = []
    for f in sorted(SRC.glob("items-*.json")):
        items += json.loads(f.read_text(encoding="utf-8"))["items"]
    ids = Counter(i["id"] for i in items)
    if any(n > 1 for n in ids.values()):
        fail(f"duplicate item ids: {[k for k, n in ids.items() if n > 1]}")

    draft = []
    for it in items:
        if it["location"] not in locs:
            fail(f"{it['id']}: unknown location {it['location']}")
        if it["category"] not in CATEGORIES:
            fail(f"{it['id']}: unknown category {it['category']}")
        if it["type"] not in TYPES:
            fail(f"{it['id']}: unknown type {it['type']}")
        for p in it["photos"]:
            if p not in manifest_files:
                fail(f"{it['id']}: unknown photo {p}")
        lp = path(it["location"])
        visible = it.get("qty_visible")
        # ---- catalog state (see inventory/README.md). Nothing is ever 'staff_verified' here.
        reasons = []
        if it["confidence"] == "low":
            reasons.append("Low-confidence identification from the photo")
        loc_conf = next((l.get("confidence", "high") for l in lp[::-1] if l.get("confidence")), "high")
        if loc_conf != "high":
            reasons.append("Which drawer this photo shows is uncertain")
        hidden = it.get("catalog_hidden") or (
            "Unidentified container; contents not seen" if it["type"] == "container"
            else "Contents not identifiable from the photo" if it["confidence"] == "low" and it.get("contents_unknown")
            else None)
        if hidden:
            reasons.append(hidden)
        # Everything from the photos starts as Needs Review; only a person can mark it verified.
        # `review_reasons` lists the specific concerns (empty = no particular concern).
        catalog_status = "needs_review"
        draft.append({
            "draft_id": it["id"],
            "name": it["name"],
            "item_type": it["type"],
            "category": it["category"],
            "description": it.get("description", ""),
            "manufacturer": it.get("manufacturer"),
            "part_number": it.get("part_number"),
            "specifications": it.get("specifications", {}),
            "label_text": it.get("label_text"),
            "is_assortment": bool(it.get("is_assortment")),
            "contents_unknown": bool(it.get("contents_unknown")),
            "location": {
                "id": it["location"],
                "code": locs[it["location"]]["code"],
                "path": [l["name"] for l in lp],
                "zone": zone_of(it["location"]),
                "container": it.get("container"),
            },
            "quantity": {
                # Never a stock count: visible-in-photo only. Stock status stays 'unverified'.
                "value": None,
                "visible_in_photo": visible,
                "note": it.get("qty_note"),
                "status": "unverified",
            },
            "identification_confidence": it["confidence"],
            "verification_status": "pending",
            "catalog_status": catalog_status,
            "review_reasons": reasons,
            # False = kept out of student search/browse; still on the staff review screen.
            "searchable": not hidden,
            # Same product already proposed elsewhere: the importer adds this location to that record
            # instead of creating a second catalog entry.
            "duplicate_of": it.get("possible_duplicate_of"),
            "possible_duplicate_of": it.get("possible_duplicate_of"),
            "source_images": [f"{p}.HEIC" for p in it["photos"]],
            "snapshot": SNAPSHOT,
        })

    # Records that duplicate another one go last, so importers always see the record to merge into first.
    draft.sort(key=lambda d: bool(d["duplicate_of"]))
    known = {d["draft_id"] for d in draft}
    for d in draft:
        if d["duplicate_of"] and d["duplicate_of"] not in known:
            fail(f"{d['draft_id']}: duplicate_of unknown record {d['duplicate_of']}")

    # ---- hierarchy
    children = defaultdict(list)
    for l in h["locations"]:
        children[l["parent"]].append(l)
    item_count = Counter(d["location"]["id"] for d in draft)

    def subtree_count(lid: str) -> int:
        return item_count[lid] + sum(subtree_count(c["id"]) for c in children[lid])

    def node(l: dict) -> dict:
        kids = sorted(children[l["id"]], key=lambda c: (c.get("order", 99), c["code"]))
        return {
            "id": l["id"], "code": l["code"], "kind": l["kind"], "name": l["name"],
            "front_label": l.get("front_label"), "observed_state": l.get("state"),
            "identification_confidence": l.get("confidence", "high"),
            "source_images": [f"{p}.HEIC" for p in l.get("photos", [])],
            "notes": l.get("notes"),
            "proposed_items_here": item_count[l["id"]], "proposed_items_total": subtree_count(l["id"]),
            "children": [node(k) for k in kids],
        }

    roots = [node(l) for l in children[None]]
    flat = [{
        "id": l["id"], "parent_id": l["parent"], "code": l["code"], "kind": l["kind"], "name": l["name"],
        "order": l.get("order", 0), "front_label": l.get("front_label"), "observed_state": l.get("state"),
        "identification_confidence": l.get("confidence", "high"), "source_images": [f"{p}.HEIC" for p in l.get("photos", [])],
        "opportunities": [{"id": o["id"], "kind": o["kind"], "description": o["description"], "state": o["state"],
                           "needs_confirmation": o["needs_confirmation"], "source_images": [f"{p}.HEIC" for p in o["photos"]]}
                          for o in h["opportunities"] if o["location"] == l["id"]],
    } for l in h["locations"]]
    (ROOT / "workspace-hierarchy.json").write_text(json.dumps({"snapshot": SNAPSHOT, "tree": roots, "locations": flat}, indent=2, ensure_ascii=False), encoding="utf-8")

    # ---- photo manifest
    manifest = []
    for p in h["photos"]:
        b = basics.get(p["file"], {})
        manifest.append({
            "file": f"{p['file']}.HEIC", "web": f"photos/web/{p['file']}.jpg", "thumb": f"photos/thumb/{p['file']}.jpg",
            "width": b.get("width"), "height": b.get("height"), "taken_at": b.get("taken_at"),
            "primary_zone": p["zone"], "locations": p["locations"], "viewpoint": p["viewpoint"],
            "overlapping_photos": [f"{o}.HEIC" for o in p["overlaps"]], "quality_and_limits": p["quality"],
            "needs_confirmation": bool(p.get("needs_confirmation")),
            "proposed_items_citing": sum(1 for d in draft if f"{p['file']}.HEIC" in d["source_images"]),
        })
    (ROOT / "photo-manifest.json").write_text(json.dumps({"snapshot": SNAPSHOT, "photo_count": len(manifest), "photos": manifest}, indent=2, ensure_ascii=False), encoding="utf-8")

    # ---- draft + review csv
    (ROOT / "inventory-draft.json").write_text(json.dumps({
        "snapshot": SNAPSHOT,
        "notice": "DRAFT from photographs. Not verified. Do not publish without staff review. Quantities are what was visible in a photo, never total stock.",
        "locations": flat,
        "items": draft,
    }, indent=2, ensure_ascii=False), encoding="utf-8")

    # Public seed for builds without a database (GitHub Pages preview): same records, minus staff-only
    # evidence (photo file names, observed-state notes, storage notes).
    public_seed = {
        "snapshot": SNAPSHOT,
        "notice": "Photo inventory (public fields only).",
        "locations": [{k: v for k, v in l.items() if k in ("id", "parent_id", "code", "kind", "name", "order", "front_label", "identification_confidence")}
                      | {"source_images": [], "opportunities": [], "observed_state": None} for l in flat],
        # hidden records (unidentifiable containers etc.) are staff-only, so they are not in the public file
        "items": [{k: v for k, v in d.items() if k != "source_images"} | {"source_images": []} for d in draft if d["searchable"]],
    }
    seed_path = ROOT.parent / "src" / "data" / "photo-inventory.public.json"
    seed_path.parent.mkdir(exist_ok=True)
    seed_path.write_text(json.dumps(public_seed, ensure_ascii=False), encoding="utf-8")

    with (ROOT / "inventory-review.csv").open("w", newline="", encoding="utf-8-sig") as fh:
        w = csv.writer(fh)
        w.writerow(["draft_id", "zone", "location_code", "location_path", "container", "item_type", "category", "name",
                    "manufacturer", "part_number", "label_text", "visible_qty", "qty_note", "confidence",
                    "possible_duplicate_of", "source_images", "review_decision (confirm/correct/reject/merge)",
                    "corrected_name", "corrected_location_code", "counted_qty", "stock_status", "reviewer_notes"])
        for d in sorted(draft, key=lambda d: (d["location"]["code"], d["draft_id"])):
            w.writerow([d["draft_id"], locs[d["location"]["zone"]]["code"], d["location"]["code"], " > ".join(d["location"]["path"]),
                        d["location"]["container"] or "", d["item_type"], d["category"], d["name"], d["manufacturer"] or "",
                        d["part_number"] or "", d["label_text"] or "", d["quantity"]["visible_in_photo"] or "",
                        d["quantity"]["note"] or "", d["identification_confidence"], d["possible_duplicate_of"] or "",
                        "; ".join(d["source_images"]), "", "", "", "", "", ""])

    # ---- opportunities
    ops = []
    for o in h["opportunities"]:
        if o["location"] not in locs:
            fail(f"{o['id']}: unknown location {o['location']}")
        ops.append({**o, "location_code": locs[o["location"]]["code"], "location_path": [l["name"] for l in path(o["location"])],
                    "source_images": [f"{p}.HEIC" for p in o.pop("photos")]})
    (ROOT / "storage-opportunities.json").write_text(json.dumps({"snapshot": SNAPSHOT, "opportunities": ops}, indent=2, ensure_ascii=False), encoding="utf-8")

    # ---- analysis summary
    kinds = Counter(l["kind"] for l in h["locations"])
    conf = Counter(d["identification_confidence"] for d in draft)
    types = Counter(d["item_type"] for d in draft)
    by_zone = Counter(d["location"]["zone"] for d in draft)
    low = [d for d in draft if d["identification_confidence"] == "low"]
    unknown = [d for d in draft if d["contents_unknown"]]
    dups = [d for d in draft if d["possible_duplicate_of"]]
    drawers = [l for l in h["locations"] if l["kind"] == "Drawer"]
    status = Counter(d["catalog_status"] for d in draft)
    dup_n = sum(1 for d in draft if d["duplicate_of"])
    hidden_n = sum(1 for d in draft if not d["searchable"])
    lines = [
        "# Inventory analysis — photo snapshot " + SNAPSHOT, "",
        "Generated by `scripts/inventory/build_inventory.py` from `inventory/source/`. Everything here is a **draft**: nothing has been verified by staff and nothing is published.", "",
        "## Counts", "",
        f"- Photographs: **{len(manifest)}** (all accounted for in `photo-manifest.json`). IMG_1020, IMG_1021, IMG_1045 and IMG_1046 were not in the supplied zip.",
        f"- Locations identified: **{len(h['locations'])}** — " + ", ".join(f"{n} {k.lower()}{'s' if n > 1 else ''}" for k, n in kinds.most_common()) + ".",
        f"- Drawers: **{len(drawers)}** (Soldering Station 2, Zone I 3, Zone II 5, Zone III 4, Zone IV 5). Zone I has 3 drawers, not the 4 expected.",
        f"- Proposed item records: **{len(draft)}** — confidence high {conf['high']}, medium {conf['medium']}, low {conf['low']}. These are estimates; verified count is **0**.",
        "- By type: " + ", ".join(f"{k} {n}" for k, n in types.most_common()) + ".",
        "- By zone: " + ", ".join(f"{locs[k]['name']} {n}" for k, n in sorted(by_zone.items(), key=lambda kv: locs[kv[0]].get('order', 0))) + ".",
        f"- Records for closed/opaque containers whose contents were not seen: **{len(unknown)}**.",
        f"- Storage opportunities: **{len(ops)}** (see `storage-opportunities.json`).",
        f"- Catalog states on import: **Needs Review {status['needs_review']}** (of which {sum(1 for d in draft if d['review_reasons'])} carry a specific concern), Staff Verified 0. "
        f"{dup_n} records are folded into an earlier record as an extra location, so the import creates **{len(draft) - dup_n} unique catalog records**; "
        f"{hidden_n} of them are kept out of student search (unidentifiable containers/contents, exhibits) but stay on the review screen.", "",
        "## How to read the draft", "",
        "- Assortments (resistor bags, LED mixes, header bins) are one record each. Values are recorded only where a label states them.",
        "- `quantity.visible_in_photo` is what could be counted in a photo. It is never stored as stock; imported stock starts as **Unverified** with no count.",
        "- Labeled cases that were closed (e.g. Zone I Drawer 2) are recorded from their label with `contents_unknown: true`.",
        "- Items on the bench in IMG_1022 that were gone in the tidied IMG_1047 are treated as in-use, not stored, and were not recorded.", "",
        "## Needs human confirmation", "",
        "- **IMG_1039** — upside-down photo of a deep drawer with Weller stations, fume extractors and boxed magnifiers. Filed as Zone III Drawer 4 ('Soldering Irons | Magnifiers'); could be Zone IV Drawer 5 ('Soldering Irons').",
        "- **Zone IV Drawer 5** — never opened in any photo.",
        "- **Zone II Drawer 5** — nine organizer cases with unreadable labels and a closed bag labeled BATTERIES; contents of both not seen.",
        "- **Bin codes repeat** across drawers (e.g. `A2_j` in Zone I D1 and Zone II D1). Location codes in the app are therefore prefixed with the drawer (`Z1-D1-A2J`).",
        "- **Zone I Drawer 3** — one case has a person's name on tape (possibly personal property); the name is deliberately not recorded here.",
    ]
    if dups:
        lines += ["- **Same product in two places** (keep both locations or merge in review): " + "; ".join(f"`{d['draft_id']}` ↔ `{d['possible_duplicate_of']}`" for d in dups) + "."]
    lines += ["", f"### Low-confidence identifications ({len(low)})", ""]
    lines += [f"- `{d['draft_id']}` {d['name']} — {d['location']['code']} ({', '.join(d['source_images'])})" for d in low]
    lines += ["", "## Missing information", "",
              "- No quantities were counted; every stock entry needs a check.",
              "- Resistance/capacitance values are known only for bags with written labels (Zone II Drawer 1).",
              "- Model numbers are missing for most equipment (oscilloscopes, multimeters, power supplies).",
              "- Contents of closed cases in Zone I Drawers 2–3 and Zone II Drawer 5.",
              "", "## Next steps", "",
              "1. Load the draft on **Admin → Inventory review** (or review `inventory-review.csv` on paper).",
              "2. Walk each drawer: confirm, correct, reject or merge each proposal; add counts or a stock status; mark the drawer reviewed.",
              "3. Publish confirmed parts. Only verified parts can be published.", ""]
    (ROOT / "inventory-analysis.md").write_text("\n".join(lines), encoding="utf-8")

    print(f"locations={len(h['locations'])} photos={len(manifest)} items={len(draft)} opportunities={len(ops)} "
          f"conf={dict(conf)} unknown_contents={len(unknown)}")


if __name__ == "__main__":
    main()
