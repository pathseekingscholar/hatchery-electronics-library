-- Catalog states: the photo inventory is live immediately; people verify it over time.
--   needs_review  from the photos (or otherwise unconfirmed); visible unless unidentifiable.
--                 review_reasons lists specific concerns (low confidence, uncertain drawer, …)
--   verified      a staff member physically checked it (never set automatically)
--   rejected      wrong / not there / merged away (kept for audit, never shown)

alter table public.parts drop constraint parts_publish_requires_verified;
alter table public.parts drop constraint if exists parts_review_status_check;

update public.parts
set review_status = 'needs_review'
where review_status = 'draft';

alter table public.parts add constraint parts_review_status_check
  check (review_status in ('needs_review', 'verified', 'rejected'));
alter table public.parts add constraint parts_publish_not_rejected check (not published or review_status <> 'rejected');
alter table public.parts add column review_reasons text[] not null default '{}';

-- ---------------------------------------------------------------- audit trail for staff corrections

create or replace function public.parts_audit()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  changes jsonb := '{}';
  k text;
begin
  foreach k in array array['name', 'category_id', 'value', 'part_number', 'manufacturer', 'package', 'aliases',
                           'description', 'datasheet_url', 'published', 'item_type', 'review_status'] loop
    if to_jsonb(old) -> k is distinct from to_jsonb(new) -> k then
      changes := changes || jsonb_build_object(k, jsonb_build_object('from', to_jsonb(old) -> k, 'to', to_jsonb(new) -> k));
    end if;
  end loop;
  if changes <> '{}' then
    insert into inventory_events (part_id, kind, detail, actor) values (new.id, 'edit', changes, auth.uid());
  end if;
  return new;
end $$;
create trigger parts_audit after update on public.parts for each row execute function public.parts_audit();

create or replace function public.stock_audit()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' and (old.quantity is distinct from new.quantity or old.status is distinct from new.status or old.location_id is distinct from new.location_id) then
    insert into inventory_events (part_id, kind, detail, actor) values (new.part_id, 'stock',
      jsonb_build_object('location_from', old.location_id, 'location_to', new.location_id,
        'quantity_from', old.quantity, 'quantity_to', new.quantity, 'status_from', old.status, 'status_to', new.status), auth.uid());
  end if;
  return new;
end $$;
create trigger stock_audit after update on public.stock for each row execute function public.stock_audit();

-- ---------------------------------------------------------------- import: publish immediately

-- Same contract as before (idempotent on draft_id, locations on code), but records go live as
-- Needs Review. Records staff already verified, rejected or edited by hand are never
-- overwritten. A record marked duplicate_of adds its location to the earlier record instead.
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
  v_new_locs int := 0;
  v_new_parts int := 0;
  v_dedup int := 0;
  v_existing int := 0;
  v_target text;
begin
  if not public.is_staff() then raise exception 'forbidden'; end if;

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
    v_target := coalesce(it ->> 'duplicate_of', it ->> 'draft_id');
    select id into v_part from parts
      where evidence ->> 'draft_id' = v_target or evidence -> 'also_seen' ? v_target
      limit 1;
    if it ->> 'duplicate_of' is not null then
      if v_part is null then
        -- the record it duplicates isn't loaded yet; treat it as its own record
        v_target := it ->> 'draft_id';
      else
        update parts set evidence = jsonb_set(evidence, '{also_seen}',
          coalesce(evidence -> 'also_seen', '[]') || to_jsonb(it ->> 'draft_id')) where id = v_part and not (coalesce(evidence -> 'also_seen', '[]') ? (it ->> 'draft_id'));
        v_dedup := v_dedup + 1;
      end if;
    end if;
    if v_part is null then
      select id into v_cat from categories where lower(name) = lower(it ->> 'category');
      insert into parts (name, category_id, part_number, manufacturer, description, item_type, review_status, review_reasons, published, evidence)
      values (left(it ->> 'name', 120), v_cat, coalesce(it ->> 'part_number', ''), coalesce(it ->> 'manufacturer', ''),
              coalesce(it ->> 'description', ''), it ->> 'item_type', it ->> 'catalog_status',
              coalesce(array(select jsonb_array_elements_text(it -> 'review_reasons')), '{}'),
              coalesce((it ->> 'searchable')::boolean, true),
              jsonb_build_object('draft_id', it ->> 'draft_id', 'confidence', it -> 'identification_confidence',
                'label_text', it -> 'label_text', 'photos', it -> 'source_images', 'visible_qty', it -> 'quantity' -> 'visible_in_photo',
                'qty_note', it -> 'quantity' -> 'note', 'container', it -> 'location' -> 'container', 'is_assortment', it -> 'is_assortment',
                'contents_unknown', it -> 'contents_unknown', 'possible_duplicate_of', it -> 'possible_duplicate_of',
                'specifications', it -> 'specifications', 'snapshot', p_draft -> 'snapshot', 'also_seen', '[]'::jsonb))
      returning id into v_part;
      v_new_parts := v_new_parts + 1;
    elsif it ->> 'duplicate_of' is null then
      v_existing := v_existing + 1;
    end if;
    -- most specific known location; stock starts Unverified with no count
    insert into stock (part_id, location_id, quantity, status, notes)
    values (v_part, (v_loc_ids ->> (it -> 'location' ->> 'id'))::uuid, null, 'unverified', left(coalesce(it -> 'location' ->> 'container', ''), 300))
    on conflict (part_id, location_id) do nothing;
  end loop;

  insert into inventory_events (kind, detail)
  values ('photo_inventory_import', jsonb_build_object('locations', v_new_locs, 'parts', v_new_parts, 'deduplicated', v_dedup, 'already_present', v_existing));
  return json_build_object('locations', v_new_locs, 'parts', v_new_parts, 'deduplicated', v_dedup, 'already_present', v_existing);
end $$;
