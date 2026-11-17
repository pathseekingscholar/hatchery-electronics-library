-- Hatchery Electronics Library: core schema, access policies, and RPCs.
-- Students (anon) can read the published catalog and submit restock requests through an RPC.
-- Everything else requires a row in public.staff for the signed-in user.

-- ---------------------------------------------------------------- tables

create table public.staff (
  user_id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null default '',
  role text not null default 'staff' check (role in ('staff', 'admin')),
  created_at timestamptz not null default now()
);

create table public.categories (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (length(name) between 1 and 60),
  sort int not null default 0
);

-- Configurable hierarchy (e.g. Room > Cabinet > Drawer > Bin). `kind` is free text so the
-- team names its own levels; `code` is the short label printed on the physical drawer.
create table public.locations (
  id uuid primary key default gen_random_uuid(),
  parent_id uuid references public.locations (id) on delete restrict,
  kind text not null default 'Drawer' check (length(kind) between 1 and 30),
  name text not null check (length(name) between 1 and 80),
  code text not null unique check (length(code) between 1 and 24),
  description text not null default '',
  photo_path text,
  thumb_path text,
  sort int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (parent_id is null or parent_id <> id)
);

create table public.parts (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(name) between 1 and 120),
  category_id uuid references public.categories (id) on delete set null,
  value text not null default '',          -- e.g. "220 Ω", "100 µF 25 V"
  part_number text not null default '',
  manufacturer text not null default '',
  package text not null default '',
  aliases text[] not null default '{}',
  description text not null default '',
  datasheet_url text not null default '' check (datasheet_url = '' or datasheet_url ~* '^https?://'),
  published boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index parts_category_idx on public.parts (category_id);

create table public.part_photos (
  id uuid primary key default gen_random_uuid(),
  part_id uuid not null references public.parts (id) on delete cascade,
  full_path text not null,
  thumb_path text not null,
  published boolean not null default false, -- published photos live in the public `catalog` bucket
  is_primary boolean not null default false,
  created_at timestamptz not null default now()
);
create index part_photos_part_idx on public.part_photos (part_id);

-- One row per part per location. quantity NULL = not counted (bulk parts); status still applies.
create table public.stock (
  id uuid primary key default gen_random_uuid(),
  part_id uuid not null references public.parts (id) on delete cascade,
  location_id uuid not null references public.locations (id) on delete restrict,
  quantity int check (quantity is null or quantity >= 0),
  status text not null default 'unverified' check (status in ('in_stock', 'low', 'out', 'unverified')),
  last_checked_at timestamptz,
  notes text not null default '' check (length(notes) <= 300),
  updated_at timestamptz not null default now(),
  unique (part_id, location_id)
);
create index stock_location_idx on public.stock (location_id);

create table public.restock_requests (
  id uuid primary key default gen_random_uuid(),
  part_id uuid not null references public.parts (id) on delete cascade,
  location_id uuid references public.locations (id) on delete set null,
  status text not null default 'open' check (status in ('open', 'acknowledged', 'resolved', 'dismissed')),
  note text not null default '' check (length(note) <= 500),
  requester_name text not null default '' check (length(requester_name) <= 80),
  requester_contact text not null default '' check (length(requester_contact) <= 120),
  request_count int not null default 1,
  requester_hash text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  acknowledged_at timestamptz,
  acknowledged_by uuid references auth.users (id) on delete set null,
  resolved_at timestamptz,
  resolved_by uuid references auth.users (id) on delete set null,
  resolution_note text not null default '' check (length(resolution_note) <= 500)
);
-- At most one open/acknowledged request per part+location; repeats bump request_count.
create unique index restock_one_open_idx
  on public.restock_requests (part_id, coalesce(location_id, '00000000-0000-0000-0000-000000000000'::uuid))
  where status in ('open', 'acknowledged');

create table public.restock_submissions (
  requester_hash text not null,
  created_at timestamptz not null default now()
);
create index restock_submissions_idx on public.restock_submissions (requester_hash, created_at);

create table public.ai_requests (
  user_id uuid not null,
  created_at timestamptz not null default now()
);

create table public.inventory_events (
  id bigint generated always as identity primary key,
  part_id uuid references public.parts (id) on delete cascade,
  kind text not null,
  detail jsonb not null default '{}',
  actor uuid default auth.uid(),
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------- helpers & triggers

create or replace function public.is_staff()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.staff where user_id = auth.uid());
$$;

create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

create trigger parts_touch before update on public.parts for each row execute function public.touch_updated_at();
create trigger locations_touch before update on public.locations for each row execute function public.touch_updated_at();
create trigger stock_touch before update on public.stock for each row execute function public.touch_updated_at();
create trigger restock_touch before update on public.restock_requests for each row execute function public.touch_updated_at();

-- Keep counted stock consistent: a confirmed count of 0 is "out"; a positive count is never "out".
create or replace function public.stock_consistency()
returns trigger language plpgsql as $$
begin
  if new.quantity is not null then
    if new.quantity = 0 then
      new.status := 'out';
    elsif new.status in ('out', 'unverified') then
      new.status := 'in_stock';
    end if;
  end if;
  return new;
end $$;
create trigger stock_consistency before insert or update on public.stock
  for each row execute function public.stock_consistency();

-- ---------------------------------------------------------------- row level security

alter table public.staff enable row level security;
alter table public.categories enable row level security;
alter table public.locations enable row level security;
alter table public.parts enable row level security;
alter table public.part_photos enable row level security;
alter table public.stock enable row level security;
alter table public.restock_requests enable row level security;
alter table public.restock_submissions enable row level security;
alter table public.ai_requests enable row level security;
alter table public.inventory_events enable row level security;

create policy staff_read on public.staff for select using (user_id = auth.uid() or public.is_staff());
-- Staff membership is managed by an admin in the SQL editor / dashboard (see README).

create policy categories_read on public.categories for select using (true);
create policy categories_write on public.categories for all using (public.is_staff()) with check (public.is_staff());

create policy locations_read on public.locations for select using (true);
create policy locations_write on public.locations for all using (public.is_staff()) with check (public.is_staff());

create policy parts_read on public.parts for select using (published or public.is_staff());
create policy parts_write on public.parts for all using (public.is_staff()) with check (public.is_staff());

create policy part_photos_read on public.part_photos for select using (
  public.is_staff()
  or (published and exists (select 1 from public.parts p where p.id = part_id and p.published))
);
create policy part_photos_write on public.part_photos for all using (public.is_staff()) with check (public.is_staff());

create policy stock_read on public.stock for select using (
  public.is_staff() or exists (select 1 from public.parts p where p.id = part_id and p.published)
);
create policy stock_write on public.stock for all using (public.is_staff()) with check (public.is_staff());

-- Restock requests: staff only. The public submits through submit_restock_request().
create policy restock_staff_read on public.restock_requests for select using (public.is_staff());
create policy restock_staff_update on public.restock_requests for update using (public.is_staff()) with check (public.is_staff());
create policy restock_staff_delete on public.restock_requests for delete using (public.is_staff());

create policy events_staff on public.inventory_events for all using (public.is_staff()) with check (public.is_staff());
-- restock_submissions and ai_requests have no policies: only security-definer functions touch them.

revoke all on public.restock_requests from anon;
revoke all on public.restock_submissions from anon, authenticated;
revoke all on public.ai_requests from anon, authenticated;
revoke all on public.staff from anon;
revoke all on public.inventory_events from anon;

-- ---------------------------------------------------------------- RPCs

-- Public restock request: validates, rate-limits per client and globally, and merges duplicates.
create or replace function public.submit_restock_request(
  p_part_id uuid,
  p_location_id uuid default null,
  p_note text default '',
  p_requester_name text default '',
  p_requester_contact text default ''
) returns json
language plpgsql security definer set search_path = public as $$
declare
  v_headers json := nullif(current_setting('request.headers', true), '')::json;
  v_ip text := split_part(coalesce(v_headers ->> 'x-forwarded-for', v_headers ->> 'x-real-ip', 'unknown'), ',', 1);
  v_hash text := md5('hatchery-restock:' || trim(v_ip));
  v_id uuid;
  v_inserted boolean;
begin
  p_note := trim(coalesce(p_note, ''));
  p_requester_name := trim(coalesce(p_requester_name, ''));
  p_requester_contact := trim(coalesce(p_requester_contact, ''));

  if length(p_note) > 500 or length(p_requester_name) > 80 or length(p_requester_contact) > 120 then
    raise exception 'invalid_input: text too long';
  end if;
  if not exists (select 1 from parts where id = p_part_id and published) then
    raise exception 'invalid_input: unknown part';
  end if;
  if p_location_id is not null
     and not exists (select 1 from stock where part_id = p_part_id and location_id = p_location_id) then
    raise exception 'invalid_input: part is not stocked at that location';
  end if;

  if (select count(*) from restock_submissions
      where requester_hash = v_hash and created_at > now() - interval '10 minutes') >= 5
     or (select count(*) from restock_submissions where created_at > now() - interval '1 hour') >= 300 then
    raise exception 'rate_limited';
  end if;
  insert into restock_submissions (requester_hash) values (v_hash);
  delete from restock_submissions where created_at < now() - interval '1 day';

  insert into restock_requests (part_id, location_id, note, requester_name, requester_contact, requester_hash)
  values (p_part_id, p_location_id, p_note, p_requester_name, p_requester_contact, v_hash)
  on conflict (part_id, coalesce(location_id, '00000000-0000-0000-0000-000000000000'::uuid))
    where status in ('open', 'acknowledged')
  do update set
    request_count = restock_requests.request_count + 1,
    note = case when excluded.note <> '' and restock_requests.note = '' then excluded.note else restock_requests.note end
  returning id, (xmax = 0) into v_id, v_inserted;

  return json_build_object('id', v_id, 'status', case when v_inserted then 'created' else 'duplicate' end);
end $$;

revoke all on function public.submit_restock_request(uuid, uuid, text, text, text) from public;
grant execute on function public.submit_restock_request(uuid, uuid, text, text, text) to anon, authenticated;

-- Staff-only quota check for the AI edge function: 30 suggestions / 10 minutes / user.
create or replace function public.claim_ai_quota()
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_staff() then raise exception 'forbidden'; end if;
  if (select count(*) from ai_requests where user_id = auth.uid() and created_at > now() - interval '10 minutes') >= 30 then
    raise exception 'rate_limited';
  end if;
  insert into ai_requests (user_id) values (auth.uid());
end $$;
revoke all on function public.claim_ai_quota() from public, anon;
grant execute on function public.claim_ai_quota() to authenticated;

-- Move stock between locations. p_quantity NULL moves the whole entry (count or status).
create or replace function public.move_stock(p_part_id uuid, p_from uuid, p_to uuid, p_quantity int default null)
returns void language plpgsql security invoker set search_path = public as $$
declare
  src stock%rowtype;
  dst stock%rowtype;
begin
  if not public.is_staff() then raise exception 'forbidden'; end if;
  if p_from = p_to then raise exception 'invalid_input: same location'; end if;
  select * into src from stock where part_id = p_part_id and location_id = p_from for update;
  if not found then raise exception 'invalid_input: nothing stocked at source'; end if;
  select * into dst from stock where part_id = p_part_id and location_id = p_to for update;

  if p_quantity is null then
    if dst.id is null then
      update stock set location_id = p_to where id = src.id;
    else
      update stock set
        quantity = case when src.quantity is not null and dst.quantity is not null then src.quantity + dst.quantity else null end,
        status = case when src.quantity is not null and dst.quantity is not null then 'in_stock' else 'unverified' end,
        last_checked_at = greatest(src.last_checked_at, dst.last_checked_at)
      where id = dst.id;
      delete from stock where id = src.id;
    end if;
  else
    if src.quantity is null then raise exception 'invalid_input: source is not counted; move the whole entry'; end if;
    if p_quantity <= 0 or p_quantity > src.quantity then raise exception 'invalid_input: bad quantity'; end if;
    update stock set quantity = src.quantity - p_quantity, last_checked_at = now() where id = src.id;
    if dst.id is null then
      insert into stock (part_id, location_id, quantity, last_checked_at) values (p_part_id, p_to, p_quantity, now());
    elsif dst.quantity is null then
      update stock set status = 'in_stock', last_checked_at = now() where id = dst.id;
    else
      update stock set quantity = dst.quantity + p_quantity, last_checked_at = now() where id = dst.id;
    end if;
  end if;
  insert into inventory_events (part_id, kind, detail)
  values (p_part_id, 'move', json_build_object('from', p_from, 'to', p_to, 'quantity', p_quantity)::jsonb);
end $$;
revoke all on function public.move_stock(uuid, uuid, uuid, int) from public, anon;
grant execute on function public.move_stock(uuid, uuid, uuid, int) to authenticated;

-- Atomic CSV import. p_items: [{ part: {...}, category: "name", stock: [{location_id, quantity, status, last_checked_at, notes}] }]
-- part.id present => update that part; otherwise insert. All-or-nothing.
create or replace function public.import_inventory(p_items jsonb)
returns json language plpgsql security invoker set search_path = public as $$
declare
  item jsonb;
  s jsonb;
  v_part_id uuid;
  v_cat_id uuid;
  v_created int := 0;
  v_updated int := 0;
  v_stock int := 0;
begin
  if not public.is_staff() then raise exception 'forbidden'; end if;
  for item in select * from jsonb_array_elements(p_items) loop
    v_cat_id := null;
    if coalesce(item ->> 'category', '') <> '' then
      select id into v_cat_id from categories where lower(name) = lower(item ->> 'category');
      if v_cat_id is null then
        insert into categories (name, sort) values (item ->> 'category', 999) returning id into v_cat_id;
      end if;
    end if;

    v_part_id := nullif(item -> 'part' ->> 'id', '')::uuid;
    if v_part_id is null then
      insert into parts (name, category_id, value, part_number, manufacturer, package, aliases, description, datasheet_url, published)
      values (
        item -> 'part' ->> 'name', v_cat_id,
        coalesce(item -> 'part' ->> 'value', ''), coalesce(item -> 'part' ->> 'part_number', ''),
        coalesce(item -> 'part' ->> 'manufacturer', ''), coalesce(item -> 'part' ->> 'package', ''),
        coalesce(array(select jsonb_array_elements_text(item -> 'part' -> 'aliases')), '{}'),
        coalesce(item -> 'part' ->> 'description', ''), coalesce(item -> 'part' ->> 'datasheet_url', ''),
        coalesce((item -> 'part' ->> 'published')::boolean, false)
      ) returning id into v_part_id;
      v_created := v_created + 1;
    else
      update parts set
        name = item -> 'part' ->> 'name',
        category_id = coalesce(v_cat_id, category_id),
        value = coalesce(item -> 'part' ->> 'value', value),
        part_number = coalesce(item -> 'part' ->> 'part_number', part_number),
        manufacturer = coalesce(item -> 'part' ->> 'manufacturer', manufacturer),
        package = coalesce(item -> 'part' ->> 'package', package),
        aliases = coalesce(array(select jsonb_array_elements_text(item -> 'part' -> 'aliases')), aliases),
        description = coalesce(item -> 'part' ->> 'description', description),
        datasheet_url = coalesce(item -> 'part' ->> 'datasheet_url', datasheet_url),
        published = coalesce((item -> 'part' ->> 'published')::boolean, published)
      where id = v_part_id;
      if not found then raise exception 'invalid_input: part % not found', v_part_id; end if;
      v_updated := v_updated + 1;
    end if;

    for s in select * from jsonb_array_elements(coalesce(item -> 'stock', '[]'::jsonb)) loop
      insert into stock (part_id, location_id, quantity, status, last_checked_at, notes)
      values (
        v_part_id, (s ->> 'location_id')::uuid, (s ->> 'quantity')::int,
        coalesce(s ->> 'status', 'unverified'), (s ->> 'last_checked_at')::timestamptz, coalesce(s ->> 'notes', '')
      )
      on conflict (part_id, location_id) do update set
        quantity = excluded.quantity, status = excluded.status,
        last_checked_at = excluded.last_checked_at, notes = excluded.notes;
      v_stock := v_stock + 1;
    end loop;
  end loop;
  insert into inventory_events (kind, detail)
  values ('import', json_build_object('created', v_created, 'updated', v_updated, 'stock', v_stock)::jsonb);
  return json_build_object('created', v_created, 'updated', v_updated, 'stock', v_stock);
end $$;
revoke all on function public.import_inventory(jsonb) from public, anon;
grant execute on function public.import_inventory(jsonb) to authenticated;

-- ---------------------------------------------------------------- storage

-- `catalog` is public-read and holds only approved photos. `catalog-drafts` is private.
-- Paths: parts/<part_id>/<photo_id>/{full,thumb}.webp and locations/<location_id>/<photo_id>/{full,thumb}.webp
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('catalog', 'catalog', true, 2097152, array['image/webp', 'image/jpeg']),
  ('catalog-drafts', 'catalog-drafts', false, 2097152, array['image/webp', 'image/jpeg'])
on conflict (id) do nothing;

create policy catalog_staff_insert on storage.objects for insert to authenticated
  with check (bucket_id in ('catalog', 'catalog-drafts') and public.is_staff());
create policy catalog_staff_update on storage.objects for update to authenticated
  using (bucket_id in ('catalog', 'catalog-drafts') and public.is_staff());
create policy catalog_staff_delete on storage.objects for delete to authenticated
  using (bucket_id in ('catalog', 'catalog-drafts') and public.is_staff());
create policy catalog_staff_select on storage.objects for select to authenticated
  using (bucket_id in ('catalog', 'catalog-drafts') and public.is_staff());
-- Public reads of `catalog` go through the public bucket URL; no anon select policy, so the
-- bucket cannot be listed and drafts are never readable without a staff session.

-- ---------------------------------------------------------------- starter categories
-- Categories only (no parts, no locations): your team adds the real inventory.
insert into public.categories (name, sort) values
  ('Resistors', 10), ('Capacitors', 20), ('Diodes', 30), ('LEDs & Lighting', 40),
  ('Transistors', 50), ('ICs', 60), ('Microcontrollers', 70), ('Sensors', 80),
  ('Motors & Drivers', 90), ('Power', 100), ('Switches & Buttons', 110),
  ('Connectors', 120), ('Displays', 130), ('Audio', 140), ('Wireless', 150),
  ('Cables & Wire', 160), ('Tools & Misc', 170)
on conflict (name) do nothing;
