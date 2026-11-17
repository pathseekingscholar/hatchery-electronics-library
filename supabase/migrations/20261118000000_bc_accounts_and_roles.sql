-- BC accounts: anyone with a confirmed @bc.edu email can sign in (email one-time code).
-- Signed-in members can post to Community; admins promote members to staff/admin.

-- ---------------------------------------------------------------- email rule

create or replace function public.is_allowed_email(p_email text)
returns boolean language sql immutable as $$
  select lower(coalesce(p_email, '')) ~ '^[^@\s]+@bc\.edu$'
$$;

-- Reject any account (or email change) that isn't @bc.edu, no matter how it was created.
create or replace function public.enforce_bc_email()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not public.is_allowed_email(new.email) then
    raise exception 'Only @bc.edu email addresses can create an account';
  end if;
  return new;
end $$;

create trigger enforce_bc_email_insert before insert on auth.users
  for each row execute function public.enforce_bc_email();
create trigger enforce_bc_email_update before update of email on auth.users
  for each row when (new.email is distinct from old.email) execute function public.enforce_bc_email();

-- ---------------------------------------------------------------- profiles

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  display_name text not null default '' check (length(display_name) <= 60),
  created_at timestamptz not null default now()
);

create or replace function public.create_profile()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, display_name)
  values (new.id, lower(new.email), split_part(new.email, '@', 1))
  on conflict (id) do update set email = excluded.email;
  return new;
end $$;
create trigger create_profile_after_insert after insert on auth.users
  for each row execute function public.create_profile();
create trigger create_profile_after_email after update of email on auth.users
  for each row when (new.email is distinct from old.email) execute function public.create_profile();

insert into public.profiles (id, email, display_name)
select id, lower(email), split_part(email, '@', 1) from auth.users where email is not null
on conflict (id) do nothing;

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.staff where user_id = auth.uid() and role = 'admin');
$$;

-- A member = signed in, email confirmed, and @bc.edu.
create or replace function public.is_member()
returns boolean language sql stable security definer set search_path = public, auth as $$
  select exists (
    select 1 from auth.users u
    where u.id = auth.uid() and u.email_confirmed_at is not null and public.is_allowed_email(u.email)
  );
$$;

alter table public.profiles enable row level security;
create policy profiles_read on public.profiles for select using (id = auth.uid() or public.is_admin());
create policy profiles_update_self on public.profiles for update using (id = auth.uid()) with check (id = auth.uid());
revoke all on public.profiles from anon;
revoke insert, update, delete on public.profiles from authenticated;
grant update (display_name) on public.profiles to authenticated;

-- ---------------------------------------------------------------- roles

-- Only admins change roles. 'member' removes staff access.
create or replace function public.set_member_role(p_user_id uuid, p_role text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  if p_role not in ('member', 'staff', 'admin') then raise exception 'invalid_input: unknown role'; end if;
  if p_user_id = auth.uid() and p_role <> 'admin' then
    raise exception 'invalid_input: you can''t remove your own admin access';
  end if;
  if not exists (select 1 from public.profiles where id = p_user_id) then
    raise exception 'invalid_input: unknown account';
  end if;
  if p_role = 'member' then
    delete from public.staff where user_id = p_user_id;
  else
    insert into public.staff (user_id, display_name, role)
    select id, display_name, p_role from public.profiles where id = p_user_id
    on conflict (user_id) do update set role = excluded.role;
  end if;
end $$;
revoke all on function public.set_member_role(uuid, text) from public, anon;
grant execute on function public.set_member_role(uuid, text) to authenticated;

-- ---------------------------------------------------------------- community: sign-in to post

alter table public.community_posts add column author_id uuid references auth.users (id) on delete set null;

-- author_id stays private: the public can read only these columns.
revoke select on public.community_posts from anon, authenticated;
grant select (id, kind, title, body, author_name, status, created_at) on public.community_posts to anon, authenticated;

drop policy community_read on public.community_posts;
create policy community_read on public.community_posts for select
  using (status = 'approved' or public.is_staff() or author_id = auth.uid());

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
  if not public.is_member() then
    raise exception 'auth_required: sign in with your BC email to post';
  end if;
  p_title := trim(coalesce(p_title, ''));
  p_body := trim(coalesce(p_body, ''));
  p_author_name := trim(coalesce(p_author_name, ''));
  if p_kind not in ('project', 'question', 'tip') then raise exception 'invalid_input: unknown post type'; end if;
  if length(p_title) < 3 or length(p_title) > 120 then raise exception 'invalid_input: title must be 3–120 characters'; end if;
  if length(p_body) < 1 or length(p_body) > 4000 then raise exception 'invalid_input: post must be 1–4000 characters'; end if;
  if length(p_author_name) > 80 then raise exception 'invalid_input: name too long'; end if;
  if (select count(*) from community_posts where author_id = auth.uid() and created_at > now() - interval '1 hour') >= 5 then
    raise exception 'rate_limited';
  end if;
  perform public.claim_public_submission();
  insert into community_posts (kind, title, body, author_name, author_id)
  values (p_kind, p_title, p_body, p_author_name, auth.uid())
  returning id into v_id;
  return json_build_object('id', v_id, 'status', 'pending');
end $$;
revoke all on function public.submit_community_post(text, text, text, text) from public, anon;
grant execute on function public.submit_community_post(text, text, text, text) to authenticated;
