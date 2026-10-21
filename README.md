# Auntie & Uncle — Household Help Marketplace

A responsive, two-sided South African marketplace website for households and independent helpers. The site can run as a **clearly labeled fictional demonstration** before the database is initialized; after migration, it offers Supabase authentication and protected booking requests.

**Repository:** https://github.com/edubonke/Auntie-Uncle

## Status

- Implemented: responsive static site; example search; account registration and password login; public *approved-only* helper directory; signed-in helper applications; signed-in customer booking requests; participant-only booking views; helper accept/decline; customer cancellation; admin-controlled listing approval; GitHub Pages deployment workflow.
- Migration **not yet applied** to the hosted Supabase instance. Until it is applied, the site remains in demonstration mode and does not send booking requests.
- Not implemented: payments, verification/background checks, full platform terms and privacy policy, document uploads, chat, availability and scheduling conflicts, fees, reviews, service guarantee, production monitoring, safeguarding workflows for childcare.
- Public listing approval is an internal administrative decision, **not proof of ID, qualification or background checks**.

## Phase 5A — Appointment scheduling and rescheduling

The time-slot picker, database overlap protection and helper-approved rescheduling require a **separate Supabase SQL migration**. See [Phase 5A browser-only activation and test instructions](PHASE5_SETUP.md). Phase 4 booking behaviour remains available until the new tables and functions exist.

## Phase 4 optional extension

Availability calendar and private in-app updates require an **additional SQL migration**. Follow [the browser-only Phase 4 setup and test guide](PHASE4_SETUP.md). The site retains its existing booking flow until the migration is applied.

## Public Supabase client configuration

`supabase-config.js` contains only the **project URL** and **publishable key**. Both are intended to be embedded in browser apps. Never commit the database password, a service-role key, a secret key, a Supabase Personal Access Token or provider ID documents.

Project reference: `rtdwkhltnbujasyrrdhn`

## Activate the database (one-time manual setup)

1. Review the migration file at `supabase/migrations/20261021000100_marketplace_foundation.sql`. It creates two public tables, private admin assignments, RLS policies, constraints, and security-definer actions.
2. Install the current [Supabase CLI](https://supabase.com/docs/guides/local-development/cli/getting-started). In a checked-out copy of this repository run:

   ```bash
   supabase login
   supabase link --project-ref rtdwkhltnbujasyrrdhn
   supabase db push --dry-run
   supabase db push
   ```

   The `supabase/` folder is already initialized in this repository; **do not run `supabase init` again**. The CLI will request your *database password locally*. Don't paste it in chat or commit it.
3. **If the Supabase database already contains tables/migrations**, first check migration history and reconcile the schema. Do not run a destructive reset. See the Supabase CLI workflow docs.
4. In Supabase Dashboard → Authentication → URL Configuration, set **Site URL** to `https://edubonke.github.io/Auntie-Uncle/` and add the same URL (plus appropriate callback paths) to the allowed **Redirect URLs**. Confirm email auth is enabled and configure a production SMTP sender before launch.
5. Create your own administrator account through the frontend and confirm its email, then *manually* insert its UUID into the privileged table via the Supabase SQL editor:

   ```sql
   -- Replace UUID_FROM_AUTH_USERS with the confirmed ID from Authentication > Users.
   insert into private.marketplace_admins(user_id)
   values ('UUID_FROM_AUTH_USERS');
   ```

   Only a trusted dashboard administrator with SQL access should do this. The website never allows users to grant themselves admin rights.
6. Review applicants using the **My account** section after signing in. Before any real public launch, implement appropriate identity, reference and safeguarding processes.

## GitHub Pages

A Pages workflow is committed at `.github/workflows/pages.yml`. In GitHub repository **Settings → Pages**, choose **Build and deployment → GitHub Actions**. Once enabled, the workflow publishes only `index.html`, `app.js`, `backend.js`, `supabase-config.js`, `styles.css`, and `favicon.svg` from `main`.

Expected website URL **after deployment is confirmed**: `https://edubonke.github.io/Auntie-Uncle/`.

## Local development

Serve the project with a local HTTP server (avoid opening `file://` URLs because ES modules are blocked):

```bash
python -m http.server 8000
```

Open `http://localhost:8000/`. Only the demo flows work until the hosted migration is applied. If your dev URL differs from the live site, configure that URL in Supabase Authentication redirects as well.

Smoke tests (requires Python Playwright and Chromium):

```bash
python tests/smoke.py
```

The smoke tests validate the offline demo UI, not the live remote database or its row-level security. After applying the migration, test customer A vs customer B, application owner vs another owner, admin vs non-admin, and helper statuses before opening registrations to the public.

## Security and privacy notes

- Approval is required to appear in public results, and only published profile fields are shown.
- Profiles and booking details are protected with PostgreSQL row-level security. Customers see only their own bookings; helpers see only requests addressed to them; admins are explicitly assigned outside the browser.
- Public users cannot directly update booking status or helper approval status. Narrow RPCs enforce authorized transitions.
- Rates are indicative, not guaranteed; the platform processes no payments.
- Do not collect SA ID numbers, addresses, childcare documentation or other sensitive material via the beta site. Before launch, complete POPIA documentation, consent and retention controls, contractual/insurance analysis, vetting and incident-handling processes.
- The publishable key is **not** a database admin credential. Never use it to bypass RLS.
