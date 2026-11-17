# Hatchery Electronics Library

A parts finder for the electronics drawers at Boston College's Hatchery Makerspaces. A student searches for a part on a phone and sees which drawer to open. Staff update inventory from the same phone.

- **Students**: no account needed to search. Anyone with a `@bc.edu` email can sign in with a one-time code sent to their inbox (no passwords), and they need to be signed in to post in Community. Without signing in, students search by name, value (`220Ω` = `220 ohm` = `220R`; `4.7k` = `4k7` = `4.7 kΩ`), part number, alias, category, or drawer label. They can browse drawers, tap **Request restock** on a part, **Request a part** the library doesn't have, and post projects, questions, and tips on **Community**. Posts appear only after staff approve them.
- **Admin** at **`/admin`**: there is no link from the public pages, and every action needs a staff sign-in. Staff can add and edit parts, use the phone camera or photo uploads, keep a working drawer selected while adding several parts, run a quick audit of one drawer, and move stock between locations. They also manage locations, import and export CSV, work through the restock and part-request queue, and moderate Community posts. **Suggest details from photo** is optional.

The UI uses Boston College maroon and gold on a warm canvas. A collapsible sidebar shows the public pages to everyone and adds the Admin section once staff are signed in. On phones the sidebar becomes a slide-in menu.

Stack: Vite + React + TypeScript + Tailwind (kept from the legacy app), TanStack Query, Supabase (Postgres, Auth, Storage, Edge Function), and static hosting on GitHub Pages.

## Photo inventory (the real Hatchery layout)

The catalog is populated from the 2026-11-16 photos (`inventory/`): 94 locations (Soldering Station and Zones I–IV, drawers, bins and cases) and 268 unique records. All are **Needs review** until a person checks them; students can search and browse them right away. Each part page shows the drawer photo with a pin on the part, plus a representative photo when one is available. See [`inventory/README.md`](inventory/README.md).

Staff work through **Admin → Inventory review**: verify (records the date and staff account), correct (live immediately and audited), update stock, move, merge, reject, and mark drawers checked. Without a database, the local preview loads the inventory automatically; with Supabase, apply the migrations and press **Load an updated draft** once (re-running it is safe).

## Run it locally (demo mode)

```bash
npm install
npm run dev        # http://127.0.0.1:5173
```

Without Supabase settings, the app runs a **local demo**. The demo data is fictional, stored in your browser, and labeled with a banner on every page. Demo sign-in: the demo shows the one-time code on screen instead of emailing it. Use the **Admin**, **Staff**, or **Student** demo account buttons on the sign-in page, or any `@bc.edu` address. The demo applies the same rules as the server (staff-only writes, request de-duplication, rate limits), but the real security boundary is the database (see "Security model" below).

To try photo suggestions locally, put `OPENROUTER_API_KEY=...` in `.env.local`. The Vite dev server reads it in Node and never ships it to the browser. Without a key, the button says suggestions aren't configured and manual entry still works.

```bash
npm test           # search/value parsing, CSV import, and database policy tests (PGlite)
npm run lint
```

## Go live

Nothing below has been created yet. Each step is yours to run, and none of them needs a paid plan.

1. **Create a Supabase project** (free tier is fine) at supabase.com.
2. **Apply the schema.** Either paste the files in `supabase/migrations/` (in filename order, including `…_inventory_review.sql`) into the SQL editor, or run:
   ```bash
   npx supabase link --project-ref <your-ref>
   npx supabase db push
   ```
   This creates the tables, row-level-security policies, RPCs, the `catalog` (public) and `catalog-drafts` (private) storage buckets, and starter categories. It adds **no** parts and **no** locations.
3. **Set up BC sign-in.**
   - Authentication → Providers → Email: keep it enabled, turn **Confirm email** on, and leave **Allow new users to sign up** on. The database rejects any account that isn't `@bc.edu`, so open sign-up is safe.
   - Authentication → Email Templates → **Magic Link**: add the 6-digit code to the email body, e.g. `Your Hatchery sign-in code is {{ .Token }}`. The app asks for that code, which works even when the email opens on a different device.
   - Authentication → SMTP: Supabase's built-in email sender allows only a few emails per hour, so connect a real SMTP sender (BC IT or a provider such as Resend or Postmark) before students use it.
   - Make yourself the first admin. Sign in once on the site with your BC email, then run this in the SQL editor:
     ```sql
     insert into public.staff (user_id, display_name, role)
     select id, split_part(email, '@', 1), 'admin' from auth.users where email = 'you@bc.edu'
     on conflict (user_id) do update set role = 'admin';
     ```
     After that, use **Admin → People** to make other people staff or admin. No more SQL is needed.
4. **Deploy the photo-suggestion function** (optional):
   ```bash
   npx supabase functions deploy suggest-part
   npx supabase secrets set OPENROUTER_API_KEY=sk-or-... OPENROUTER_MODEL=google/gemini-2.5-flash ALLOWED_ORIGIN=https://<org>.github.io
   ```
5. **Configure the frontend.** Copy `.env.example` to `.env.local` and fill in `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` (the anon key is meant to be public). `npm run dev` now uses the real database.
6. **Enter the real inventory.** On **Locations**, build the actual room → cabinet → drawer → bin tree, with label codes that match the printed drawer labels. Then add parts one by one, or fill in the template from **CSV → Download template** and import it. The import shows a preview first and flags invalid or duplicate rows.
7. **Publish on GitHub Pages.** Push to a GitHub repo and set Settings → Pages → Source to **GitHub Actions**. Then add the repo variables `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`. `.github/workflows/deploy-pages.yml` tests, builds with the repo-name subpath, and deploys. In Supabase → Authentication → URL Configuration, add the Pages URL.

Inventory changes are written to the database and show up on the next fetch (on page focus, and every 60 s). No commit or redeploy is needed.

### GitHub Pages subpath

`npm run build:pages` builds for `/hatchery-electronics-library/` (override with `VITE_BASE_PATH`) and copies `index.html` to `404.html`, so direct links and refreshes such as `/hatchery-electronics-library/part/<id>` load the app. To check it locally:

```bash
npm run build:pages
npm run serve:pages     # http://127.0.0.1:4174/hatchery-electronics-library/
```

(In Git Bash, prefix the second command with `MSYS_NO_PATHCONV=1` if you pass a custom base path.) As on GitHub Pages, deep links return HTTP 404 with the app page. Browsers handle this fine, but search engines won't index those pages.

## Security model

- Row-level security does the enforcement. Anonymous visitors can read only published parts, their stock, approved photos, locations, and categories. Staff status means a row in `public.staff`, checked by `is_staff()` in every write policy and staff RPC.
- Accounts: a database trigger rejects any user whose email isn't `@bc.edu`, at sign-up and on email changes. Posting requires a confirmed email (`is_member()`). Only admins can change roles (`set_member_role()`), and an admin can't demote themselves. Post author IDs aren't readable by the public.
- Community posts go in through `submit_community_post()` as *pending*. The public can read only approved posts, and only staff can publish, hide, or delete them. Requests for parts not in the catalog go through `submit_part_request()`, and repeats merge into one request. All public submissions share one rate limit.
- Anonymous visitors can't read restock requests, so requester names and emails stay private. Students submit through `submit_restock_request()`. That function validates lengths and that the part and location exist, merges repeats into one open request per part and location (shown as "3 requests"), and rate-limits to 5 per client per 10 minutes and 300 per hour overall.
- Photos are resized in the browser (max 1600 px plus a 320 px thumbnail, WebP, with EXIF and GPS stripped). Draft photos sit in the private `catalog-drafts` bucket and are viewed through short-lived signed URLs. Approving a photo moves it to the public `catalog` bucket. Paths are `parts/<part>/<photo>/{full,thumb}.webp` and `locations/<loc>/<photo>/…`, and the database stores paths rather than URLs, so storage can be moved later.
- The OpenRouter key exists only in Supabase function secrets (or your local `.env.local` for dev). The function runs as the calling staff user and needs no service-role key. It is limited to 30 suggestions per user per 10 minutes. Suggestions never fill in part numbers, values, quantities, or locations, and nothing is saved until staff press **Save**.
- `supabase/tests/policies.test.ts` runs the real migration in Postgres (PGlite) and checks these rules as an anonymous visitor, a signed-in non-staff user, and staff.

## Stock model

Each part can be stocked at several locations, with stock tracked separately at each. Each entry has a **status** (In stock, Low, Out, Unverified), an optional **count**, and a **last checked** date. Leave the count blank for bulk parts. Students then see only the status and when it was checked, never a made-up number. A confirmed count of 0 is always shown as Out.

## Migrating from the legacy Eagle Circuit Library

The old app (tag `legacy-eagle-circuit-library`) kept everything in browser `localStorage`. Its 24 parts were generated sample data with made-up counts and shelf locations, so none of it was imported as real inventory. Several of those part names appear in the clearly labeled demo data. If anyone added real parts through the old app in this browser, **CSV → Download legacy parts CSV** exports them (sample records excluded, no counts or locations) so you can add drawer codes and import them. The old eagle logo is kept in `assets/legacy/`.

## Project layout

```
src/lib/units.ts, search.ts   value parsing + ranking (exact part number > value > name > loose)
src/lib/csv.ts                CSV export, template, import planning/validation
src/lib/images.ts             resize / thumbnail / metadata stripping
src/backend/supabase.ts       production data layer
src/backend/demo.ts           local demo data layer (+ demoSeed.ts, fictional)
src/pages/                    Home (search), PartPage, LocationsPage, Staff* screens
supabase/migrations/          schema, RLS, RPCs, storage policies
supabase/functions/           suggest-part edge function (+ _shared logic used by dev server)
```
