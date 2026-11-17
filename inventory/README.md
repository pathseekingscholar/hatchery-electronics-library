# Photo inventory (snapshot 2026-11-16)

A digital twin of the Hatchery electronics area, reconstructed from 28 photos. The records are **live in the catalog** as **Needs review**; staff move them to **Staff verified** by physically checking them on **Admin → Inventory review**. Nothing is ever verified automatically.

- Every record from the photos starts as Needs review. `review_reasons` lists specific concerns (low confidence, uncertain drawer, possible duplicate).
- Records with no meaningful identity (unlabeled containers, exhibits) are hidden from students but stay on the review screen.
- Records marked `duplicate_of` add their location to the earlier record, so the import doesn't create a second catalog entry.
- Stock always starts as **Unverified** with no count.

## Files

| File | What it is |
| --- | --- |
| `workspace-hierarchy.json` | Every location (room → station/zone → drawer → bin/case) as a tree and a flat list, with stable ids and label codes |
| `photo-manifest.json` | Each photo: size, time, zone, locations shown, viewpoint, overlaps, quality limits |
| `inventory-draft.json` | 270 proposed records with location, confidence, label text and source photos. This is what the app loads |
| `inventory-review.csv` | The same records as a spreadsheet with blank columns for a paper or offline review |
| `storage-opportunities.json` | Empty, unlabeled, disorganized or unphotographed storage (21 notes) |
| `inventory-analysis.md` | Counts, uncertain identifications, missing information |
| `source/photo-pins.json` | Crop box, blur areas and per-record pin position for each public drawer view |
| `source/` | **Hand-written analysis — edit these, not the generated files** |
| `photos/` | Original HEIC + derived JPEGs (git-ignored; see below) |

## Regenerate

```bash
python -I scripts/inventory/convert_photos.py   # HEIC → analysis/web/thumb JPEGs (strips metadata)
python -I scripts/inventory/build_inventory.py  # source/*.json → the six files above (validates ids, locations, photos)
python -I scripts/inventory/location_photos.py  # public drawer views + pins → public/location-photos, src/data/location-photos.json
python -I scripts/inventory/crop.py IMG_1024 0.15 0.05 0.85 0.35   # zoom into a region of a photo
```

## Photos

Originals go in `photos/original/` (the zip from Google Drive). Nothing under `photos/` is committed: the full images show people, a name tag and a monitor name sticker. What *is* published: 19 **cropped drawer views** in `public/location-photos/` (people and labels cropped out, the name tag blurred, metadata stripped) with a pin on each record, and 24 openly licensed representative photos from Wikimedia Commons in `public/catalog-images/` (credited on each part page; list in `src/data/representative-images.json`). In local dev the review screen reads them from disk. For production, upload them once to the **private** `catalog-drafts` bucket:

```bash
SUPABASE_URL=https://<ref>.supabase.co SUPABASE_SERVICE_ROLE_KEY=<key> node scripts/inventory/upload-evidence.mjs
```

## Ongoing maintenance

The photos are a starting point. During an organization shift:

1. Open **Drawers → (drawer) → Check this drawer**, or **Admin → Inventory review → (drawer)**.
2. Confirm, correct, reject or merge each record; set a stock status or count.
3. Add anything missing with **Add a part** (manual or *Suggest details from photo*; AI is optional).
4. Press **Mark drawer checked**. The date and the staff account are recorded on the drawer, and on each stock line you change.

To add a new photo batch: put the photos in `photos/original/`, run `convert_photos.py`, add observations to `source/`, run `build_inventory.py`, then use **Load an updated draft**. New records arrive as drafts, and records already reviewed are never overwritten.
