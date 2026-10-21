-- Phase 5B read-only security audit. No account IDs, tokens or secrets required.
-- Run AFTER the recurring booking migration, separately in Supabase SQL Editor.
-- This inspects configuration; it does NOT simulate independent authenticated users.
select table_schema,table_name,privilege_type,grantee
from information_schema.role_table_grants
where table_schema='public'
  and table_name in ('recurring_booking_series','bookings','booking_reschedule_requests','account_notifications')
  and grantee in ('anon','authenticated')
order by table_name,grantee,privilege_type;

select schemaname,tablename,policyname,roles,cmd,qual,with_check
from pg_policies
where schemaname='public'
  and tablename in ('recurring_booking_series','bookings','booking_reschedule_requests','account_notifications')
order by tablename,policyname;

select n.nspname as schema_name,p.proname as function_name,p.prosecdef as security_definer,
       p.proconfig as security_settings
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname in
 ('request_recurring_bookings','cancel_recurring_series',
  'request_booking_reschedule','decide_booking_reschedule','respond_to_booking')
order by p.proname;

select
  has_table_privilege('anon','public.recurring_booking_series','SELECT') as anonymous_cannot_read_series_expected_false,
  has_table_privilege('authenticated','public.recurring_booking_series','INSERT') as clients_cannot_insert_series_expected_false,
  has_table_privilege('authenticated','public.recurring_booking_series','UPDATE') as clients_cannot_update_series_expected_false,
  has_table_privilege('authenticated','public.bookings','UPDATE') as clients_cannot_update_booking_expected_false;
-- Follow up with TWO distinct logged-in test accounts and API requests.
-- Merely hiding the Administration tab is not a database access-control test.
