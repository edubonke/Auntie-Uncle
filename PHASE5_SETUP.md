# Auntie & Uncle — Phase 5A activation (browser only)

## What this release adds

- Suggested 30-minute appointment start times based on a helper's **accepted** bookings, without showing customer details to other users.
- New booking requests require a start time and a 1–12-hour duration in 30-minute increments, ending the same day.
- A **database exclusion constraint** ensures overlapping appointments for the same helper cannot both be *accepted*, even if two people request them simultaneously.
- A customer can propose a new date/time for an active Pending or Accepted booking. The helper must explicitly approve or decline. The existing date stays unchanged until the helper approves.
- The helper's Phase 4 **whole-day blocked dates** continue to prevent new requests.
- In-app account notifications for reschedule requests and decisions.
- All times are in **Africa/Johannesburg (SAST)**.

## Important limits

This is **Phase 5A only**: it does not automatically create weekly/monthly recurring appointments, process payments, send SMS/email, or offer calendar sync. The frequency option on the request is a preference, not an automatic recurring booking. The current scheduling database retains historic bookings without times or durations, and cannot prevent overlapping those unspecified legacy records. Revisit existing accepted bookings if you need reliable scheduling for them.

The application must not be presented as production-certified without direct multi-account Row Level Security and concurrency tests, provider safeguarding processes and legal/privacy review.

## Activate in Supabase SQL Editor

This version cannot be fully activated by GitHub alone. **The SQL migration must be applied by the Supabase project owner.** Do not share database passwords, JWTs or service keys.

1. Confirm Phase 4 is working and its two RLS-enabled tables exist.
2. Open [the Phase 5A SQL migration](https://github.com/edubonke/Auntie-Uncle/blob/main/supabase/migrations/20261021000300_phase5_schedule_and_reschedule.sql).
3. Click **Raw**, copy the **entire** script from `begin;` through `commit;`. It contains four matched `$phase5$` function delimiters, each appearing twice.
4. Open [Supabase SQL Editor](https://supabase.com/dashboard/project/rtdwkhltnbujasyrrdhn/sql/new). Create a new query, paste the complete migration, and click **Run** **once**.
5. If the migration fails, **do not run individual fragments**. This migration is transactional: inspect the error and correct the complete script before retrying. It changes schema and permission objects, not old booking rows.

Run this in a separate query to verify the upgrade:

```sql
select column_name from information_schema.columns
where table_schema='public' and table_name='bookings'
  and column_name in ('slot_start_at','slot_end_at')
order by column_name;

select tablename,rowsecurity from pg_tables
where schemaname='public' and tablename='booking_reschedule_requests';

select conname, contype from pg_constraint
where conrelid='public.bookings'::regclass
and conname='booking_accepted_no_overlap';
```

Expected: both `bookings` slot columns, `booking_reschedule_requests` with `rowsecurity=true`, and `booking_accepted_no_overlap` with `contype='x'` (exclusion).

## Browser acceptance tests

After [GitHub Pages deployment](https://github.com/edubonke/Auntie-Uncle/actions) succeeds, open [your marketplace](https://edubonke.github.io/Auntie-Uncle/#account) and hard-refresh.

1. **Customer:** choose approved helper, date and duration; the available time buttons should appear. Request an open slot. It remains **Pending**.
2. **Helper:** open Helper workspace and accept the test request.
3. **Second customer:** select the same helper/date and a **time overlapping that accepted booking**. It should be unavailable or rejected. Try a nonoverlapping time; it can be requested.
4. **Customer:** for the first booking, use **Request different time**. Fill a future date, valid time, duration and explanation. The original booking date must remain unchanged until acceptance.
5. **Helper:** refresh and choose **Approve new time** or **Decline new time**. Check that approval updates the booking's displayed date/time, while decline preserves the prior date/time.
6. **Notifications:** refresh in-app updates in customer and helper sessions to see the rescheduling messages.
7. **Security:** ordinary customers must not see other users' reschedule requests or private booking information; helpers must not approve another helper's reschedule requests. This requires a **direct RLS permission test**, not only hidden tabs.
8. **Regression:** confirm Phase 4 whole-day blackout and booking cancellation continue to work.

## Change management

The migration is recorded as a GitHub file. Applying it manually in the SQL Editor does not necessarily register it in Supabase CLI's migration history. Reconcile history before using `supabase db push`; **never rerun the migration just to mark it applied**. Backup your production database before executing schema migrations against real user data.
