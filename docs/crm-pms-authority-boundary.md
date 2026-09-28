# CRM and PMS Authority Boundary & Integration Seams

This document establishes the precise boundary of authority between **Guestra CRM** and the property management system (**PMS**, e.g., `guestra_PMS`), along with the exact synchronization contracts that prevent data corruption, race conditions, or identity collisions.

---

## 1. Core Division of Responsibility

| Domain Entity / Capability | System of Record (Authority) | Secondary Consumer |
|---|---|---|
| **Guest Profile & Multi-channel Identities** (Telegram, Phone, Email, History, Preferences) | **CRM** | PMS (reads verified contact) |
| **Conversations & Automation Modes** (AI vs Human, Handoff, Telegram dispatch) | **CRM** | PMS (staff sees conversation link) |
| **Inquiries & Commercial Requests** (Lead stages, Classification, Intent, Quality) | **CRM** | PMS (none / read-only) |
| **Commercial Offers & Quotes** (Offer lines, Expiry, Deposit terms) | **CRM** | PMS (none) |
| **Service Catalog & Add-on Bookings** (SPA, Activities, Equipment, Capacity) | **CRM** | PMS (reads posted folio charges) |
| **In-house Guest Requests** (Guest amenities, Concierge, Complaints) | **CRM** | PMS (operational task queue) |
| **Commercial Folio & Charge Tracking** (Line items, Prepayments, Entitlements) | **CRM** | PMS (mirrors or syncs on checkout) |
| **Physical Room Inventory & Room Numbers** (Specific doors, Floors, Wings) | **PMS** | CRM (reads available categories / allocations) |
| **Room Cleaning & Maintenance States** (Vacant Clean, Vacant Dirty, Out of Order) | **PMS** | CRM (reads readiness for check-in) |
| **Official Check-In & Check-Out Execution** (Keycard issuance, Registration cards) | **PMS** | CRM (receives stay state transition) |
| **OTA / Channel Management** (Booking.com, Expedia, Channel sync) | **PMS** | CRM (receives booking confirmation webhook) |
| **Night Audit & Fiscal Compliance** (Local tax reporting, Fiscal cash register) | **PMS** | CRM (none) |

---

## 2. Key Architectural Invariants

### 1. Reservation Identifiers Never Mix
- **Local CRM Reservation ID (`reservations.id`)**: An internal UUID/prefixed string (`reservation_...`) generated exclusively by CRM. It is the foreign key for `leads.reservationId`, `guestStays.reservationId`, `folios.reservationId`, and `serviceReservations.reservationId`.
- **External PMS Reservation ID (`reservations.externalReservationId`)**: The identifier assigned by PMS or an external OTA channel. Stored in `reservations.externalReservationId` with a unique index per property.
- **External Confirmation Number (`reservations.externalConfirmationNumber`)**: Human-facing confirmation code (e.g. `G-12345` or OTA code).
- **Rule**: `leads.reservationId` MUST always reference `reservations.id` (CRM local ID), never `externalReservationId`.

### 2. Category-First vs Unit-Level Selection
- **CRM / AI Agent**: Operates strictly at the **Room Category** level (`unitTypes`: e.g. "A-Frame", "Sky House", "Nest House"). The guest selects a category, dates, and occupancy. Physical room numbers are NEVER exposed to the guest during quoting or live booking.
- **PMS / Back-office**: Manages physical units (`rooms`: e.g. "101", "A-1"). The CRM allocates physical rooms automatically in deterministic order or delegates assignment to PMS.

### 3. Identity Verification Before Access
- Unverified contacts communicating via Telegram start as **stubs** (`profileStatus = 'stub'`).
- A stub cannot view folios, booker stays, or private guest data.
- Elevation to verified status requires `POST /identity/verify` with matching booking reference and normalized phone number.
- Safe stub merge verifies that the stub possesses no dangling financial or operational records (notes, payments, services, tasks, folios) before merging into a target profile.

---

## 3. Integration Seams

### Seam 1: External Booking Confirmation (`POST /api/integrations/ai/bookings/confirm` or `/bookings/confirm`)
When PMS or an external channel confirms a booking:
1. PMS sends: `channel`, `externalUserId`, `propertyId`, `confirmationNumber`, `reservationId` (PMS ID), `roomType`, `checkIn`, `checkOut`, `adults`, `children`, `grandTotal`, `currency`.
2. CRM creates or resolves the Customer identity idempotently.
3. CRM creates local `reservations` record:
   - `id`: Local UUID
   - `externalReservationId`: PMS reservation ID
   - `externalConfirmationNumber`: Confirmation number
4. CRM updates or creates the linked `leads` (Request):
   - `leads.reservationId = reservation.id` (Local CRM ID)
   - `leads.bookingReference = confirmationNumber`
   - `leads.stage = 'confirmed'`
5. CRM provisions `guestStays` (upcoming stay) and `folios` with line items.
6. Returns: `{ reservationId: localId, confirmationNumber, duplicate: boolean }`.

### Seam 2: Service-Only Guest Journey
For day visitors or non-resident guests booking resort services (SPA, restaurant, horseback riding, ATV):
1. Inbound contact is classified (`/conversations/classify`) with `direction: 'spa' | 'restaurant' | ...`.
2. A commercial Request is upserted (`/requests/upsert`) with that direction.
3. Conversation lifecycle advances to `service_only`.
4. Live booking (`/services/book`) creates a scheduled `serviceReservations` record and provisions a standalone service `folio`.
5. If the guest later books accommodation, the standalone service and folio line merge seamlessly into the stay folio via `/service-reservations/:id/link-reservation`.

### Seam 3: Stay Extension Seam
When an in-house guest requests an extension:
1. CRM verifies that:
   - Stay status is `in_house` or `due_out`.
   - Contact is the verified booker.
   - The physical unit has no conflicting reservation starting before the new departure time.
   - The folio contains an authoritative nightly rate without discretionary discounts.
2. Extension preview (`/stays/extension/preview`) calculates additional nights and charge.
3. After proposal and guest confirmation, extension (`/stays/extend`) transactionally updates `reservations.departureAt`, `guestStays.checkOut`, and adjusts folio lines without creating duplicate accommodation items.
4. PMS receives updated departure time and room allocation.
