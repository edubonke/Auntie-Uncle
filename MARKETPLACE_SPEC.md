# Auntie & Uncle — Marketplace implementation brief

**Status:** Proposal for version 1.0 planning. The downloadable v0.2 site remains an offline demonstration.

## Product model

Auntie & Uncle is a **two-sided intermediary marketplace**, not a direct employer or service provider by assumption. Customers seek domestic or household work; independent helpers list services, set prices and availability, assess requests, and provide work after agreement. Actual contractual arrangements and legal obligations must be independently reviewed.

### Audience and initial coverage

- Household customers seeking one-time or recurring domestic help.
- Self-employed/independent household-service providers seeking demand, with a clear and accessible onboarding path.
- **Proposed pilot:** Gauteng, with suburb-based coverage. This is a proposal, not an existing launch commitment.

### Six provisional categories

Cleaning; childcare; cooking; gardening; handyman help; moving and rearranging. Restrict any regulated trade or sensitive-care category until qualified and lawful verification procedures exist.

## Real product flows

### Customer journey

1. Search a category, area, preferred date and scope. Show only currently approved, eligible provider profiles.
2. Review public provider profile: services, approximate locality, provider-controlled rate, availability, completed-job reviews if available, and the verification signals that are actually substantiated.
3. Select a provider and request service with scope, date, approximate duration and non-sensitive instructions.
4. Provider receives request and can accept, decline or propose an alternative. Both sides must agree to the **final price and terms**.
5. Customer confirms booking after explicit quote/terms agreement; payment (if enabled) follows a separately reviewed payment design.
6. Service occurs; customer can confirm completion, raise an issue and leave a review **only for a confirmed completed booking**.
7. Financial/payout and dispute workflow closes the booking.

### Provider journey

1. Create an account using a verified contact method.
2. Submit a private application; upload required supporting documents privately, not as public profile content.
3. Admin reviews eligibility and any required category-specific safety checks, then approves/rejects requests with reasons/audit records.
4. Approved provider sets service areas, skills, prices, schedule and services.
5. Provider responds to booking requests and updates completion statuses; platform records a complete history.
6. Provider sees approved earnings and payout statuses, subject to the agreed commercial model.

### Admin journey

1. Review provider applications and document access with least-privilege permissions.
2. Approve, suspend and archive profiles. Always distinguish verified checks from self-declared information.
3. Manage complaints, cancellations, refunds, suspicious usage and disputes with audit trails.
4. View operational metrics and reconciliation summaries, without exposing unnecessary sensitive data.

## Booking lifecycle (proposed)

`requested → provider_accepted → customer_confirmed → in_progress → completed → settled`

Alternate terminal/transitional states: `provider_declined`, `expired`, `cancelled`, `disputed`, `refunded` as appropriate. Define who can make each transition; enforce rules on the server in a transaction, not only in browser UI. A provider's acceptance **alone does not imply customer confirmation**. Never mark as paid on browser callback alone.

## Suggested data entities

- `accounts` (Auth subject / external id) and private `account_profiles` (minimal name/contact data)
- `provider_profiles` (public display fields + approval status)
- `provider_applications` and private, access-controlled `verification_documents`
- `service_categories`, `provider_services` and `service_areas`
- `provider_availability` and availability exceptions/leave
- `booking_requests`, `booking_quotes`, `booking_events`, `booking_messages`
- `payments`, `refunds`, `payouts`, `ledger_entries` (once a payment provider is approved)
- `reviews` associated only with completed bookings; `reports` and `moderation_actions`

Use UUID primary keys, timestamps with timezone, server-side immutable event history where appropriate, appropriate deletion/retention design and database constraints for state validity.

## Suggested stack and security

- Frontend: React/Next.js or equivalent with accessible components and SEO-friendly service pages.
- Backend: Supabase Auth, PostgreSQL, row-level security and server-side functions, **if this stack is approved**. A static HTML landing page alone cannot securely operate a marketplace.
- Storage: private buckets for identity/screening documents, with restrictive signed access and retention controls.
- Policies: customers may only see their own private bookings; providers may see only requests directed to them; public users see only approved public profile fields; admin privileges require explicit claims and auditable enforcement.
- Apply role checks server-side, rate limits, validation, CSRF or equivalent protections, abuse controls and audit records. Never expose service-role keys in browser code.
- Use POPIA-aligned purpose-limited collection, privacy and consent notices, deletion/retention policies, breach handling, appropriate processors and cross-border transfer review.
- Treat child-related services as a higher-risk category; do not publish unverified assurance of safety, background checks or qualifications.
- No off-platform payments, fees or pay-outs should be automated before contracts, regulatory/payment-provider requirements and accounting are reviewed.

## Marketplace pricing options — not yet approved

1. **Commission on completed bookings:** e.g. a provisional 10–15% *illustrative planning range*, payable only on qualifying completed jobs, subject to payment costs and provider economics.
2. **Provider subscription:** potentially a later option if the marketplace generates a reliable volume of requests.
3. **Hybrid:** lower commission plus optional subscription features after proof of demand.

**MVP recommendation:** explore commission-only, with no mandatory subscription for new helpers; validate actual unit economics, taxes, disputes, chargebacks, payment-provider payout capabilities and consumer protections before setting public rates. The site does **not** currently charge anyone.

## Release plan

**Stage A — Discovery & operating design**

- Decide launch cities, service availability, prohibited job types, ownership, contracts, provider screening approach and fee responsibility.
- Determine who supports customers and resolves disputes.

**Stage B — Functional marketplace MVP**

- Implement secure Auth with customer/provider/admin roles; onboarding; approval; browse and availability; booking requests; confirmations; contact notifications and basic dashboard.
- Add policies, testing and a real provider approval workflow before allowing public profiles.

**Stage C — Transaction and trust infrastructure**

- Integrate an approved payments provider and compliant payout/reconciliation flow, with appropriate refund/cancellation procedures.
- Implement genuine completed-booking reviews, complaints, optional recurring schedules and operational reporting.

**Stage D — Pilot and scale**

- Launch a limited supervised pilot, validate service quality and dispute response, then expand service/area coverage based on measured outcomes.

## Acceptance criteria before claiming launch-readiness

- No users can view another customer's private bookings or an unrelated provider's private documents.
- Bookings cannot confirm without agreement and valid availability; conflicting slots are prevented server-side.
- No fictional profiles or rates are mixed into genuine public search results.
- All verification and qualification badges are backed by actual recorded checks.
- Payment records are server-verified and reconciled; refunds, chargebacks and payouts are tested.
- Accessibility, responsive UI, acceptance, security and operational recovery tests pass.
- Customer and helper terms, POPIA notices, complaints/refunds policies and category-specific safeguards receive review.