# Hospitality request, desk note and checkout model

## Request Kanban

The Kanban card is a **Request** (`leads` physical table), never a Guest profile. Its canonical lifecycle is `request_lifecycle`: **Enquire → Tentative → Definite**. A manager can move a card in either direction. `won`, `lost`, and `closed` remain terminal outcomes and are not mixed into working columns.

`stage` and `request_status` remain unchanged compatibility fields for existing analytics, n8n and Agent API consumers. `lead_classifications` (`quality`, `temperature`, `probability`, `direction`, including AI/manual override) remains an independent assessment dimension. Every lifecycle move is written to `request_lifecycle_history` with before/after status, author, time, source and optional reason.

## Desk notes and alerts

Profile notes and reservation notes are separate records. Both carry author, property scope, priority, pinned/alert flags, validity dates and display areas. Desk views filter expired notes and put active alerts first. This follows the operational distinction used by PMS systems: profile instructions persist across stays, while reservation instructions apply only to that particular arrival.

## Folio and checkout

The live `folios` / `folio_lines` ledger remains the accounting source of truth. `GET /api/crm/folios/:id/guest-view` exposes a guest-safe view. `GET /api/crm/folios/:id/print` is a print-ready document that can be saved as PDF by the browser.

At checkout, the server locks reservation, stay and room rows, rejects a positive balance and scheduled services, writes an immutable final folio snapshot, closes the folio, checks out the stay, completes the reservation, releases allocation, sets the room to vacant-dirty (or out-of-order), creates housekeeping and records guest activity. Corporate AR / direct-bill deliberately remains a future privileged settlement method, not a receptionist bypass.

## Design references

- Bitrix24 Kanban treats a card as a CRM item moving through configured stages, while the contact remains separate: https://helpdesk.bitrix24.com/open/25962255/
- Oracle OPERA requires settlement before Checkout Now and supports interim folios independently of departure: https://docs.oracle.com/en/industries/hospitality/opera-cloud/24.1/ocsuh/t_manage_billing_settling_a_reservation_account_balance.htm
- OPERA folio history retains generated folios and supports sending them: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.1/ocsuh/t_advance_billing_viewing_folio_histories.htm
