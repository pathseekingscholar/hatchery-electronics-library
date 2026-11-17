-- Community posts (moderated) and "Request a part" for parts not in the catalog.

-- Shared rate limit for every public submission (restock, part request, community post):
-- 5 per client per 10 minutes, 300 per hour overall. Returns the client hash.
create or replace function public.claim_public_submission()
returns text language plpgsql security definer set search_path = public as $$
declare
  v_headers json := nullif(current_setting('request.headers', true), '')::json;
  v_ip text := split_part(coalesce(v_headers ->> 'x-forwarded-for', v_headers ->> 'x-real-ip', 'unknown'), ',', 1);
  v_hash text := md5('hatchery-restock:' || trim(v_ip));
begin
  if (select count(*) from restock_submissions
      where requester_hash = v_hash and created_at > now() - interval '10 minutes') >= 5
     or (select count(*) from restock_submissions where created_at > now() - interval '1 hour') >= 300 then
    raise exception 'rate_limited';
  end if;
  insert into restock_submissions (requester_hash) values (v_hash);
  return v_hash;
end $$;
revoke all on function public.claim_public_submission() from public, anon, authenticated;

-- ---------------------------------------------------------------- part requests

alter table public.restock_requests alter column part_id drop not null;
alter table public.restock_requests
  add column requested_part text not null default '' check (length(requested_part) <= 120);
alter table public.restock_requests
  add constraint restock_target check (part_id is not null or requested_part <> '');
create unique index part_request_one_open_idx
  on public.restock_requests (lower(requested_part))
  where part_id is null and status in ('open', 'acknowledged');

create or replace function public.submit_part_request(
  p_requested_part text,
  p_note text default '',
  p_requester_name text default '',
  p_requester_contact text default ''
) returns json
language plpgsql security definer set search_path = public as $$
declare
  v_hash text;
  v_id uuid;
  v_inserted boolean;
begin
  p_requested_part := trim(regexp_replace(coalesce(p_requested_part, ''), '\s+', ' ', 'g'));
  p_note := trim(coalesce(p_note, ''));
  p_requester_name := trim(coalesce(p_requester_name, ''));
  p_requester_contact := trim(coalesce(p_requester_contact, ''));
  if length(p_requested_part) < 2 or length(p_requested_part) > 120 then
    raise exception 'invalid_input: describe the part in 2–120 characters';
  end if;
  if length(p_note) > 500 or length(p_requester_name) > 80 or length(p_requester_contact) > 120 then
    raise exception 'invalid_input: text too long';
  end if;
  v_hash := public.claim_public_submission();

  insert into restock_requests (part_id, requested_part, note, requester_name, requester_contact, requester_hash)
  values (null, p_requested_part, p_note, p_requester_name, p_requester_contact, v_hash)
  on conflict (lower(requested_part)) where part_id is null and status in ('open', 'acknowledged')
  do update set request_count = restock_requests.request_count + 1
  returning id, (xmax = 0) into v_id, v_inserted;

  return json_build_object('id', v_id, 'status', case when v_inserted then 'created' else 'duplicate' end);
end $$;
revoke all on function public.submit_part_request(text, text, text, text) from public;
grant execute on function public.submit_part_request(text, text, text, text) to anon, authenticated;

-- ---------------------------------------------------------------- community

-- Posts are private until a staff member approves them.
create table public.community_posts (
  id uuid primary key default gen_random_uuid(),
  kind text not null default 'project' check (kind in ('project', 'question', 'tip')),
  title text not null check (length(title) between 3 and 120),
  body text not null check (length(body) between 1 and 4000),
  author_name text not null default '' check (length(author_name) <= 80),
  status text not null default 'pending' check (status in ('pending', 'approved', 'hidden')),
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references auth.users (id) on delete set null
);
create index community_posts_status_idx on public.community_posts (status, created_at desc);

alter table public.community_posts enable row level security;
create policy community_read on public.community_posts for select using (status = 'approved' or public.is_staff());
create policy community_staff_update on public.community_posts for update using (public.is_staff()) with check (public.is_staff());
create policy community_staff_delete on public.community_posts for delete using (public.is_staff());
-- No insert policy: the public posts through submit_community_post().

create or replace function public.submit_community_post(
  p_kind text,
  p_title text,
  p_body text,
  p_author_name text default ''
) returns json
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
begin
  p_title := trim(coalesce(p_title, ''));
  p_body := trim(coalesce(p_body, ''));
  p_author_name := trim(coalesce(p_author_name, ''));
  if p_kind not in ('project', 'question', 'tip') then raise exception 'invalid_input: unknown post type'; end if;
  if length(p_title) < 3 or length(p_title) > 120 then raise exception 'invalid_input: title must be 3–120 characters'; end if;
  if length(p_body) < 1 or length(p_body) > 4000 then raise exception 'invalid_input: post must be 1–4000 characters'; end if;
  if length(p_author_name) > 80 then raise exception 'invalid_input: name too long'; end if;
  perform public.claim_public_submission();
  insert into community_posts (kind, title, body, author_name) values (p_kind, p_title, p_body, p_author_name)
  returning id into v_id;
  return json_build_object('id', v_id, 'status', 'pending');
end $$;
revoke all on function public.submit_community_post(text, text, text, text) from public;
grant execute on function public.submit_community_post(text, text, text, text) to anon, authenticated;
