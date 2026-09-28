# Guestra Agent API v1

The Agent API is a protected integration surface for n8n and Telegram. Guestra remains the system of record and executes all domain changes through its backend services. The API does not run LLM reasoning.

## Authentication and base path

All endpoints are mounted under `/api/integrations/agent`. Send `x-crm-api-key: <CRM_INTEGRATION_API_KEY>`. Use JSON request bodies except for the documented query endpoints. The capability response identifies the contract version (`agent-api-v1`), supported tools, lifecycle states, booking modes, and feature flags. Do not expose API keys, CRM identifiers, folio data, or physical unit numbers in guest-facing text unless context explicitly permits it.

## Telegram message loop

1. Telegram Trigger sends `POST /messages/inbound` with `channel`, `externalUserId`, `externalChatId`, `externalMessageId`, optional `externalUpdateId`, optional `username`/`firstName`, `text`, and `propertyId`.
2. Guestra resolves or creates a stub Customer and Conversation, persists one inbound Message, and returns the normalized context, `aiReplyAllowed`, and `allowedActions`. A repeated update/message is idempotent; reused keys with changed payload return `IDEMPOTENCY_CONFLICT`.
3. Only when `aiReplyAllowed` is true, n8n gives the model the context and its allowed actions. The model may call only the listed business tools below. Guestra rechecks lifecycle, identity, ownership, availability, and domain rules on every operation.
4. Prepare a reply with `POST /messages/outbound/prepare`, then send the returned text through Telegram. Report the Telegram result with `POST /messages/outbound/result`; only a confirmed send is recorded as sent. On transport failure, report `success:false`; retry with the same idempotency key. Human replies use the same outbound delivery contract from the CRM.

The result endpoint body includes `propertyId`, `externalUserId`, `conversationId`, `messageId`, `idempotencyKey`, `success`, and `externalMessageId` on success. Outbound dispatch from CRM to n8n uses the separate configured webhook token (`AGENT_OUTBOUND_WEBHOOK_TOKEN`), not the CRM API key.

## Endpoints

| Method | Path | Purpose |
|---|---|---|
| GET | `/capabilities` | Discover version, tools, states, policies, and flags |
| POST | `/messages/inbound` | Persist Telegram inbound update and return context |
| POST | `/context` | Reload context for a linked Telegram identity |
| GET | `/property-knowledge` | Search active property FAQ by topic, text, tags, language |
| GET | `/accommodations/options` | Return active categories and structured descriptions fitting occupancy |
| POST | `/accommodations/availability` | Check categories across dates and occupancy; never asks guest to pick a room number |
| POST | `/conversations/classify` | Save AI classification without creating a Request |
| POST | `/requests/upsert` | Create/update a genuine commercial Request; non-target conversations remain without one |
| POST | `/offers/create` | Create a CRM offer for an eligible Request |
| GET | `/services/options` | Return guest-safe service catalog and booking modes |
| POST | `/services/availability` | Check resource-backed live-booking slots |
| POST | `/services/book` | Book a proposed service after explicit confirmation |
| POST | `/services/reschedule` | Reschedule a permitted booking after explicit confirmation |
| POST | `/services/cancel` | Cancel a permitted booking after explicit confirmation |
| POST | `/accommodations/book` | Confirm an offer; backend rechecks category inventory and assigns a physical unit transactionally |
| POST | `/guest-requests` | Create an in-house guest request grounded in an inbound message |
| POST | `/handoff` | Transfer the conversation to staff with a reason and summary |
| POST | `/stay-context` | Read stay details allowed for the linked identity |
| POST | `/folio-summary` | Read folio summary only for an identity/lifecycle allowed by backend |
| POST | `/identity/verify` | Link an unverified Telegram identity with booking reference and normalized phone |
| POST | `/messages/outbound/prepare` | Persist a reply and optional exact action proposal before Telegram send |
| POST | `/messages/outbound/result` | Record Telegram delivery success/failure |
| POST | `/stays/extension/preview` | Quote an allowed extension using authoritative folio night rates and availability |
| POST | `/stays/extend` | Extend after proposal and explicit guest confirmation, with transactional recheck |

The request schemas live in `server/contracts/agent-contract.ts`. All date-times use ISO 8601 with an offset. Service options expose `live_booking`, `request_only`, `info_only`, or `disabled`; request-only services such as restaurant/event inquiries cannot be marked as confirmed bookings.

## Action confirmation and idempotency

Accommodation booking, service booking/cancel/reschedule, and stay extension require a proposal that was successfully sent in the same conversation, followed by a later inbound guest message with an explicit confirmation. The write call supplies both `proposalMessageId` and `confirmationMessageId`; payload must exactly match the proposal, the proposal is valid for 30 minutes, and each action can execute once. The backend caches successful results for safe retries. Never infer a confirmation from the model's own text or from an earlier message.

Every mutation carries an idempotency key. Reusing it with a different payload is a conflict. Availability checks are advisory; each booking repeats the check while holding the appropriate transaction locks. Accommodation requests specify category and dates; backend chooses an eligible unit in deterministic order. Physical unit numbers are internal allocation data.

## Identity, ownership, and escalation

A Telegram account sees private reservation/stay/folio context only through its linked identity. A new account must pass booking-reference plus phone verification before linking; name alone is not proof. Verification throttles repeated failures and can request staff review. While conversation mode is `human` or `needs_human`, context sets `aiReplyAllowed:false` and returns no AI actions. Escalation reason codes include discount, refund/payment issue, complaint, uncertainty, unsupported action, complex event, and guest-requested human. Discounts, refunds, payment corrections, room moves, and lifecycle overrides remain staff-only.

## Errors

Errors use `{ "error": "...", "code": "...", "retryable": false, "handoffRecommended": false }`. Stable codes are exported as `AGENT_ERROR_CODES` in the shared contract: `UNAUTHORIZED`, `VALIDATION_ERROR`, `INTERNAL_ERROR`, `IDENTITY_NOT_FOUND`, `IDENTITY_VERIFICATION_REQUIRED`, `CONVERSATION_NOT_FOUND`, `CONVERSATION_HUMAN_OWNED`, `ACTION_NOT_ALLOWED`, `CONFIRMATION_REQUIRED`, `CONFIRMATION_STALE`, `CONFIRMATION_PAYLOAD_MISMATCH`, `IDEMPOTENCY_CONFLICT`, `NO_AVAILABILITY`, `PRICE_NOT_AUTHORITATIVE`, `SERVICE_NOT_LIVE_BOOKABLE`, `RESOURCE_CONFLICT`, `REQUEST_NOT_FOUND`, `OFFER_EXPIRED`, `HANDOFF_REQUIRED`, `DELIVERY_FAILED`, and `CLASSIFICATION_MANUAL_OVERRIDE`. Retry only when the response marks an error retryable or when retrying the same idempotent delivery/action.

## Deployment

The migration `0010_agent_contract_hardening.sql` is additive and safe for existing PostgreSQL records. Configure `CRM_INTEGRATION_API_KEY`, `AGENT_OUTBOUND_WEBHOOK_TOKEN`, and the outbound webhook URL in the server environment. Do not put Telegram credentials in the CRM frontend or commit credentials. No n8n workflow is included in this CRM stage.
