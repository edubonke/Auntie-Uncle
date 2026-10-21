# Phase 4 (first increment) — Availability and activity updates

**Status:** Source code is reviewed through GitHub Actions; **the live Supabase schema has not been changed from ChatGPT**. Do not treat the feature as active until you run the SQL and complete the account tests below.

**Browser-only activation (no CLI, password or code upload required):**

1. Confirm that the original Auntie & Uncle tables `helper_profiles`, `bookings`, `private.marketplace_admins` exist (they were verified during Phase 2).
2. Open the [Phase 4 SQL migration](https://github.com/edubonke/Auntie-Uncle/blob/main/supabase/migrations/20261021000200_phase4_calendar_and_notifications.sql).
3. Click **Raw** and copy the entire file. Review it before execution. It creates two new tables, associated RLS policies and triggers, and does **not** remove existing bookings.
4. In [Supabase SQL Editor](https://supabase.com/dashboard/project/rtdwkhltnbujasyrrdhn/sql/new), create a **new query** and paste the entire SQL. Run this migration **once**. It uses one transaction, so a failure should roll back its changes. Do not rerun it if it was already applied without checking the migration state.
5. To verify, run in a **separate** query:

   ```sql
   select tablename, rowsecurity
   from pg_tables
   where schemaname='public'
     and tablename in ('helper_unavailable_dates','account_notifications')
   order by tablename;
   ```

   Expect both tables to exist and have RLS enabled.

6. Refresh the [Auntie & Uncle site](https://edubonke.github.io/Auntie-Uncle/#account), sign in and select **Helper workspace**. The calendar and **Account updates** sections should appear. If the migration was not applied, the existing booking flow remains available and a setup notice will appear instead.

## What's in this increment

- A calendar allowing a helper to block or unblock **whole days** for **new** customer requests.
- The database rejects new requests for unavailable dates even if the client is bypassed.
- Existing bookings remain unchanged if a helper later blocks a date; helpers must manage those separately.
- Private, in-app account updates for new requests, helper acceptance/decline, customer cancellation and helper review outcomes. Refresh the page or choose **Refresh updates** to fetch the latest.
- Only the signed-in user can read their notifications and mark them read. Helpers can edit only their own unavailable dates. Approved providers' unavailable days can be checked by potential customers.
- No production emails, SMS, payment processing, time-slot scheduling, calendar synchronisation or background identity verification.

## Manual acceptance tests (use fictional details)

1. Helper account → block an upcoming day → refresh → blocked day remains.
2. Customer account → choose that helper and blocked day → request is refused; try an unblocked day → request is accepted for **pending** review.
3. Helper account → **Refresh updates** → new-request message appears; accept that request.
4. Customer account → **Refresh updates** → acceptance message appears; cancel the accepted request.
5. Helper account → refresh updates → cancellation message appears.
6. Helper → unblock date → date becomes bookable again.
7. A separate customer cannot read another customer's notifications or bookings; an ordinary helper cannot change another helper's unavailable days or view the admin tab. **A visual check of tabs is not a substitute for an RLS test.**
8. Admin → review an application with fictional data → helper receives a review status update.

## Important migration history note

If you apply this SQL through the Supabase SQL Editor rather than the CLI, Supabase's CLI migration history may not automatically include it. Reconcile the history with your database state before using future `supabase db push` commands; **never rerun a migration just to repair history**.

## Release gate

GitHub Actions checks validate JavaScript syntax and static source contracts only. Hosted SQL execution, Row Level Security isolation between multiple accounts, and browser acceptance remain to be verified. Launch to real users is **not approved** by this increment.
