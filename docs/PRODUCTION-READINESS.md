# Production readiness — Hatchery Electronics Library

Audit date: 2026-11-17 · branch `hatchery-electronics-library` · nothing deployed, no Supabase project exists yet.

## How the app decides where data lives

`src/backend/index.ts` picks the backend **at build time**:

- `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY` set → **Supabase** (shared database, real accounts).
- Not set → **in-browser demo**: data lives in each visitor's own `localStorage`/IndexedDB.

Today no `.env.local` exists and the repo has no GitHub remote, so **every build — including a GitHub Pages build — is the demo**. In the demo, each person gets a private copy: an edit, restock request or post made on one phone is invisible to everyone else.

The Supabase code path (`src/backend/supabase.ts`, 5 migrations, 1 edge function) is written and its **database rules are tested** (PGlite: RLS, roles, RPCs, import — 69 tests total), but it has **never run against a real Supabase project**. Expect a short shake-down when it is first connected.

## Feature audit

| Feature | Status | What works now | Depends on local-only behavior | Missing config | Needed for a team |
|---|---|---|---|---|---|
| Public search, filters, location browsing | **Production-ready** (static) | Full catalog (253 parts, 94 locations) is bundled into the build; works on Pages with no backend | — | — | Nothing. Note: once Supabase is connected the catalog comes from the DB instead, so staff must load the draft once (step 7) or the site will look empty |
| Catalog images (card images, drawer views + pins, Commons photos) | **Production-ready** (static) | 298 JPEGs in `dist/`, verified under the Pages subpath; keyed by record id so they work in both modes | — | — | Nothing. Staff-uploaded photos (below) override them per part |
| Staff/admin sign-in & roles | **Requires Supabase** | Demo: code shown on screen, demo accounts | Demo sessions are per-browser; *anyone* can sign in as the demo admin (harmless, but only their own copy) | Supabase project, email OTP template, **custom SMTP**, first admin row | Steps 1–5 |
| Role permissions (staff/admin, People page) | **Requires Supabase** | Enforced by RLS + `set_member_role()`; tested | Demo checks are UI-level only | Same as above | Steps 1–5 |
| Inventory editing, verify, stock, move, merge, reject, mark drawer checked, audit log | **Requires Supabase** | All screens work in demo; DB functions + audit triggers tested | Demo writes go to the editor's own browser only | Supabase + migrations + draft import | Steps 1–7 |
| CSV import/export | **Requires Supabase** for import; export works anywhere | | Demo import is per-browser | | Steps 1–7 |
| Restock requests & part requests | **Requires Supabase** | RPCs with validation, de-duplication, rate limits; staff queue | Demo: a student's request is stored only in *their* browser — staff never see it | Supabase | Steps 1–3 |
| Community posts + moderation | **Requires Supabase** | BC sign-in required to post, posts pending until approved | Demo is per-browser | Supabase + SMTP | Steps 1–5 |
| Community comments / replies | **Not implemented** | — | — | — | New feature (table + RLS + UI) |
| Photo uploads (part & drawer photos) | **Requires Supabase** | Client resizes, strips EXIF; uploads to `catalog` (public) / `catalog-drafts` (private) buckets created by the migration | Demo stores blobs in the uploader's IndexedDB | Supabase Storage (free 1 GB) | Steps 1–2 |
| Staff evidence photos (originals on the review screen) | **Requires Supabase + one upload** | Shown from the dev server locally | Originals only exist on this computer | Run `scripts/inventory/upload-evidence.mjs` once (service-role key, locally) | Step 8 |
| "Suggest details from photo" (OpenRouter) | **Optional; requires Supabase function + key** | Edge function written; manual entry works without it | Local dev middleware only | Deploy `suggest-part`, set `OPENROUTER_API_KEY` (pay-as-you-go) | Step 9 (optional) |
| Live updates between staff | **Partial** | Catalog refetches on focus and every 60 s | — | Realtime not enabled (not needed at first) | — |
| GitHub Pages hosting | **Ready, not set up** | Subpath, deep links (404.html), assets verified with a Pages emulator; workflow in `.github/workflows/deploy-pages.yml` | — | GitHub repo, Pages source = Actions, repo variables | Steps 10–11 |

## Recommended architecture (free-first)

```
 Students & staff (phones/laptops)
          │  HTTPS
          ▼
 GitHub Pages ── static site: React app + catalog images (17 MB)
          │  supabase-js (anon key — public by design; RLS protects data)
          ▼
 Supabase (free project)
   • Postgres + RLS ........ parts, stock, locations, requests, posts, roles, audit log
   • Auth (email OTP) ...... @bc.edu only (DB trigger); codes sent via custom SMTP
   • Storage ............... catalog (public, approved photos) / catalog-drafts (private)
   • Edge function ......... suggest-part (optional, OpenRouter key stays server-side)
```

No other servers. Keep the bundled catalog images on Pages (no Storage needed for them); use Supabase Storage only for photos staff upload later.

## What to configure, in order

1. **Create a Supabase project** (free). Note the project URL, anon key, and (privately) the service-role key.
2. **Apply the 5 migrations** in `supabase/migrations/` in filename order (SQL editor, or `npx supabase link` + `npx supabase db push`).
3. **Auth settings:** Email provider on, "Confirm email" on, sign-ups allowed. Site URL and redirect URL = your Pages URL (e.g. `https://<org>.github.io/hatchery-electronics-library/`).
4. **Email:** edit the *Magic Link* template to include the code: `Your Hatchery sign-in code is {{ .Token }}`. Set up **custom SMTP** (see blockers) — required before anyone outside your Supabase team can receive codes.
5. **First admin:** sign in once on the site with your BC email, then in the SQL editor:
   `insert into public.staff (user_id, display_name, role) select id, split_part(email,'@',1), 'admin' from auth.users where email = 'you@bc.edu' on conflict (user_id) do update set role = 'admin';`
   Promote others from **Admin → People**.
6. **Local test against Supabase:** put `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` in `.env.local`, run `npm run dev`, and walk through sign-in, search, a restock request, an edit, and a photo upload. (This is the first real run of the Supabase path.)
7. **Load the inventory:** Admin → Inventory review → *Load an updated draft* → choose `inventory/inventory-draft.json` (the full file, not the public seed). Re-running is safe.
8. **Evidence photos for staff (optional):** `SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… node scripts/inventory/upload-evidence.mjs` from this computer.
9. **AI suggestions (optional):** `npx supabase functions deploy suggest-part`, then `npx supabase secrets set OPENROUTER_API_KEY=… ALLOWED_ORIGIN=https://<org>.github.io`.
10. **GitHub:** create the repo, push the branch, merge to `main`. Settings → Pages → Source: *GitHub Actions*. Settings → Variables: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`.
11. **Deploy** (the workflow runs tests, builds with the repo-name subpath, publishes). Re-test sign-in on the live URL.

## Blockers, risks, gotchas

- **Email delivery is the main blocker.** Supabase's built-in email only delivers to members of your Supabase organization and is heavily rate-limited, so students won't get codes without custom SMTP. Options: ask BC IT for an SMTP relay (best deliverability to @bc.edu), or a free provider (Brevo/Resend free tiers) with a verified sender — test that BC's mail filter doesn't quarantine the codes.
- **A Pages deploy without the two variables silently ships the demo.** It looks fully functional but nothing is shared. Consider making the deploy workflow fail when the variables are missing (small change; not made yet).
- **After connecting Supabase the catalog starts empty** until step 7 is done.
- **Supabase free tier pauses a project after ~1 week without traffic** (unpause in the dashboard). Daily student use prevents this; summer breaks may not. 500 MB DB / 1 GB storage limits are far above current needs.
- **GitHub Pages on the free plan needs a public repo.** That publishes the code, migrations and `inventory/` (draft records and storage notes; the original photos and contact sheets are git-ignored). The anon key is meant to be public; never commit the service-role key or OpenRouter key.
- **The Supabase code path is untested end-to-end** (only its SQL is). Budget an hour for step 6.
- **OpenRouter is pay-as-you-go**; keep it off until needed. Manual entry never depends on it.
- **Restock rate limiting** keys on the client IP; on shared campus Wi-Fi many students share an IP (limit: 5 per 10 min per IP, 300/hour overall). Raise if it bites.
- **Community comments don't exist yet** — only posts.
