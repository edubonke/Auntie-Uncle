# Auntie & Uncle — Phase 5B recurring booking setup and tests

This increment adds **bounded recurring requests**, not subscriptions or automatically confirmed services. Customers choose **Weekly**, **Fortnightly** or **Monthly**, with **2–8 future appointments** all within the next **90 days**. Every date is a separate Pending request and must be accepted individually by the helper.

**Status:** Changes are deployed as code only until the Supabase migration is applied by the project owner. No live database changes are made by GitHub or ChatGPT. No payments, email or SMS are introduced.

## Activate in your browser

1. Verify the foundation, Phase 4 and Phase 5A migrations are already active.
2. Back up your database if real customer or helper records exist.
3. Open the [Phase 5B SQL migration](https://github.com/edubonke/Auntie-Uncle/blob/main/supabase/migrations/20261021000400_phase5b_recurring_bookings.sql).
4. Choose **Raw**, copy every line beginning at `begin;` through `commit;`, including both pairs of `$phase5b$` function delimiters.
5. Open the [Supabase SQL Editor](https://supabase.com/dashboard/project/rtdwkhltnbujasyrrdhn/sql/new), create a new query and paste the complete script. Review it. **Run it once only**.
6. If it fails, **do not run fragments** or reset your database. Capture the PostgreSQL error and correct the migration before trying again. The whole script is transactional.

### Verification query (new SQL Editor query)

```sql
select tablename,rowsecurity from pg_tables
where schemaname='public' and tablename='recurring_booking_series';

select column_name from information_schema.columns
where table_schema='public' and table_name='bookings'
  and column_name in ('series_id','series_occurrence_no')
order by column_name;

select proname,prosecdef from pg_proc
where pronamespace='public'::regnamespace
and proname in ('request_recurring_bookings','cancel_recurring_series')
order by proname;
```

Expected: table `recurring_booking_series` exists with `rowsecurity=true`, both booking series columns are present, and **both** RPC functions show `prosecdef=true`. **Do not run the migration again if these results already exist.**

## Browser-based functional tests

1. Refresh [Auntie & Uncle](https://edubonke.github.io/Auntie-Uncle/#browse). Sign in as a customer, select an approved helper, select an unblocked future date/time and duration, and check **Request a recurring series**.
2. Choose **Weekly**, **4** visits, and inspect the four preview dates. Confirm the helper and all dates are correct.
3. Submit the request. You should receive a series reference. Open **My bookings**: four separate Pending requests should exist. The new **Recurring requests** section should show one series.
4. Sign in as the corresponding helper. Find the four individual visits. **Accept only the first**, **decline the second**, and leave the other two Pending. No other visits should be auto-accepted.
5. As the customer, choose **Cancel remaining visits** on the series. Future Pending and Accepted appointments are cancelled; already-past visits are not changed.
6. Repeat with **Fortnightly** and **Monthly**. For a month-end date (31 January), previews should clamp to February's last day and return to the 31st in March when possible; choose actual future dates in live tests.
7. Try **9 visits**, and a series where the last date exceeds the 90-day limit. It must be refused. Likewise, if even one date is blocked or collides with an accepted appointment, **the entire new series** must fail without partial rows being created.
8. Confirm previous one-off bookings, helper calendar, rescheduling, cancellations and notifications still function.

## Security testing and limitations

- Review the [read-only security inspection SQL](https://github.com/edubonke/Auntie-Uncle/blob/main/supabase/security_audit_phase5b.sql). This checks grants, RLS policies and SECURITY DEFINER function settings, **not** account isolation by itself.
- A separate customer should not be able to select another customer's series, cancel it, or create recurring bookings on another account's behalf. A helper should only see its own participating series. The administrator should see only what the administrator privileges allow.
- Test concurrent booking acceptances separately; existing Phase 5A exclusion constraint remains the database's final conflict guard.
- Existing bookings may lack a start time; those legacy entries cannot participate fully in slot-conflict checking.
- **No infinite recurrence**: only the requested 2–8 appointments are created. The old `Twice a week` and `Not sure yet` frequency options remain descriptive single-request preferences.
- **No automatic emails, payments, fees, identity verification or childcare screening.** Additional POPIA/privacy and employment-status legal review is required before public launch.

Manual SQL Editor execution does not automatically reconcile Supabase CLI migration history. Avoid repeating already applied migrations when the project later adopts CLI-driven deployment.
