-- Auntie & Uncle Phase 5A: fixed time slots + customer-requested rescheduling.
-- Prerequisite: marketplace foundation and Phase 4 migrations already applied.
-- Browser-only activation: run this entire script ONCE in Supabase SQL Editor.
-- No existing booking rows are deleted, and legacy bookings retain their original data.
begin;
set local search_path = public, extensions;
create extension if not exists btree_gist with schema extensions;

alter table public.bookings add column if not exists slot_start_at timestamptz;
alter table public.bookings add column if not exists slot_end_at timestamptz;
alter table public.bookings add constraint booking_slot_pair_check check (
  (slot_start_at is null and slot_end_at is null) or
  (slot_start_at is not null and slot_end_at is not null and slot_end_at > slot_start_at)
);
-- Database exclusion constraint, not a client-only conflict check. Concurrent accepts
-- for overlapping time ranges belonging to the same helper cannot both commit.
-- Existing legacy bookings with no slot_start_at are intentionally not rewritten.
alter table public.bookings add constraint booking_accepted_no_overlap
  exclude using gist (helper_id with =, tstzrange(slot_start_at, slot_end_at, '[)') with &&)
  where (status='accepted' and slot_start_at is not null and slot_end_at is not null);

create or replace function public.booking_slot_guard()
returns trigger language plpgsql security definer set search_path = '' as $phase5$
declare
  v_recompute boolean := false;
  v_start timestamptz;
  v_end timestamptz;
begin
  if tg_op='INSERT' then
    v_recompute := true;
  elsif new.preferred_date is distinct from old.preferred_date
       or new.preferred_time is distinct from old.preferred_time
       or new.estimated_hours is distinct from old.estimated_hours then
    v_recompute := true;
  elsif new.status='accepted' and old.status is distinct from new.status
       and new.slot_start_at is null and new.preferred_time is not null
       and new.estimated_hours is not null then
    -- Add conflict protection when an older, sufficiently specified request is accepted.
    v_recompute := true;
  end if;

  if v_recompute then
    if new.preferred_time is null or new.estimated_hours is null then
      if tg_op='INSERT' or (tg_op='UPDATE' and new.preferred_date is distinct from old.preferred_date) then
        raise exception 'Choose a start time and service duration' using errcode='P0001';
      end if;
      -- Leave old bookings with unspecified time/duration unchanged.
      return new;
    end if;
    if new.preferred_date < current_date or new.preferred_date > current_date+90 then
      raise exception 'Choose a booking date within the next 90 days' using errcode='P0001';
    end if;
    if new.estimated_hours < 1 or new.estimated_hours > 12 or
       new.estimated_hours*2 <> trunc(new.estimated_hours*2) then
      raise exception 'Choose a duration between 1 and 12 hours in 30-minute steps' using errcode='P0001';
    end if;
    -- Only newly created bookings and rescheduling changes must align with 30-minute slots.
    if tg_op='INSERT' or (tg_op='UPDATE' and
      (new.preferred_date is distinct from old.preferred_date or
       new.preferred_time is distinct from old.preferred_time or
       new.estimated_hours is distinct from old.estimated_hours)) then
      if extract(minute from new.preferred_time)::int not in (0,30) or
         extract(second from new.preferred_time)<>0 then
        raise exception 'Start time must use 30-minute increments' using errcode='P0001';
      end if;
    end if;
    v_start := (new.preferred_date + new.preferred_time) at time zone 'Africa/Johannesburg';
    v_end := v_start + make_interval(secs => (new.estimated_hours*3600)::int);
    if v_start <= now() or
       (v_end at time zone 'Africa/Johannesburg')::date <> new.preferred_date then
      raise exception 'Choose a future time slot that ends on the selected date' using errcode='P0001';
    end if;
    new.slot_start_at := v_start;
    new.slot_end_at := v_end;
  end if;

  -- Guard new requests, reschedules, and acceptance of previously pending requests.
  -- Cancelling a booking remains possible even if its date was subsequently blocked.
  if new.status in ('pending','accepted') and
     (v_recompute or (tg_op='UPDATE' and new.status='accepted' and old.status is distinct from new.status)) then
    if exists(select 1 from public.helper_unavailable_dates d
      where d.helper_id=new.helper_id and d.unavailable_date=new.preferred_date) then
      raise exception 'Helper unavailable on selected date' using errcode='P0001';
    end if;
    if new.slot_start_at is not null and exists(
      select 1 from public.bookings other
      where other.helper_id=new.helper_id and other.id<>new.id and other.status='accepted'
      and other.slot_start_at is not null and
        tstzrange(other.slot_start_at,other.slot_end_at,'[)') &&
        tstzrange(new.slot_start_at,new.slot_end_at,'[)')
    ) then
      raise exception 'This time slot is already booked' using errcode='P0001';
    end if;
  end if;
  return new;
end;
$phase5$;
revoke all on function public.booking_slot_guard() from public, anon, authenticated;
create trigger booking_slot_guard_trigger
  before insert or update of preferred_date, preferred_time, estimated_hours, status on public.bookings
  for each row execute function public.booking_slot_guard();

-- Exposes only busy time intervals for an approved helper. No private bookings,
-- user IDs, addresses, notes or customer identity are returned.
create or replace function public.get_helper_busy_slots(p_helper_id uuid, p_date date)
returns table(busy_start time, busy_end time)
language sql stable security definer set search_path='' as $phase5$
  select (b.slot_start_at at time zone 'Africa/Johannesburg')::time,
         (b.slot_end_at at time zone 'Africa/Johannesburg')::time
  from public.bookings b
  join public.helper_profiles p on p.id=b.helper_id
  where p.id=p_helper_id and p.status='approved'
    and p_date>=current_date and p_date<=current_date+90
    and b.status='accepted' and b.slot_start_at is not null
    and b.preferred_date=p_date
  order by b.slot_start_at
  limit 30;
$phase5$;
revoke all on function public.get_helper_busy_slots(uuid,date) from public;
grant execute on function public.get_helper_busy_slots(uuid,date) to anon, authenticated;

create table public.booking_reschedule_requests (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings(id) on delete cascade,
  requester_id uuid not null references auth.users(id) on delete cascade,
  proposed_date date not null,
  proposed_time time not null,
  proposed_hours numeric(4,1) not null check (proposed_hours between 1 and 12),
  reason text not null check (char_length(btrim(reason)) between 10 and 350),
  status text not null default 'pending' check (status in ('pending','accepted','declined')),
  created_at timestamptz not null default now(),
  decided_at timestamptz
);
create unique index booking_one_pending_reschedule
  on public.booking_reschedule_requests(booking_id) where status='pending';
create index booking_reschedule_recent on public.booking_reschedule_requests(booking_id,created_at desc);
alter table public.booking_reschedule_requests enable row level security;
create policy booking_reschedule_read_participants on public.booking_reschedule_requests
for select to authenticated using (exists (
  select 1 from public.bookings b join public.helper_profiles p on p.id=b.helper_id
  where b.id=booking_id and
    (b.customer_id=(select auth.uid()) or p.owner_id=(select auth.uid())
     or (select private.is_marketplace_admin()))
));
revoke all on public.booking_reschedule_requests from public, anon, authenticated;
grant select on public.booking_reschedule_requests to authenticated;
-- No client INSERT/UPDATE privileges: requests and decisions use narrowly authorised RPCs.

-- Requests never change a booking until its helper explicitly approves them.
create or replace function public.request_booking_reschedule(
  p_booking_id uuid,p_date date,p_time time,p_hours numeric,p_reason text
) returns uuid language plpgsql security definer set search_path='' as $phase5$
declare v_booking public.bookings%rowtype;v_request uuid;v_start timestamptz;v_end timestamptz;
begin
  select * into v_booking from public.bookings
    where id=p_booking_id and customer_id=(select auth.uid())
      and status in ('pending','accepted') for update;
  if not found then raise exception 'Your booking cannot be rescheduled' using errcode='P0001'; end if;
  if p_date is null or p_time is null or p_hours is null or
     p_date<current_date or p_date>current_date+90 or
     p_hours<1 or p_hours>12 or p_hours*2<>trunc(p_hours*2) or
     extract(minute from p_time)::int not in(0,30) or extract(second from p_time)<>0 then
    raise exception 'Choose a valid date, 30-minute start time and duration' using errcode='P0001';
  end if;
  if char_length(btrim(coalesce(p_reason,''))) not between 10 and 350 then
    raise exception 'Describe your reschedule reason in 10 to 350 characters' using errcode='P0001';
  end if;
  v_start := (p_date+p_time) at time zone 'Africa/Johannesburg';
  v_end := v_start + make_interval(secs => (p_hours*3600)::int);
  if v_start<=now() or (v_end at time zone 'Africa/Johannesburg')::date<>p_date then
    raise exception 'Choose a future same-day time slot' using errcode='P0001';
  end if;
  if exists(select 1 from public.helper_unavailable_dates a
    where a.helper_id=v_booking.helper_id and a.unavailable_date=p_date) then
    raise exception 'Helper unavailable on selected date' using errcode='P0001';
  end if;
  if exists(select 1 from public.bookings b where b.helper_id=v_booking.helper_id
     and b.id<>p_booking_id and b.status='accepted' and b.slot_start_at is not null
     and tstzrange(b.slot_start_at,b.slot_end_at,'[)') && tstzrange(v_start,v_end,'[)')) then
    raise exception 'This time slot is already booked' using errcode='P0001';
  end if;
  insert into public.booking_reschedule_requests
    (booking_id,requester_id,proposed_date,proposed_time,proposed_hours,reason)
    values(p_booking_id,(select auth.uid()),p_date,p_time,p_hours,btrim(p_reason))
    returning id into v_request;
  insert into public.account_notifications(user_id,booking_id,kind,title,body)
    select p.owner_id,p_booking_id,'reschedule_requested','New reschedule request',
      'A customer has requested a different appointment time. Review it in Helper workspace.'
    from public.helper_profiles p where p.id=v_booking.helper_id;
  return v_request;
end;
$phase5$;
revoke all on function public.request_booking_reschedule(uuid,date,time,numeric,text) from public,anon;
grant execute on function public.request_booking_reschedule(uuid,date,time,numeric,text) to authenticated;

create or replace function public.decide_booking_reschedule(p_request_id uuid,p_accept boolean)
returns text language plpgsql security definer set search_path='' as $phase5$
declare v_req public.booking_reschedule_requests%rowtype;v_booking public.bookings%rowtype;
begin
  select * into v_req from public.booking_reschedule_requests
    where id=p_request_id and status='pending' for update;
  if not found then raise exception 'This request is no longer pending' using errcode='P0001'; end if;
  select b.* into v_booking from public.bookings b
    join public.helper_profiles p on p.id=b.helper_id
    where b.id=v_req.booking_id and p.owner_id=(select auth.uid())
    and b.status in ('pending','accepted') for update of b;
  if not found then raise exception 'You cannot decide this request' using errcode='P0001'; end if;
  if p_accept is null then raise exception 'Choose accept or decline' using errcode='P0001'; end if;
  if p_accept then
    -- The booking trigger rechecks blocked days and busy slots. Accepted-slot
    -- exclusion also provides race-safe protection against double booking.
    update public.bookings set preferred_date=v_req.proposed_date,
      preferred_time=v_req.proposed_time,estimated_hours=v_req.proposed_hours,
      updated_at=now()
    where id=v_booking.id;
  end if;
  update public.booking_reschedule_requests
     set status=case when p_accept then 'accepted' else 'declined' end,decided_at=now()
  where id=v_req.id;
  insert into public.account_notifications(user_id,booking_id,kind,title,body)
    values(v_booking.customer_id,v_booking.id,
      case when p_accept then 'reschedule_accepted' else 'reschedule_declined' end,
      case when p_accept then 'Reschedule accepted' else 'Reschedule declined' end,
      case when p_accept then 'The helper accepted your new time. Check My bookings.'
       else 'The helper declined your new time. Your original booking is unchanged.' end);
  return case when p_accept then 'accepted' else 'declined' end;
end;
$phase5$;
revoke all on function public.decide_booking_reschedule(uuid,boolean) from public,anon;
grant execute on function public.decide_booking_reschedule(uuid,boolean) to authenticated;

-- Add new kinds to Phase 4 check without exposing notifications to public writes.
alter table public.account_notifications drop constraint account_notifications_kind_check;
alter table public.account_notifications add constraint account_notifications_kind_check check (
kind in ('booking_requested','booking_accepted','booking_declined','booking_cancelled',
'helper_pending','helper_approved','helper_rejected','helper_suspended',
'reschedule_requested','reschedule_accepted','reschedule_declined'));

commit;
