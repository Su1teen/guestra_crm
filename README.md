# Guestra CRM

Full-stack hospitality CRM built with React, Vite, TypeScript, Express, PostgreSQL, and Drizzle ORM.

## Data modes

- `sales@guestra.com` opens the deterministic demo dataset. Its changes stay in browser memory and never write to PostgreSQL.
- `admin@guestra.com` loads and updates PostgreSQL. Changes persist after reload and server restart.

Passwords are never stored in the repository. Set both bootstrap passwords through environment variables; the bootstrap hashes them with bcrypt and creates missing users idempotently.

## Local setup

1. Copy `.env.example` to `.env` and replace every secret/password placeholder.
2. Create the PostgreSQL database from `DATABASE_URL`.
3. Install and build:

```bash
npm install
npm run build
```

4. Load environment variables in your shell, then prepare the database and start the app:

```bash
npm run db:migrate
npm run db:bootstrap
npm start
```

For frontend development, run `npm run dev`; in a second terminal run `npm run dev:server`. Vite proxies `/api` to port 3000.

## Railway

Add a PostgreSQL service, expose its `DATABASE_URL`, and set all values from `.env.example`. Use `npm run build` as the build command and `npm run start:production` as the start command. The start command applies pending migrations and runs the idempotent bootstrap before starting the web server. The included `Dockerfile` provides the same sequence automatically.

## AI integration

Send `x-crm-api-key: <CRM_INTEGRATION_API_KEY>` to:

- `POST /api/integrations/ai/leads/upsert`
- `POST /api/integrations/ai/offers/upsert`
- `POST /api/integrations/ai/bookings/confirm`

These endpoints store structured CRM facts and idempotency markers. They do not persist raw Telegram or AI message bodies.

## Hospitality domain, phase 1

`guests` is the physical customer table. `leads` remains the physical request table for old clients and reports; `leads.request_status` is the simpler request lifecycle (`new`, `active`, `waiting_customer`, `won`, `lost`, `closed`). The old `stage` and journey checklist remain compatibility fields. They do not drive reservation or stay state.

```text
Customer (guests) ──< Request (leads)
       │                     │
       └──< Reservation >────┘   confirmed commitment, dates and category
                ├──< reservation_guests
                ├──< reservation_units >── rooms >── unit_types
                ├──< guest_stays             operational status and actual times
                └──< folios                  charges and payments remain financial truth
```

`0003_hospitality_domain` adds tables and nullable links and relaxes `folios.lead_id`; it does not rename or remove historical tables. `0004_hospitality_backfill` is repeatable. It creates reservations only for confirmed/completed requests with valid dates and accommodation evidence, then links exact matching stays by property and reference, including stays where the booker differs from the staying guest. Existing standalone stays receive reservations. Ambiguous or date-invalid requests are left for manual review. Room categories become `unit_types`; `properties.room_types` remains for legacy clients. All financial numbers and DRR/report formulas stay as they were.

`POST /api/integrations/ai/bookings/confirm` keeps the old request/response keys and adds `reservationId` (internal) and `stayId`. Its input `reservationId` remains the external PMS ID. An optional `roomId` assigns a concrete room; without one, category context is kept without inventing a room. `POST /api/crm/reservations/:id/units` assigns a room; `PATCH /api/crm/reservations/:id` changes dates/status. Both run overlap validation under a room row lock. Active `blocks_room` maintenance tickets also block assignment. All allocation writers must use this service; direct SQL writers bypass its lock. Cancelled/no-show reservations release availability. The old `lead.stage` remains for analytics until the report consolidation phase.

Identity resolution uses exact channel/external ID first and normalized phone/email for duplicate candidates. It never auto-merges candidates. Manual customer creation reports potential matches; external identity retries reuse one customer. Customer preferences stay in `guests.preferences`; reservation-specific notes belong in `reservation_notes`.

The database mode bootstrap exposes reservations, allocations, unit types, participants and linked stays to the frontend. The employee workspace and pilot operations are described below.

## Employee workspace, phase 2

The Russian navigation now leads through Today, Inbox, Requests, Reservations, Guests and Contacts, and Tasks. Old `/leads`, `/pipeline`, `/calendar`, and `/follow-up` URLs redirect to their new workspace views. Requests share URL-based filters between list and board. The board uses `request_status`, independent of reservation and stay state; only open statuses can move by drag and drop. `PATCH /api/crm/requests/:id/status` persists these changes without advancing the legacy journey or changing analytics stages.

`POST /api/crm/requests/:id/reservation` creates a confirmed accommodation reservation directly from an open request in one transaction. It reuses the customer and folio, records any entered price adjustment as a folio line, sets the deposit, creates an upcoming stay, and optionally assigns a room through the availability service. Repeating the call returns the existing reservation. The employee sees a 7/14/30-day room calendar, an unassigned queue, a reservation list, and a drawer with the guest, participant, stay, room, balance and next actions. The inbox and profile use the same current-context selection; the profile can also find bookings through `reservation_guests` when the customer is a participant rather than the booker.

Tasks display legacy `follow_ups` together with ordinary tasks, deduplicating matching contact actions. The former follow-up page remains available as a filtered contacts view inside Tasks; the physical table and existing actions remain for compatibility. The old event calendar is also inside Tasks. Today is operational; the previous sales dashboard and unchanged DRR, sales, performance, management and export reports are grouped under Analytics. Demo mode links existing confirmed stays to reservations for preview.

The physical `follow_ups` table and legacy stage-dependent analytics remain for compatibility. This checkout has not connected to the Railway production database.

## LES pilot operations, phase 3

`0005_operational_journey` is additive. It links checkout cleaning and operational tasks to stays, adds reservation arrival estimates, and creates `packages`, `package_entitlements`, `service_reservations`, and `guest_reviews`. Existing stays, services, reports, folios and reservations are retained. The LES sample package is inserted only when missing; bootstrap does not replace customer data. The migration has been applied by the full-stack test database, not by this checkout to Railway.

The reservation drawer now exposes arrival estimate, special requests, temporary reservation notes, room readiness, package entitlements, scheduled services, guest requests, and explicit arrival/departure actions. The Today and Inbox views show the current stay context and work needing attention. Customer profiles show real service history and reviews in database mode. The reputation workspace records actual reviews and internal reply status; it does not claim to publish responses to an external review platform.

Check-in requires a confirmed reservation within the arrival window, a single assigned room, no competing occupant or active maintenance block, and completed room preparation. A documented readiness override is possible for unfinished cleaning. Check-out checks the folio balance and scheduled services, requiring explicit acknowledgment of either issue. It completes the stay and reservation, releases the allocation while retaining its history, marks the room dirty or blocked, creates a single checkout cleaning task with checklist, and queues an internal post-stay review task. Repeated desk actions are idempotent. Inspection requires completed cleaning and checked checklist items and refuses a room with an occupant or maintenance block. Availability excludes rooms blocked by maintenance or actual occupancy and uses a room row lock for overlapping allocations.

Service reservations can be tied to a stay or booked for a standalone customer. They use catalog pricing, optional package entitlements, an idempotency key and, where chargeable, one folio line. Cancelling a service reverses that line. Separately billed packages add one package folio line. These operations do not infer revenue from request totals; existing analytics formulas and DRR are unchanged.

### Pilot audit and remaining boundaries

- All business screens changed in these phases use Russian labels, while technical identifiers and familiar acronyms (for example, SPA and DRR) remain English. Legacy libraries still emit development-only framework warnings.
- The service scheduler records a time and quantity but has no provider, room or capacity calendar. Staff must verify SPA/restaurant availability outside this module before confirming a slot.
- Maintenance blocks are currently open-ended until a ticket is verified or cancelled. There is no timed maintenance inventory block or automated PMS synchronization.
- External review channels are not connected. Review entry, response and follow-up are internal records; there is no automatic messaging or publication.
- `follow_ups` and `tasks` still coexist physically. The employee Tasks workspace unifies them in the UI; a data migration to one table requires a separate compatibility plan.
- Reports retain legacy lead-stage formulas until hotel stakeholders approve a replacement. This preserves DRR and historical comparisons but means some new Request/Reservation activity is not yet reflected in every sales metric.
- The pilot flow is validated against an isolated PostgreSQL-compatible test database and a local browser demo. Before a Railway rollout, take a production backup, inspect real orphan/duplicate rows and migration permissions, and rehearse `0003`–`0005` against a production snapshot. This checkout has not executed a production migration or deployment.

The domain split follows current product patterns: [Mews customer profile and timeline](https://help.mews.com/s/article/what-is-the-customer-module-and-what-does-it-contain?language=en_US), [Mews booker versus guest](https://help.mews.com/s/article/create-a-reservation), [Cloudbeds reservation context in the inbox](https://myfrontdesk.cloudbeds.com/hc/en-us/articles/27036237976091-Access-Cloudbeds-Guest-Experience-Chats-in-Cloudbeds-PMS-Inbox), [Revinate unified guest profile](https://info.revinate.com/rs/912-DWT-370/images/basic-CRM-vs-hospitality-CDP-guide.pdf), and [Canary journey messaging](https://www.canarytechnologies.com/products/guest-messaging).

## Validation

```bash
npm run typecheck
npm run lint
npm test
npm run build
```
