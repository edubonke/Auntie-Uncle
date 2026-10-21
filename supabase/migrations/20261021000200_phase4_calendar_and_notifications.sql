-- Phase 4, v1: whole-day availability and private in-app activity notifications.
-- Apply ONCE in Supabase SQL Editor AFTER the original marketplace foundation.
-- Safe additive migration: no reset, no deletion or modification of bookings.
-- Existing bookings are retained even if a helper later blocks their date.
begin;

create table if not exists public.helper_unavailable_dates (
  id uuid primary key default gen_random_uuid(),
  helper_id uuid not null references public.helper_profiles(id) on delete cascade,
  unavailable_date date not null,
  created_at timestamptz not null default now(),
  constraint helper_unavailable_unique unique (helper_id, unavailable_date)
);
create index if not exists helper_unavailable_date_lookup on public.helper_unavailable_dates (unavailable_date, helper_id);

alter table public.helper_unavailable_dates enable row level security;
create policy availability_read on public.helper_unavailable_dates
for select to anon, authenticated
using (exists (
  select 1 from public.helper_profiles p
  where p.id = helper_id and
    (p.status='approved' or p.owner_id=(select auth.uid()) or (select private.is_marketplace_admin()))
));
create policy availability_owner_add on public.helper_unavailable_dates
for insert to authenticated
with check (
  unavailable_date >= current_date and
  exists (select 1 from public.helper_profiles p where p.id=helper_id and p.owner_id=(select auth.uid()))
);
create policy availability_owner_remove on public.helper_unavailable_dates
for delete to authenticated
using (exists (
  select 1 from public.helper_profiles p where p.id=helper_id and p.owner_id=(select auth.uid())
));
revoke all on public.helper_unavailable_dates from public, anon, authenticated;
grant select on public.helper_unavailable_dates to anon, authenticated;
grant insert (helper_id, unavailable_date) on public.helper_unavailable_dates to authenticated;
grant delete on public.helper_unavailable_dates to authenticated;

-- Additional guard alongside the original booking_before_insert_trigger.
-- This checks the latest stored blackout during insert; it does not affect existing bookings.
create or replace function public.reject_blocked_booking_day()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if exists (
    select 1 from public.helper_unavailable_dates a
    where a.helper_id=new.helper_id and a.unavailable_date=new.preferred_date
  ) then
    raise exception 'Helper unavailable on selected date' using errcode='P0001';
  end if;
  return new;
end;
$$;
revoke all on function public.reject_blocked_booking_day() from public, anon, authenticated;
create trigger booking_day_availability_guard before insert on public.bookings
for each row execute function public.reject_blocked_booking_day();

create table if not exists public.account_notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  booking_id uuid references public.bookings(id) on delete set null,
  kind text not null check (kind in (
    'booking_requested','booking_accepted','booking_declined','booking_cancelled',
    'helper_pending','helper_approved','helper_rejected','helper_suspended'
  )),
  title text not null check(char_length(title) between 3 and 100),
  body text not null check(char_length(body) between 3 and 400),
  created_at timestamptz not null default now(),
  read_at timestamptz
);
create index if not exists account_notifications_user_order on public.account_notifications (user_id, created_at desc);

alter table public.account_notifications enable row level security;
create policy notifications_read_own on public.account_notifications
for select to authenticated using (user_id=(select auth.uid()));
create policy notifications_mark_own on public.account_notifications
for update to authenticated
using (user_id=(select auth.uid())) with check (user_id=(select auth.uid()));
revoke all on public.account_notifications from public, anon, authenticated;
grant select on public.account_notifications to authenticated;
grant update (read_at) on public.account_notifications to authenticated;
-- No direct insert grants: trusted triggers alone create notifications.

create or replace function public.notify_booking_change()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_helper_user uuid;
begin
  select p.owner_id into v_helper_user from public.helper_profiles p where p.id=new.helper_id;
  if tg_op='INSERT' then
    if v_helper_user is not null then
      insert into public.account_notifications(user_id,booking_id,kind,title,body)
      values (v_helper_user,new.id,'booking_requested','New booking request',
              'A customer has sent you a request. Open Helper workspace to respond.');
    end if;
  elsif new.status is distinct from old.status then
    if new.status='accepted' then
      insert into public.account_notifications(user_id,booking_id,kind,title,body)
      values (new.customer_id,new.id,'booking_accepted','Booking request accepted',
              'The helper accepted your request. Review the details in My bookings.');
    elsif new.status='declined' then
      insert into public.account_notifications(user_id,booking_id,kind,title,body)
      values (new.customer_id,new.id,'booking_declined','Booking request declined',
              'The helper declined your request. You can browse other helpers.');
    elsif new.status='cancelled' and v_helper_user is not null then
      insert into public.account_notifications(user_id,booking_id,kind,title,body)
      values (v_helper_user,new.id,'booking_cancelled','Customer cancelled a booking',
              'A customer cancelled a request. Check your Helper workspace.');
    end if;
  end if;
  return null;
end;
$$;
revoke all on function public.notify_booking_change() from public, anon, authenticated;
create trigger booking_activity_notification
after insert or update of status on public.bookings
for each row execute function public.notify_booking_change();

create or replace function public.notify_helper_review()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op='INSERT' then
    insert into public.account_notifications(user_id,kind,title,body)
    select a.user_id,'helper_pending','Helper application to review',
      'A helper application is awaiting review in Administration.'
    from private.marketplace_admins a;
  elsif new.status='pending' and old.status is distinct from new.status then
    insert into public.account_notifications(user_id,kind,title,body)
    select a.user_id,'helper_pending','Helper application to review',
      'A helper application is awaiting review in Administration.'
    from private.marketplace_admins a;
  end if;

  if tg_op='UPDATE' then
   if new.status is distinct from old.status then
    if new.status='approved' then
      insert into public.account_notifications(user_id,kind,title,body)
      values(new.owner_id,'helper_approved','Helper listing approved',
             'Your profile is approved and can appear in public helper search.');
    elsif new.status='rejected' then
      insert into public.account_notifications(user_id,kind,title,body)
      values(new.owner_id,'helper_rejected','Helper application rejected',
             'Your helper application was not approved. Contact the marketplace team.');
    elsif new.status='suspended' then
      insert into public.account_notifications(user_id,kind,title,body)
      values(new.owner_id,'helper_suspended','Helper listing suspended',
             'Your helper listing is no longer shown publicly.');
    elsif new.status='pending' then
      insert into public.account_notifications(user_id,kind,title,body)
      values(new.owner_id,'helper_pending','Profile awaiting review',
             'Your profile is awaiting administrator review.');
    end if;
   end if;
  end if;
  return null;
end;
$;
revoke all on function public.notify_helper_review() from public, anon, authenticated;
create trigger helper_activity_notification
after insert or update of status on public.helper_profiles
for each row execute function public.notify_helper_review();
commit;
