// Runs the real migration in PGlite (Postgres compiled to WASM) with minimal stand-ins for
// Supabase's auth/storage schemas, then checks access rules as anon / non-staff / staff.
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { beforeAll, describe, expect, it } from 'vitest'

const STAFF = '11111111-1111-1111-1111-111111111111'
const OUTSIDER = '22222222-2222-2222-2222-222222222222' // confirmed @bc.edu member, not staff
const ADMIN = '33333333-3333-3333-3333-333333333333'
const UNCONFIRMED = '44444444-4444-4444-4444-444444444444'

type Who = 'anon' | 'staff' | 'outsider' | 'admin' | 'unconfirmed'
const SUB: Record<Who, string> = { anon: '', staff: STAFF, outsider: OUTSIDER, admin: ADMIN, unconfirmed: UNCONFIRMED }

const SUPABASE_STUB = `
create role anon nologin; create role authenticated nologin;
create schema auth;
create table auth.users (id uuid primary key, email text, email_confirmed_at timestamptz);
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
grant usage on schema auth to anon, authenticated;
grant execute on function auth.uid() to anon, authenticated;
create schema storage;
create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text);
alter table storage.objects enable row level security;
grant usage on schema public, storage to anon, authenticated;
alter default privileges in schema public grant all on tables to anon, authenticated;
alter default privileges in schema public grant all on sequences to anon, authenticated;
`

let db: PGlite

async function as<T>(who: Who, fn: () => Promise<T>, ip = '10.0.0.1'): Promise<T> {
  const sub = SUB[who]
  await db.exec(`
    set role ${who === 'anon' ? 'anon' : 'authenticated'};
    select set_config('request.jwt.claim.sub', '${sub}', false);
    select set_config('request.headers', '{"x-forwarded-for":"${ip}"}', false);
  `)
  try {
    return await fn()
  } finally {
    await db.exec('reset role')
  }
}

let publishedPart: string
let draftPart: string
let drawer: string
let otherDrawer: string

beforeAll(async () => {
  db = new PGlite()
  await db.exec(SUPABASE_STUB)
  const dir = join(__dirname, '..', 'migrations')
  for (const file of readdirSync(dir).sort()) await db.exec(readFileSync(join(dir, file), 'utf8'))
  await db.exec(`insert into auth.users values
                   ('${STAFF}', 'staff@bc.edu', now()), ('${OUTSIDER}', 'student@bc.edu', now()),
                   ('${ADMIN}', 'boss@bc.edu', now()), ('${UNCONFIRMED}', 'new@bc.edu', null);
                 insert into public.staff (user_id, display_name) values ('${STAFF}', 'Test Staff');
                 insert into public.staff (user_id, display_name, role) values ('${ADMIN}', 'Test Admin', 'admin');`)
  const loc = await db.query<{ id: string }>(
    `insert into locations (kind, name, code) values ('Drawer','Drawer 1','T-01'), ('Drawer','Drawer 2','T-02') returning id`,
  )
  drawer = loc.rows[0].id
  otherDrawer = loc.rows[1].id
  const parts = await db.query<{ id: string }>(
    `insert into parts (name, value, published) values ('Resistor', '220 Ω', true), ('Secret draft', '', false) returning id`,
  )
  publishedPart = parts.rows[0].id
  draftPart = parts.rows[1].id
  await db.exec(`insert into stock (part_id, location_id, quantity, status) values
    ('${publishedPart}', '${drawer}', null, 'in_stock'), ('${draftPart}', '${drawer}', 5, 'in_stock');`)
})

describe('anonymous visitor', () => {
  it('sees published parts only', async () => {
    const rows = await as('anon', () => db.query<{ name: string }>('select name from parts'))
    expect(rows.rows.map((r) => r.name)).toEqual(['Resistor'])
    const stock = await as('anon', () => db.query('select * from stock'))
    expect(stock.rows).toHaveLength(1)
  })

  it('cannot insert, update or delete inventory', async () => {
    await expect(as('anon', () => db.query(`insert into parts (name) values ('hack')`))).rejects.toThrow()
    const upd = await as('anon', () => db.query(`update parts set name = 'hacked' returning id`))
    expect(upd.rows).toHaveLength(0)
    const del = await as('anon', () => db.query(`delete from stock returning id`))
    expect(del.rows).toHaveLength(0)
    await expect(as('anon', () => db.query(`insert into locations (name, code) values ('x','x')`))).rejects.toThrow()
    await expect(as('anon', () => db.query(`select move_stock('${publishedPart}', '${drawer}', '${otherDrawer}')`))).rejects.toThrow()
    await expect(as('anon', () => db.query(`select import_inventory('[]'::jsonb)`))).rejects.toThrow()
  })

  it('cannot read the restock queue, requester details, or staff list', async () => {
    await expect(as('anon', () => db.query('select * from restock_requests'))).rejects.toThrow()
    await expect(as('anon', () => db.query('select * from staff'))).rejects.toThrow()
    await expect(as('anon', () => db.query('select * from restock_submissions'))).rejects.toThrow()
  })

  it('submits restock requests, merges duplicates, and is rate limited', async () => {
    const first = await as('anon', () =>
      db.query<{ r: { status: string } }>(
        `select submit_restock_request('${publishedPart}', '${drawer}', 'Empty bin', 'Sam', 'sam@bc.edu') as r`,
      ),
    )
    expect(first.rows[0].r.status).toBe('created')
    const dup = await as('anon', () =>
      db.query<{ r: { status: string } }>(`select submit_restock_request('${publishedPart}', '${drawer}') as r`),
    )
    expect(dup.rows[0].r.status).toBe('duplicate')
    const count = await db.query<{ request_count: number }>('select request_count from restock_requests')
    expect(count.rows).toEqual([{ request_count: 2 }])

    await expect(
      as('anon', () => db.query(`select submit_restock_request('${draftPart}', null)`), '10.0.0.2'),
    ).rejects.toThrow(/unknown part/)
    await expect(
      as('anon', () => db.query(`select submit_restock_request('${publishedPart}', '${otherDrawer}')`), '10.0.0.2'),
    ).rejects.toThrow(/not stocked/)
    await expect(
      as('anon', () => db.query(`select submit_restock_request('${publishedPart}', null, repeat('x', 600))`), '10.0.0.2'),
    ).rejects.toThrow(/too long/)

    for (let i = 0; i < 3; i++) {
      await as('anon', () => db.query(`select submit_restock_request('${publishedPart}', null)`))
    }
    // 2 + 3 = 5 submissions from 10.0.0.1 in 10 minutes -> 6th is refused
    await expect(as('anon', () => db.query(`select submit_restock_request('${publishedPart}', null)`))).rejects.toThrow(
      /rate_limited/,
    )
    // a different client is unaffected
    await as('anon', () => db.query(`select submit_restock_request('${publishedPart}', null)`), '10.0.0.9')
  })
})

describe('signed-in user who is not staff', () => {
  it('has no more access than anon', async () => {
    const rows = await as('outsider', () => db.query('select * from parts'))
    expect(rows.rows).toHaveLength(1)
    await expect(as('outsider', () => db.query(`insert into parts (name) values ('x')`))).rejects.toThrow()
    const rq = await as('outsider', () => db.query('select * from restock_requests'))
    expect(rq.rows).toHaveLength(0)
    await expect(as('outsider', () => db.query('select claim_ai_quota()'))).rejects.toThrow(/forbidden/)
  })
})

describe('staff', () => {
  it('sees drafts and the restock queue with requester details', async () => {
    const rows = await as('staff', () => db.query('select * from parts'))
    expect(rows.rows).toHaveLength(2)
    const rq = await as('staff', () => db.query<{ requester_contact: string }>('select * from restock_requests'))
    expect(rq.rows.some((r) => r.requester_contact === 'sam@bc.edu')).toBe(true)
  })

  it('edits parts, keeps counted stock consistent, and resolves requests', async () => {
    await as('staff', () => db.query(`update parts set description = 'carbon film' where id = '${publishedPart}'`))
    await as('staff', () =>
      db.query(`update stock set quantity = 0 where part_id = '${draftPart}' and location_id = '${drawer}'`),
    )
    const s = await db.query<{ status: string }>(`select status from stock where part_id = '${draftPart}'`)
    expect(s.rows[0].status).toBe('out')
    const res = await as('staff', () =>
      db.query(`update restock_requests set status = 'resolved', resolved_at = now() where status = 'open' returning id`),
    )
    expect(res.rows.length).toBeGreaterThan(0)
  })

  it('moves stock between locations', async () => {
    await as('staff', () =>
      db.query(`update stock set quantity = 10 where part_id = '${draftPart}' and location_id = '${drawer}'`),
    )
    await as('staff', () => db.query(`select move_stock('${draftPart}', '${drawer}', '${otherDrawer}', 4)`))
    const rows = await db.query<{ location_id: string; quantity: number }>(
      `select location_id, quantity from stock where part_id = '${draftPart}' order by quantity`,
    )
    expect(rows.rows.map((r) => r.quantity)).toEqual([4, 6])
  })

  it('imports atomically', async () => {
    const items = [
      { part: { name: 'NE555 timer', part_number: 'NE555P', published: true }, category: 'ICs', stock: [{ location_id: drawer, quantity: 12 }] },
    ]
    const r = await as('staff', () => db.query<{ r: { created: number } }>(`select import_inventory($1::jsonb) as r`, [JSON.stringify(items)]))
    expect(r.rows[0].r.created).toBe(1)
    const bad = [{ part: { name: 'ok' }, stock: [] }, { part: { name: null } }]
    await expect(as('staff', () => db.query(`select import_inventory($1::jsonb)`, [JSON.stringify(bad)]))).rejects.toThrow()
    const ok = await db.query(`select * from parts where name = 'ok'`)
    expect(ok.rows).toHaveLength(0)
  })

  it('AI quota is staff-only and rate limited', async () => {
    for (let i = 0; i < 30; i++) await as('staff', () => db.query('select claim_ai_quota()'))
    await expect(as('staff', () => db.query('select claim_ai_quota()'))).rejects.toThrow(/rate_limited/)
  })
})

describe('part requests (not in catalog)', () => {
  it('anon can request a missing part; repeats merge; staff sees it', async () => {
    const a = await as('anon', () => db.query<{ r: { status: string } }>(`select submit_part_request('Hall effect sensor A3144', 'for a bike speedometer', 'Ana', '') as r`), '10.1.0.1')
    expect(a.rows[0].r.status).toBe('created')
    const b = await as('anon', () => db.query<{ r: { status: string } }>(`select submit_part_request('hall effect sensor a3144') as r`), '10.1.0.2')
    expect(b.rows[0].r.status).toBe('duplicate')
    await expect(as('anon', () => db.query(`select submit_part_request('x')`), '10.1.0.3')).rejects.toThrow(/2–120/)
    await expect(as('anon', () => db.query(`select * from restock_requests`))).rejects.toThrow()
    const rows = await as('staff', () => db.query<{ requested_part: string; request_count: number }>(`select requested_part, request_count from restock_requests where part_id is null`))
    expect(rows.rows).toEqual([{ requested_part: 'Hall effect sensor A3144', request_count: 2 }])
  })
})

describe('BC accounts', () => {
  it('only @bc.edu emails can have accounts, and each gets a profile', async () => {
    await expect(db.query(`insert into auth.users values (gen_random_uuid(), 'someone@gmail.com', now())`)).rejects.toThrow(/bc\.edu/)
    await expect(db.query(`insert into auth.users values (gen_random_uuid(), 'x@bc.edu.evil.com', now())`)).rejects.toThrow(/bc\.edu/)
    await expect(db.query(`update auth.users set email = 'student@gmail.com' where id = '${OUTSIDER}'`)).rejects.toThrow(/bc\.edu/)
    const p = await db.query<{ email: string; display_name: string }>(`select email, display_name from profiles where id = '${OUTSIDER}'`)
    expect(p.rows).toEqual([{ email: 'student@bc.edu', display_name: 'student' }])
  })

  it('members see only their own profile; staff and admins see everyone', async () => {
    expect((await as('outsider', () => db.query('select id from profiles'))).rows).toHaveLength(1)
    // staff can read names (shown as 'verified by' / 'checked by')
    expect((await as('staff', () => db.query('select id from profiles'))).rows.length).toBeGreaterThanOrEqual(4)
    expect((await as('admin', () => db.query('select id from profiles'))).rows.length).toBeGreaterThanOrEqual(4)
    await expect(as('anon', () => db.query('select * from profiles'))).rejects.toThrow()
    await expect(as('outsider', () => db.query(`update profiles set email = 'boss@bc.edu' where id = '${OUTSIDER}'`))).rejects.toThrow()
    await as('outsider', () => db.query(`update profiles set display_name = 'Sam' where id = '${OUTSIDER}'`))
  })

  it('only admins change roles, and cannot demote themselves', async () => {
    await expect(as('outsider', () => db.query(`select set_member_role('${OUTSIDER}', 'admin')`))).rejects.toThrow(/forbidden/)
    await expect(as('staff', () => db.query(`select set_member_role('${OUTSIDER}', 'staff')`))).rejects.toThrow(/forbidden/)
    await expect(as('outsider', () => db.query(`insert into staff (user_id, role) values ('${OUTSIDER}', 'admin')`))).rejects.toThrow()
    await expect(as('admin', () => db.query(`select set_member_role('${ADMIN}', 'member')`))).rejects.toThrow(/own admin/)

    await as('admin', () => db.query(`select set_member_role('${OUTSIDER}', 'staff')`))
    const draftQ = `select id from parts where name = 'Secret draft'`
    expect((await as('outsider', () => db.query(draftQ))).rows).toHaveLength(1) // staff now: sees drafts
    await as('admin', () => db.query(`select set_member_role('${OUTSIDER}', 'member')`))
    expect((await as('outsider', () => db.query(draftQ))).rows).toHaveLength(0)
  })
})

describe('community posts', () => {
  it('need a confirmed BC account to post, stay hidden until approved, and only staff moderate', async () => {
    await expect(as('anon', () => db.query(`select submit_community_post('project', 'Spam', 'spam')`), '10.2.0.1')).rejects.toThrow()
    await expect(as('unconfirmed', () => db.query(`select submit_community_post('project', 'Spam', 'spam')`), '10.2.0.1')).rejects.toThrow(/sign in/)
    await expect(as('outsider', () => db.query(`insert into community_posts (title, body) values ('spam', 'spam')`))).rejects.toThrow()

    const r = await as('outsider', () => db.query<{ r: { id: string; status: string } }>(`select submit_community_post('project', 'Plant monitor', 'Used the soil sensor from B-03', 'Jo') as r`), '10.2.0.2')
    expect(r.rows[0].r.status).toBe('pending')
    const id = r.rows[0].r.id
    expect((await as('anon', () => db.query('select id, title from community_posts'))).rows).toHaveLength(0)
    // the author can see their own pending post
    expect((await as('outsider', () => db.query('select id, title, status from community_posts'))).rows).toHaveLength(1)
    // nobody outside staff can read who wrote a post
    await expect(as('anon', () => db.query('select author_id from community_posts'))).rejects.toThrow()

    const upd = await as('outsider', () => db.query(`update community_posts set status = 'approved' where id = '${id}'`))
    expect(upd.affectedRows ?? 0).toBe(0)
    await as('staff', () => db.query(`update community_posts set status = 'approved', reviewed_at = now() where id = '${id}'`))
    const visible = await as('anon', () => db.query<{ title: string }>('select title from community_posts'))
    expect(visible.rows.map((x) => x.title)).toEqual(['Plant monitor'])
    await expect(as('outsider', () => db.query(`select submit_community_post('ad', 'Buy now', 'x')`), '10.2.0.3')).rejects.toThrow(/post type/)
  })

  it('shares the public rate limit', async () => {
    for (let i = 0; i < 5; i++) await as('anon', () => db.query(`select submit_part_request('Part ${i}')`), '10.3.0.1')
    await expect(as('anon', () => db.query(`select submit_part_request('Another part')`), '10.3.0.1')).rejects.toThrow(/rate_limited/)
  })
})

describe('photo inventory (live catalog with gradual verification)', () => {
  const draft = JSON.parse(readFileSync(join(__dirname, '..', '..', 'inventory', 'inventory-draft.json'), 'utf8'))
  const dups = draft.items.filter((i: { duplicate_of: string | null }) => i.duplicate_of).length
  const hidden = draft.items.filter((i: { searchable: boolean }) => !i.searchable).length

  it('only staff can import; records go live as Needs Review, deduplicated, idempotent', async () => {
    await expect(as('outsider', () => db.query(`select import_photo_draft($1::jsonb)`, [JSON.stringify(draft)]))).rejects.toThrow(/forbidden/)
    const r = await as('staff', () => db.query<{ r: { locations: number; parts: number; deduplicated: number } }>(`select import_photo_draft($1::jsonb) as r`, [JSON.stringify(draft)]))
    expect(r.rows[0].r).toMatchObject({ locations: draft.locations.length, parts: draft.items.length - dups, deduplicated: dups })
    const again = await as('staff', () => db.query<{ r: { locations: number; parts: number } }>(`select import_photo_draft($1::jsonb) as r`, [JSON.stringify(draft)]))
    expect(again.rows[0].r).toMatchObject({ locations: 0, parts: 0 })
    const n = await db.query<{ n: number }>(`select count(*)::int n from parts where evidence ? 'draft_id'`)
    expect(n.rows[0].n).toBe(draft.items.length - dups)
    const verified = await db.query<{ n: number }>(`select count(*)::int n from parts where evidence ? 'draft_id' and review_status = 'verified'`)
    expect(verified.rows[0].n).toBe(0)
    const counted = await db.query<{ n: number }>(`select count(*)::int n from stock s join parts p on p.id = s.part_id where p.evidence ? 'draft_id' and (s.quantity is not null or s.status <> 'unverified')`)
    expect(counted.rows[0].n).toBe(0)
  })

  it('students see Needs Review records, but not hidden ones or evidence', async () => {
    const pub = await as('anon', () => db.query<{ review_status: string }>(`select review_status from parts where evidence ? 'draft_id'`))
    expect(pub.rows.length).toBe(draft.items.length - dups - hidden)
    expect(new Set(pub.rows.map((x) => x.review_status))).toEqual(new Set(['needs_review']))
    await expect(as('anon', () => db.query('select * from location_evidence'))).rejects.toThrow()
    expect((await as('staff', () => db.query('select * from location_evidence'))).rows.length).toBe(draft.locations.length)
    // a deduplicated record carries both locations
    const kit = await as('anon', () => db.query(`select s.location_id from parts p join stock s on s.part_id = p.id where p.evidence ->> 'draft_id' = 'z2-d1-016'`))
    expect(kit.rows).toHaveLength(2)
  })

  it('staff verify and correct records; changes are audited; rejected records cannot be public', async () => {
    const { rows } = await db.query<{ id: string }>(`select id from parts where evidence ->> 'draft_id' = 'z2-d1-016'`)
    const id = rows[0].id
    await expect(as('outsider', () => db.query(`update parts set review_status = 'verified' where id = '${id}' returning id`))).resolves.toMatchObject({ rows: [] })
    await as('staff', () => db.query(`update parts set review_status = 'verified', name = 'BOJACK capacitor kit (630 pcs)' where id = '${id}'`))
    const p = await db.query<{ verified_by: string }>(`select verified_by from parts where id = '${id}'`)
    expect(p.rows[0].verified_by).toBe(STAFF)
    const audit = await db.query<{ detail: { name: { from: string; to: string } }; actor: string }>(`select detail, actor from inventory_events where part_id = '${id}' and kind = 'edit'`)
    expect(audit.rows[0].detail.name.to).toBe('BOJACK capacitor kit (630 pcs)')
    expect(audit.rows[0].actor).toBe(STAFF)
    await expect(as('staff', () => db.query(`update parts set review_status = 'rejected', published = true where id = '${id}'`))).rejects.toThrow(/publish_not_rejected/)
  })

  it('merging folds a duplicate into the record to keep', async () => {
    const ids = await db.query<{ d: string; id: string }>(`select evidence ->> 'draft_id' d, id from parts where evidence ->> 'draft_id' in ('z2-d1-017', 'z2-d1-004')`)
    const by = Object.fromEntries(ids.rows.map((r) => [r.d, r.id]))
    await as('staff', () => db.query(`select merge_parts('${by['z2-d1-004']}', '${by['z2-d1-017']}')`))
    const dup = await db.query<{ review_status: string; published: boolean }>(`select review_status, published from parts where id = '${by['z2-d1-004']}'`)
    expect(dup.rows[0]).toEqual({ review_status: 'rejected', published: false })
  })

  it('marking a drawer checked and checking stock record the staff account', async () => {
    const loc = await db.query<{ id: string }>(`select id from locations where code = 'Z2-D1'`)
    await expect(as('outsider', () => db.query(`select mark_location_reviewed('${loc.rows[0].id}')`))).rejects.toThrow(/forbidden/)
    await as('staff', () => db.query(`select mark_location_reviewed('${loc.rows[0].id}')`))
    const r = await db.query<{ reviewed_by: string }>(`select reviewed_by from locations where id = '${loc.rows[0].id}'`)
    expect(r.rows[0].reviewed_by).toBe(STAFF)
    await as('staff', () => db.query(`update stock set status = 'in_stock', last_checked_at = now() where location_id = '${loc.rows[0].id}'`))
    const s = await db.query<{ checked_by: string }>(`select distinct checked_by from stock where location_id = '${loc.rows[0].id}'`)
    expect(s.rows).toEqual([{ checked_by: STAFF }])
  })
})
