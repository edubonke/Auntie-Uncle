-- Auntie & Uncle Phase 5B — limited recurring booking requests.
-- Prerequisites: the foundation, Phase 4 and Phase 5A migrations already applied.
-- Run the entire transaction ONCE through Supabase SQL Editor, after backup/review.
-- Only generates Pending requests; the helper accepts every occurrence separately.
-- No scheduled jobs, payments, emails, or unlimited automatic renewals are enabled.
begin;

create table public.recurring_booking_series (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references auth.users(id) on delete cascade,
  helper_id uuid not null references public.helper_profiles(id) on delete restrict,
  request_key uuid not null,
  service text not null,
  area text not null check (char_length(btrim(area)) between 2 and 80),
  cadence text not null check (cadence in ('Weekly','Fortnightly','Monthly')),
  occurrence_count smallint not null check (occurrence_count between 2 and 8),
  first_date date not null,
  start_time time not null,
  estimated_hours numeric(4,1) not null check (estimated_hours between 1 and 12),
  details text not null check (char_length(btrim(details)) between 10 and 650),
  status text not null default 'active' check (status in ('active','cancelled')),
  created_at timestamptz not null default now(),
  cancelled_at timestamptz,
  unique(customer_id, request_key)
);
create index recurring_series_customer_created on public.recurring_booking_series(customer_id, created_at desc);
create index recurring_series_helper_created on public.recurring_booking_series(helper_id, created_at desc);
alter table public.recurring_booking_series enable row level security;
create policy recurring_series_participants_read on public.recurring_booking_series
  for select to authenticated using (
    customer_id = (select auth.uid())
    or exists (
      select 1 from public.helper_profiles p
      where p.id=helper_id and p.owner_id=(select auth.uid())
    )
    or (select private.is_marketplace_admin())
  );
revoke all on public.recurring_booking_series from public, anon, authenticated;
grant select on public.recurring_booking_series to authenticated;
-- Creation and cancellation only through narrowly scoped SECURITY DEFINER RPCs.

alter table public.bookings
  add column series_id uuid references public.recurring_booking_series(id) on delete set null;
alter table public.bookings add column series_occurrence_no smallint;
alter table public.bookings add constraint booking_series_occurrence_pair check (
  (series_id is null and series_occurrence_no is null)
  or (series_id is not null and series_occurrence_no between 1 and 8)
);
create unique index booking_recurring_series_occurrence
  on public.bookings(series_id,series_occurrence_no) where series_id is not null;
create index bookings_series_recent on public.bookings(series_id,preferred_date) where series_id is not null;

-- All original frequency values remain permitted. "Twice a week" and "Not sure yet"
-- are preferences on single enquiries and do NOT generate recurrence series.
alter table public.bookings drop constraint bookings_frequency_check;
alter table public.bookings add constraint bookings_frequency_check check (
  frequency in ('One-time help','Weekly','Twice a week','Fortnightly','Monthly','Not sure yet')
);

create or replace function public.request_recurring_bookings(
  p_helper_id uuid, p_service text, p_area text,
  p_start_date date, p_start_time time, p_hours numeric,
  p_details text, p_cadence text, p_occurrences integer, p_request_key uuid
) returns uuid
language plpgsql security definer set search_path = '' as $phase5b$
declare
  v_customer uuid := (select auth.uid());
  v_existing uuid;
  v_series uuid;
  v_day date;
  v_month date;
  v_i integer;
  v_start timestamptz;
  v_end timestamptz;
begin
  if v_customer is null then
    raise exception 'Sign in to request recurring bookings' using errcode='P0001';
  end if;
  if p_request_key is null then
    raise exception 'Request identifier required' using errcode='P0001';
  end if;

  -- Idempotent retries must return the original series (never double-insert).
  select id into v_existing from public.recurring_booking_series
    where customer_id=v_customer and request_key=p_request_key;
  if v_existing is not null then return v_existing; end if;

  if p_cadence is null or p_cadence not in ('Weekly','Fortnightly','Monthly')
     or p_occurrences is null or p_occurrences not between 2 and 8 then
    raise exception 'Select weekly, fortnightly or monthly and 2–8 visits' using errcode='P0001';
  end if;
  if p_start_date is null or p_start_time is null or p_hours is null
    or p_start_date<current_date or p_start_date>current_date+90
    or p_hours<1 or p_hours>12 or p_hours*2<>trunc(p_hours*2)
    or extract(minute from p_start_time)::integer not in (0,30)
    or extract(second from p_start_time)<>0 then
    raise exception 'Invalid future date, start time or duration' using errcode='P0001';
  end if;
  if char_length(btrim(coalesce(p_details,''))) not between 10 and 650
    or char_length(btrim(coalesce(p_area,''))) not between 2 and 80 then
    raise exception 'Provide an area and service details' using errcode='P0001';
  end if;
  if not exists (
    select 1 from public.helper_profiles p
    where p.id=p_helper_id and p.service=p_service and p.status='approved'
      and p.owner_id<>v_customer
  ) then
    raise exception 'The selected provider is not available' using errcode='P0001';
  end if;

  -- Validate every proposed date before writing anything; a single blocked date,
  -- accepted-slot collision or out-of-horizon visit aborts the WHOLE request.
  for v_i in 0..p_occurrences-1 loop
    if p_cadence='Weekly' then
      v_day := p_start_date + v_i*7;
    elsif p_cadence='Fortnightly' then
      v_day := p_start_date + v_i*14;
    else
      -- Anchor on original day-of-month; clamp to last day for short months.
      -- E.g. 31 Jan -> 28 Feb -> 31 Mar (no cumulative drift).
      v_month := (date_trunc('month',p_start_date)::date +
        make_interval(months=>v_i))::date;
      v_day := v_month + least(extract(day from p_start_date)::integer,
        extract(day from (v_month + interval '1 month - 1 day'))::integer)-1;
    end if;
    if v_day>current_date+90 then
      raise exception 'All visits must fall within the next 90 days' using errcode='P0001';
    end if;
    v_start := (v_day+p_start_time) at time zone 'Africa/Johannesburg';
    v_end := v_start + make_interval(secs=>(p_hours*3600)::integer);
    if v_start<=now() or (v_end at time zone 'Africa/Johannesburg')::date<>v_day then
      raise exception 'All visits must be in the future and finish on their scheduled day' using errcode='P0001';
    end if;
    if exists (
      select 1 from public.helper_unavailable_dates a
      where a.helper_id=p_helper_id and a.unavailable_date=v_day
    ) then
      raise exception 'One or more recurring dates are blocked by the helper' using errcode='P0001';
    end if;
    if exists (
      select 1 from public.bookings b
      where b.helper_id=p_helper_id and b.status='accepted' and b.slot_start_at is not null
        and tstzrange(b.slot_start_at,b.slot_end_at,'[)') && tstzrange(v_start,v_end,'[)')
    ) then
      raise exception 'One or more recurring times overlap accepted bookings' using errcode='P0001';
    end if;
  end loop;

  insert into public.recurring_booking_series
    (customer_id,helper_id,request_key,service,area,cadence,occurrence_count,
     first_date,start_time,estimated_hours,details)
    values(v_customer,p_helper_id,p_request_key,p_service,btrim(p_area),p_cadence,
      p_occurrences,p_start_date,p_start_time,p_hours,btrim(p_details))
    returning id into v_series;

  for v_i in 0..p_occurrences-1 loop
    if p_cadence='Weekly' then
      v_day := p_start_date + v_i*7;
    elsif p_cadence='Fortnightly' then
      v_day := p_start_date + v_i*14;
    else
      v_month := (date_trunc('month',p_start_date)::date +
        make_interval(months=>v_i))::date;
      v_day := v_month + least(extract(day from p_start_date)::integer,
        extract(day from (v_month + interval '1 month - 1 day'))::integer)-1;
    end if;
    insert into public.bookings
      (customer_id,helper_id,service,frequency,area,preferred_date,preferred_time,
       estimated_hours,details,series_id,series_occurrence_no)
    values(v_customer,p_helper_id,p_service,p_cadence,btrim(p_area),v_day,
      p_start_time,p_hours,btrim(p_details),v_series,v_i+1);
  end loop;
  return v_series;
end;
$phase5b$;
revoke all on function public.request_recurring_bookings(
  uuid,text,text,date,time,numeric,text,text,integer,uuid) from public, anon;
grant execute on function public.request_recurring_bookings(
  uuid,text,text,date,time,numeric,text,text,integer,uuid) to authenticated;

-- Customers may end only their own series. Existing past/completed appointments
-- and other customers' bookings are never modified. Future pending/accepted
-- occurrences are cancelled through the existing notification trigger.
create or replace function public.cancel_recurring_series(p_series_id uuid)
returns integer
language plpgsql security definer set search_path='' as $phase5b$
declare v_customer uuid := (select auth.uid()); v_count integer;
begin
  if v_customer is null then raise exception 'Sign in required' using errcode='P0001'; end if;
  update public.recurring_booking_series
    set status='cancelled',cancelled_at=now()
  where id=p_series_id and customer_id=v_customer and status='active';
  if not found then
    raise exception 'Series not found or already cancelled' using errcode='P0001';
  end if;
  update public.bookings b set status='cancelled',updated_at=now()
  where b.series_id=p_series_id and b.customer_id=v_customer
    and b.status in ('pending','accepted')
    and (b.slot_start_at is null or b.slot_start_at>now());
  get diagnostics v_count=row_count;
  return v_count;
end;
$phase5b$;
revoke all on function public.cancel_recurring_series(uuid) from public,anon;
grant execute on function public.cancel_recurring_series(uuid) to authenticated;
commit;
