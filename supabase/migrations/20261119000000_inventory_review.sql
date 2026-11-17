-- Photo-inventory review workflow: draft → staff-verified → published, with evidence and audit trail.

-- ---------------------------------------------------------------- parts

alter table public.parts
  add column item_type text not null default 'component'
    check (item_type in ('component', 'module', 'assortment', 'kit', 'tool', 'consumable', 'equipment', 'container')),
  add column review_status text not null default 'draft' check (review_status in ('draft', 'verified', 'rejected')),
  add column evidence jsonb not null default '{}',   -- draft_id, confidence, label_text, source photos, visible qty, notes
  add column verified_at timestamptz,
  add column verified_by uuid references auth.users (id) on delete set null,
  add column merged_into uuid references public.parts (id) on delete set null;

-- Anything already in the catalog was entered by staff by hand: treat it as verified.
update public.parts set review_status = 'verified', verified_at = coalesce(updated_at, now());

-- Only verified parts can be public.
alter table public.parts add constraint parts_publish_requires_verified check (not published or review_status = 'verified');

create unique index parts_draft_id_idx on public.parts ((evidence ->> 'draft_id')) where evidence ? 'draft_id';

-- Verifying stamps who/when (cannot be faked from the client).
create or replace function public.parts_review_stamp()
returns trigger language plpgsql as $$
begin
  if new.review_status = 'verified' and (tg_op = 'INSERT' or old.review_status is distinct from 'verified') then
    new.verified_at := now();
    new.verified_by := auth.uid();
  elsif new.review_status <> 'verified' then
    new.verified_at := null;
    new.verified_by := null;
  end if;
  return new;
end $$;
create trigger parts_review_stamp before insert or update of review_status on public.parts
  for each row execute function public.parts_review_stamp();

-- ---------------------------------------------------------------- locations

alter table public.locations
  add column reviewed_at timestamptz,
  add column reviewed_by uuid references auth.users (id) on delete set null;

-- Photo evidence and reviewer notes per location: staff only (students never see it).
create table public.location_evidence (
  location_id uuid primary key references public.locations (id) on delete cascade,
  evidence jsonb not null default '{}'   -- draft_id, front_label, observed_state, photos, opportunities
);
alter table public.location_evidence enable row level security;
create policy location_evidence_staff on public.location_evidence for all using (public.is_staff()) with check (public.is_staff());
revoke all on public.location_evidence from anon;

-- ---------------------------------------------------------------- stock

alter table public.stock add column checked_by uuid references auth.users (id) on delete set null;

create or replace function public.stock_checked_stamp()
returns trigger language plpgsql as $$
begin
  if tg_op = 'INSERT' or new.last_checked_at is distinct from old.last_checked_at then
    new.checked_by := auth.uid();
  end if;
  return new;
end $$;
create trigger stock_checked_stamp before insert or update on public.stock
  for each row execute function public.stock_checked_stamp();

-- Staff can see each other's display names (for "checked by" / "verified by").
create policy profiles_staff_read on public.profiles for select using (public.is_staff());

-- ---------------------------------------------------------------- RPCs

-- Mark a drawer (or any location) as checked/reviewed now.
create or replace function public.mark_location_reviewed(p_location_id uuid)
returns void language plpgsql security invoker set search_path = public as $$
begin
  if not public.is_staff() then raise exception 'forbidden'; end if;
  update locations set reviewed_at = now(), reviewed_by = auth.uid() where id = p_location_id;
  if not found then raise exception 'invalid_input: unknown location'; end if;
end $$;
revoke all on function public.mark_location_reviewed(uuid) from public, anon;
grant execute on function public.mark_location_reviewed(uuid) to authenticated;

-- Merge a duplicate (p_from) into the record to keep (p_into): stock, photos and requests move over.
create or replace function public.merge_parts(p_from uuid, p_into uuid)
returns void language plpgsql security invoker set search_path = public as $$
declare
  s record;
begin
  if not public.is_staff() then raise exception 'forbidden'; end if;
  if p_from = p_into then raise exception 'invalid_input: pick a different part'; end if;
  if not exists (select 1 from parts where id = p_into and review_status <> 'rejected') then
    raise exception 'invalid_input: target part not found';
  end if;
  for s in select * from stock where part_id = p_from loop
    if exists (select 1 from stock where part_id = p_into and location_id = s.location_id) then
      update stock t set
        quantity = case when t.quantity is not null and s.quantity is not null then t.quantity + s.quantity else coalesce(t.quantity, s.quantity) end,
        notes = trim(both ' ' from t.notes || case when s.notes <> '' and s.notes <> t.notes then ' / ' || s.notes else '' end)
      where t.part_id = p_into and t.location_id = s.location_id;
      delete from stock where id = s.id;
    else
      update stock set part_id = p_into where id = s.id;
    end if;
  end loop;
  update part_photos set part_id = p_into, is_primary = false where part_id = p_from;
  update restock_requests set part_id = p_into where part_id = p_from and status not in ('open', 'acknowledged');
  delete from restock_requests where part_id = p_from;
  update parts set
    review_status = 'rejected', published = false, merged_into = p_into,
    evidence = evidence || jsonb_build_object('merged_into', p_into)
  where id = p_from;
  insert into inventory_events (part_id, kind, detail) values (p_into, 'merge', jsonb_build_object('from', p_from));
end $$;
revoke all on function public.merge_parts(uuid, uuid) from public, anon;
grant execute on function public.merge_parts(uuid, uuid) to authenticated;

-- Load the photo draft (inventory/inventory-draft.json). Idempotent: locations match on code,
-- parts on evidence.draft_id. Never overwrites a part staff already verified or rejected.
create or replace function public.import_photo_draft(p_draft jsonb)
returns json language plpgsql security invoker set search_path = public as $$
declare
  l jsonb;
  it jsonb;
  v_loc_ids jsonb := '{}';
  v_id uuid;
  v_parent uuid;
  v_cat uuid;
  v_part uuid;
  v_status text;
  v_new_locs int := 0;
  v_new_parts int := 0;
  v_skipped int := 0;
begin
  if not public.is_staff() then raise exception 'forbidden'; end if;

  -- locations are listed parent-first
  for l in select * from jsonb_array_elements(p_draft -> 'locations') loop
    v_parent := case when l ->> 'parent_id' is null then null else (v_loc_ids ->> (l ->> 'parent_id'))::uuid end;
    select id into v_id from locations where code = l ->> 'code';
    if v_id is null then
      insert into locations (parent_id, kind, name, code, sort)
      values (v_parent, l ->> 'kind', left(l ->> 'name', 80), l ->> 'code', coalesce((l ->> 'order')::int, 0))
      returning id into v_id;
      v_new_locs := v_new_locs + 1;
    end if;
    insert into location_evidence (location_id, evidence)
    values (v_id, jsonb_build_object('draft_id', l ->> 'id', 'front_label', l -> 'front_label', 'observed_state', l -> 'observed_state',
            'confidence', l -> 'identification_confidence', 'photos', l -> 'source_images', 'opportunities', coalesce(l -> 'opportunities', '[]')))
    on conflict (location_id) do update set evidence = location_evidence.evidence || excluded.evidence;
    v_loc_ids := v_loc_ids || jsonb_build_object(l ->> 'id', v_id);
  end loop;

  for it in select * from jsonb_array_elements(p_draft -> 'items') loop
    select id, review_status into v_part, v_status from parts where evidence ->> 'draft_id' = it ->> 'draft_id';
    if v_part is not null and v_status <> 'draft' then
      v_skipped := v_skipped + 1;
      continue;
    end if;
    select id into v_cat from categories where lower(name) = lower(it ->> 'category');
    if v_part is null then
      insert into parts (name, category_id, part_number, manufacturer, description, item_type, review_status, published, evidence)
      values (left(it ->> 'name', 120), v_cat, coalesce(it ->> 'part_number', ''), coalesce(it ->> 'manufacturer', ''),
              coalesce(it ->> 'description', ''), it ->> 'item_type', 'draft', false,
              jsonb_build_object('draft_id', it ->> 'draft_id', 'confidence', it -> 'identification_confidence',
                'label_text', it -> 'label_text', 'photos', it -> 'source_images', 'visible_qty', it -> 'quantity' -> 'visible_in_photo',
                'qty_note', it -> 'quantity' -> 'note', 'container', it -> 'location' -> 'container', 'is_assortment', it -> 'is_assortment',
                'contents_unknown', it -> 'contents_unknown', 'possible_duplicate_of', it -> 'possible_duplicate_of',
                'specifications', it -> 'specifications', 'snapshot', p_draft -> 'snapshot'))
      returning id into v_part;
      v_new_parts := v_new_parts + 1;
    end if;
    insert into stock (part_id, location_id, quantity, status, notes)
    values (v_part, (v_loc_ids ->> (it -> 'location' ->> 'id'))::uuid, null, 'unverified', left(coalesce(it -> 'location' ->> 'container', ''), 300))
    on conflict (part_id, location_id) do nothing;
  end loop;

  insert into inventory_events (kind, detail)
  values ('photo_draft_import', jsonb_build_object('locations', v_new_locs, 'parts', v_new_parts, 'skipped_reviewed', v_skipped));
  return json_build_object('locations', v_new_locs, 'parts', v_new_parts, 'skipped_reviewed', v_skipped);
end $$;
revoke all on function public.import_photo_draft(jsonb) from public, anon;
grant execute on function public.import_photo_draft(jsonb) to authenticated;

-- Staff-entered parts (editor, CSV import) count as verified; only the photo draft creates drafts.
alter table public.parts alter column review_status set default 'verified';
