-- Auntie & Uncle marketplace foundation. Apply once via Supabase CLI.
-- Customer requests and private booking notes must never be exposed publicly.
create extension if not exists pgcrypto with schema extensions;
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table if not exists private.marketplace_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  granted_at timestamptz not null default now()
);
revoke all on private.marketplace_admins from public, anon, authenticated;

create or replace function private.is_marketplace_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from private.marketplace_admins where user_id = (select auth.uid()));
$$;
revoke all on function private.is_marketplace_admin() from public, anon, authenticated;
-- Policy invokers need EXECUTE permission even though the function is SECURITY DEFINER.
-- The function answers only whether the current JWT user is an administrator.
grant usage on schema private to anon, authenticated;
grant execute on function private.is_marketplace_admin() to anon, authenticated;

create table if not exists public.helper_profiles (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null unique default auth.uid() references auth.users(id) on delete cascade,
  display_name text not null check (char_length(btrim(display_name)) between 2 and 80),
  service text not null check (service in ('Cleaning','Childcare','Cooking','Gardening','Handyman','Moving & rearranging')),
  area text not null check (char_length(btrim(area)) between 2 and 80),
  hourly_rate numeric(10,2) not null check (hourly_rate between 1 and 100000),
  years_experience smallint not null default 0 check (years_experience between 0 and 70),
  bio text not null check (char_length(btrim(bio)) between 10 and 1000),
  status text not null default 'pending' check (status in ('pending','approved','rejected','suspended')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists helper_profiles_public_discovery on public.helper_profiles (service, area, hourly_rate) where status = 'approved';
create index if not exists helper_profiles_pending on public.helper_profiles (created_at) where status = 'pending';

-- On any change to public profile fields by its owner, approval is revoked and requires re-review.
create or replace function public.helper_before_write()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'UPDATE' then
    if new.display_name is distinct from old.display_name or new.service is distinct from old.service
      or new.area is distinct from old.area or new.hourly_rate is distinct from old.hourly_rate
      or new.years_experience is distinct from old.years_experience or new.bio is distinct from old.bio then
      if old.status = 'approved' then new.status := 'pending'; end if;
    end if;
    new.updated_at := now();
  end if;
  return new;
end;
$$;
revoke all on function public.helper_before_write() from public, anon, authenticated;
drop trigger if exists helper_before_write_trigger on public.helper_profiles;
create trigger helper_before_write_trigger before update on public.helper_profiles
for each row execute function public.helper_before_write();

alter table public.helper_profiles enable row level security;
create policy helper_public_and_owner_select on public.helper_profiles for select to anon, authenticated
using (status = 'approved' or owner_id = (select auth.uid()) or (select private.is_marketplace_admin()));
create policy helper_owner_apply on public.helper_profiles for insert to authenticated
with check (owner_id = (select auth.uid()) and status = 'pending');
create policy helper_owner_edit on public.helper_profiles for update to authenticated
using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));

revoke all on public.helper_profiles from public, anon, authenticated;
grant select on public.helper_profiles to anon, authenticated;
grant insert (display_name, service, area, hourly_rate, years_experience, bio) on public.helper_profiles to authenticated;
grant update (display_name, service, area, hourly_rate, years_experience, bio) on public.helper_profiles to authenticated;

create table if not exists public.bookings (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  helper_id uuid not null references public.helper_profiles(id) on delete restrict,
  service text not null check (service in ('Cleaning','Childcare','Cooking','Gardening','Handyman','Moving & rearranging')),
  frequency text not null default 'One-time help' check (frequency in ('One-time help','Weekly','Twice a week','Monthly','Not sure yet')),
  area text not null check (char_length(btrim(area)) between 2 and 80),
  preferred_date date not null,
  preferred_time time,
  estimated_hours numeric(4,1) check (estimated_hours between 1 and 24),
  details text not null check (char_length(btrim(details)) between 10 and 650),
  status text not null default 'pending' check (status in ('pending','accepted','declined','cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists bookings_customer_idx on public.bookings(customer_id, created_at desc);
create index if not exists bookings_helper_idx on public.bookings(helper_id, created_at desc);

create or replace function public.booking_before_insert()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if (select auth.uid()) is null then raise exception 'Sign in required'; end if;
  if new.customer_id <> (select auth.uid()) then raise exception 'Invalid customer'; end if;
  if new.preferred_date < current_date then raise exception 'Choose a current or future date'; end if;
  if not exists (
    select 1 from public.helper_profiles p
    where p.id = new.helper_id and p.service = new.service and p.status = 'approved'
  ) then raise exception 'This provider is unavailable for booking'; end if;
  return new;
end;
$$;
revoke all on function public.booking_before_insert() from public, anon, authenticated;
drop trigger if exists booking_before_insert_trigger on public.bookings;
create trigger booking_before_insert_trigger before insert on public.bookings
for each row execute function public.booking_before_insert();

alter table public.bookings enable row level security;
create policy bookings_participants_read on public.bookings for select to authenticated
using (
  customer_id = (select auth.uid())
  or exists (select 1 from public.helper_profiles p where p.id = helper_id and p.owner_id = (select auth.uid()))
  or (select private.is_marketplace_admin())
);
create policy bookings_customer_create on public.bookings for insert to authenticated
with check (customer_id = (select auth.uid()) and status = 'pending'
  and exists (select 1 from public.helper_profiles p where p.id = helper_id and p.service = bookings.service and p.status = 'approved'));
revoke all on public.bookings from public, anon, authenticated;
grant select on public.bookings to authenticated;
grant insert (helper_id, service, frequency, area, preferred_date, preferred_time, estimated_hours, details) on public.bookings to authenticated;

-- A helper can respond only to their own pending booking, via this narrow RPC.
create or replace function public.respond_to_booking(p_booking_id uuid, p_decision text)
returns text language plpgsql security definer set search_path = '' as $$
declare v_new_status text;
begin
  if (select auth.uid()) is null then raise exception 'Sign in required'; end if;
  if p_decision not in ('accepted','declined') then raise exception 'Invalid decision'; end if;
  update public.bookings b set status=p_decision, updated_at=now()
  where b.id = p_booking_id and b.status='pending'
    and exists (select 1 from public.helper_profiles p where p.id=b.helper_id
      and p.owner_id=(select auth.uid()) and p.status='approved')
  returning b.status into v_new_status;
  if v_new_status is null then raise exception 'Booking not found, unavailable or already decided'; end if;
  return v_new_status;
end;
$$;
revoke all on function public.respond_to_booking(uuid,text) from public, anon;
grant execute on function public.respond_to_booking(uuid,text) to authenticated;

create or replace function public.cancel_my_booking(p_booking_id uuid)
returns text language plpgsql security definer set search_path = '' as $$
declare v_new_status text;
begin
  if (select auth.uid()) is null then raise exception 'Sign in required'; end if;
  update public.bookings set status='cancelled',updated_at=now()
  where id=p_booking_id and customer_id=(select auth.uid()) and status in ('pending','accepted')
  returning status into v_new_status;
  if v_new_status is null then raise exception 'Booking cannot be cancelled'; end if;
  return v_new_status;
end;
$$;
revoke all on function public.cancel_my_booking(uuid) from public, anon;
grant execute on function public.cancel_my_booking(uuid) to authenticated;

-- Only manually designated admins may approve helpers. App users cannot self-approve.
create or replace function public.review_helper_application(p_helper_id uuid, p_new_status text)
returns text language plpgsql security definer set search_path = '' as $$
declare v_status text;
begin
  if not (select private.is_marketplace_admin()) then raise exception 'Administrator access required'; end if;
  if p_new_status not in ('approved','rejected','suspended','pending') then raise exception 'Invalid review status'; end if;
  update public.helper_profiles set status=p_new_status where id=p_helper_id returning status into v_status;
  if v_status is null then raise exception 'Helper application not found'; end if;
  return v_status;
end;
$$;
revoke all on function public.review_helper_application(uuid,text) from public, anon;
grant execute on function public.review_helper_application(uuid,text) to authenticated;

-- Admin status can be queried only for the signed-in caller, never enumerated.
create or replace function public.am_i_marketplace_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((select private.is_marketplace_admin()), false);
$$;
revoke all on function public.am_i_marketplace_admin() from public, anon;
grant execute on function public.am_i_marketplace_admin() to authenticated;
