# Auntie & Uncle — Marketplace v0.2

**Interactive, standalone concept prototype. Not a live service.**

Auntie & Uncle is being rebuilt as a two-sided marketplace connecting South African households with independent household-service helpers. This version replaces the v0.1 enquiry-only concept with actual customer and provider journeys, all rendered locally without a backend.

## Try it

Open `index.html` directly, or serve the folder:

```bash
python -m http.server 8000
# visit http://localhost:8000
```

There are no dependencies, paid APIs, network requests, user logins, external assets, or database setup.

### Households

- Browse six service categories: cleaning, childcare, cooking, gardening, handyman assistance, and moving/rearranging.
- Find example helpers by category and area; change example sorting by rate or experience.
- Open a fictional helper profile with illustrative skills, area, schedule description, and hourly rate.
- Select a helper, prefill a booking-request form, and preview/copy the request text.
- Enter an open request without selecting a helper.

### Independent helpers

- Preview a profile application containing a display name, chosen service, area, proposed hourly rate and introduction.
- Try a sample incoming booking card that can be accepted/declined/reset in the browser.

### Important boundaries

- All eight example helpers, names, bios, service areas, experience, hours and rates are **fictional**, not screened or actual providers.
- This prototype does not create accounts, publish listings, receive applications, verify identity, review qualifications, accept payments, send messages, store personal data, or make/confirm bookings.
- All form input exists only in the currently open browser page. Reloading clears it. No fetch or third-party scripts run.
- No provider is designated verified. In particular, childcare requires suitable screening and safety practices *before* a public launch.
- The legal classification of providers as independent contractors cannot be guaranteed by website wording. Obtain local legal/tax advice on the real operating arrangements before launch.

## Test

With Python Playwright and a local Chromium browser installed:

```bash
python tests/smoke.py
```

Tests cover service filters, helper search, empty-state recovery, rate sort, modal details, prefilled requests, validation, preview/no outbound handoff, helper application preview, dashboard state changes, mobile navigation, responsive widths (320–1920px), and uncaught JS errors.

## Architecture

- `index.html` — semantic single-page front end
- `styles.css` — responsive styles
- `app.js` — client-side sample data and demo interactions
- `favicon.svg` — simple brand icon
- `tests/smoke.py` — headless browser coverage
- `MARKETPLACE_SPEC.md` — suggested actual product design and go-live decisions

## Not yet implemented

Production authentication, database/RLS, provider account creation, listing moderation, verified documentation workflow, live discovery/availability, actual booking state machine, customer-provider messaging, consent/privacy notices, real price confirmation, payment collection/disbursement, cancellations, disputes, verified reviews, admin tools, notifications and analytics.

## Publication

No changes have been made to the existing site at `Mitch2003/Auntie-and-Uncle`. Both connected GitHub accounts have read access only to that repository. To deploy, publish to a repository with appropriate write access, or have the repository owner grant the intended account the necessary permissions. **Do not replace the existing site without review.**