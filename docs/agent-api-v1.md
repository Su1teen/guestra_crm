# Guestra Agent API v1

The Agent API is a protected integration surface for n8n and Telegram. Guestra remains the system of record and executes all domain changes through its backend services. The API does not run LLM reasoning.

## Authentication and base path

All endpoints are mounted under `/api/integrations/agent`. Send `x-crm-api-key: <CRM_INTEGRATION_API_KEY>`. Use JSON request bodies except for the documented query endpoints. The capability response identifies the contract version (`agent-api-v1`), supported tools, tool descriptors, lifecycle states, booking modes, and feature flags. Do not expose API keys, CRM identifiers, folio data, or physical unit numbers in guest-facing text unless context explicitly permits it.

## Telegram message loop

1. Telegram Trigger sends `POST /messages/inbound` with `channel`, `externalUserId`, `externalChatId`, `externalMessageId`, optional `externalUpdateId`, optional `username`/`firstName`, `text`, and `propertyId`.
2. Guestra resolves or creates a stub Customer and Conversation, persists one inbound Message, and returns the normalized context, `aiReplyAllowed`, `allowedActions`, and `activeProposal`. A repeated update/message is idempotent; reused keys with changed payload return `IDEMPOTENCY_CONFLICT`.
3. Only when `aiReplyAllowed` is true, n8n gives the model the context and its allowed actions. The model may call only the listed business tools below. Guestra rechecks lifecycle, identity, ownership, availability, and domain rules on every operation.
4. Prepare a reply with `POST /messages/outbound/prepare`, then send the returned text through Telegram. Report the Telegram result with `POST /messages/outbound/result`; only a confirmed send is recorded as sent. On transport failure, report `success:false`; retry with the same idempotency key. Human replies use the same outbound delivery contract from the CRM.

The result endpoint body includes `propertyId`, `externalUserId`, `conversationId`, `messageId`, `idempotencyKey`, `success`, and `externalMessageId` on success. Outbound dispatch from CRM to n8n uses the separate configured webhook token (`AGENT_OUTBOUND_WEBHOOK_TOKEN`), not the CRM API key.

## Tool Catalog & Descriptors

| Tool | Method | Path | Mutation | Confirmation Required | Description |
|---|---|---|---|---|---|
| `get_context` | POST | `/context` | No | No | Load identity-scoped CRM context |
| `classify_conversation` | POST | `/conversations/classify` | Yes | No | Record AI conversation classification |
| `get_property_knowledge` | GET | `/property-knowledge` | No | No | Query property FAQ and policies |
| `get_accommodation_options` | GET | `/accommodations/options` | No | No | List accommodation categories for occupancy |
| `check_accommodation_availability` | POST | `/accommodations/availability` | No | No | Check category availability for dates |
| `create_or_update_request` | POST | `/requests/upsert` | Yes | No | Upsert commercial lead/request |
| `create_offer` | POST | `/offers/create` | Yes | No | Generate binding commercial offer |
| `book_accommodation` | POST | `/accommodations/book` | Yes | Yes | Confirm accommodation booking from accepted offer |
| `get_service_options` | GET | `/services/options` | No | No | List service catalog items |
| `check_service_availability` | POST | `/services/availability` | No | No | Assess live booking service slot |
| `book_service` | POST | `/services/book` | Yes | Yes | Book scheduled resort service |
| `reschedule_service` | POST | `/services/reschedule` | Yes | Yes | Reschedule existing service booking |
| `cancel_service` | POST | `/services/cancel` | Yes | Yes | Cancel scheduled service booking |
| `get_stay_context` | POST | `/stay-context` | No | No | Retrieve stay details for verified guest |
| `get_folio_summary` | POST | `/folio-summary` | No | No | View folio balance and charges if permitted |
| `create_guest_request` | POST | `/guest-requests` | Yes | No | Create operational in-house guest request |
| `check_stay_extension` | POST | `/stays/extension/preview` | No | No | Preview stay extension price and feasibility |
| `extend_stay` | POST | `/stays/extend` | Yes | Yes | Extend active stay with confirmed payment |
| `handoff_to_human` | POST | `/handoff` | Yes | No | Escalate conversation to human staff |

Infrastructure endpoints:
- `GET /capabilities` — Discover version, tools, states, policies, and flags
- `POST /identity/verify` — Link an unverified Telegram identity with booking reference and normalized phone
- `POST /messages/outbound/prepare` — Persist reply and optional action proposal before Telegram transport
- `POST /messages/outbound/result` — Record Telegram delivery outcome

## N8N Execution Contract

When building or invoking n8n workflows that orchestrate between Telegram and Guestra CRM:

1. **Trigger Handling**:
   - Receive Telegram webhook/polling event.
   - Construct `idempotencyKey` deterministically: `${update_id}` or `${chat_id}:${message_id}`.
   - Call `POST /api/integrations/agent/messages/inbound`.

2. **Gating Check**:
   - Inspect response: if `aiReplyAllowed === false`, **stop execution immediately**. Do NOT call the LLM or invoke tools. The conversation is currently owned by human staff (`human`) or awaiting staff attention (`needs_human`).
   - If `aiReplyAllowed === true`, provide the model with `context` and `allowedActions`.

3. **Tool Execution Guard**:
   - The LLM must ONLY invoke tools present in `context.allowedActions`.
   - All mutation endpoints require unique, reproducible `idempotencyKey` strings.

4. **Action Confirmation Protocol**:
   - For actions requiring explicit confirmation (`book_accommodation`, `book_service`, `reschedule_service`, `cancel_service`, `extend_stay`):
     - Step A: When the model wants to suggest an action, call `POST /messages/outbound/prepare` with `proposedAction: { actionType, payload }`.
     - Step B: Send the prepared message text to Telegram.
     - Step C: Call `POST /messages/outbound/result` with `success: true` and `externalMessageId`.
     - Step D: When the guest replies in the next turn confirming explicitly ("Да, бронируйте"), verify confirmation with `isExplicitConfirmation()`.
     - Step E: Call the confirmed endpoint (e.g. `POST /services/book`) providing `proposalMessageId` from Step A and `confirmationMessageId` from the guest's reply.

5. **Outbound Dispatch (CRM to Guest)**:
   - When human operators reply in Guestra CRM, Guestra calls n8n via webhook (`AGENT_OUTBOUND_WEBHOOK_URL`) with header `x-agent-webhook-token: <AGENT_OUTBOUND_WEBHOOK_TOKEN>`.
   - n8n sends the message via Telegram `sendMessage`.
   - n8n reports status back to `POST /api/integrations/agent/messages/outbound/result`.

6. **Error & Handoff Routing**:
   - If response returns `handoffRecommended: true` or status 409 with unresolvable conflict, invoke `POST /handoff` with appropriate `reasonCode`.
   - If response returns `retryable: true`, n8n may retry after an exponential backoff.

## Request & Response Examples

### 1. Inbound Message (`POST /messages/inbound`)

**Request**:
```json
{
  "channel": "telegram",
  "externalUserId": "123456789",
  "externalChatId": "123456789",
  "externalMessageId": "9876",
  "externalUpdateId": "update_1001",
  "username": "guest_user",
  "firstName": "Алиса",
  "text": "Здравствуйте! Хотим забронировать домик на 2 дня в октябре",
  "propertyId": "les_borovoe"
}
```

**Response (201 Created)**:
```json
{
  "duplicate": false,
  "messageId": "message_abc123",
  "aiReplyAllowed": true,
  "allowedActions": [
    "get_property_knowledge",
    "get_accommodation_options",
    "check_accommodation_availability",
    "get_service_options",
    "check_service_availability",
    "classify_conversation",
    "create_or_update_request",
    "handoff_to_human"
  ],
  "context": {
    "contractVersion": "agent-api-v1",
    "property": { "id": "les_borovoe", "name": "Лес Боровое", "timezone": "Asia/Qyzylorda" },
    "conversation": {
      "id": "conversation_xyz789",
      "channel": "telegram",
      "automationMode": "ai",
      "handoffReasonCode": null,
      "handoffNote": null,
      "requestedAction": null
    },
    "customer": { "id": "guest_111", "name": "Алиса", "repeatGuest": false, "stayCount": 0 },
    "lifecycle": "new_contact",
    "request": null,
    "offer": null,
    "reservation": null,
    "serviceReservations": [],
    "recentMessages": [
      { "id": "message_abc123", "senderType": "contact", "direction": "in", "text": "Здравствуйте! Хотим забронировать домик на 2 дня в октябре", "at": "2026-10-01T10:00:00.000Z" }
    ],
    "activeProposal": null,
    "allowedActions": ["get_property_knowledge", "get_accommodation_options", "check_accommodation_availability", "get_service_options", "check_service_availability", "classify_conversation", "create_or_update_request", "handoff_to_human"],
    "aiReplyAllowed": true
  }
}
```

### 2. Accommodation Availability (`POST /accommodations/availability`)

**Request**:
```json
{
  "propertyId": "les_borovoe",
  "arrivalAt": "2026-10-15T15:00:00.000+05:00",
  "departureAt": "2026-10-17T12:00:00.000+05:00",
  "adults": 2,
  "children": 0
}
```

**Response (200 OK)**:
```json
{
  "propertyId": "les_borovoe",
  "arrivalAt": "2026-10-15T15:00:00.000+05:00",
  "departureAt": "2026-10-17T12:00:00.000+05:00",
  "adults": 2,
  "children": 0,
  "items": [
    {
      "id": "ut_aframe",
      "name": "A-Frame",
      "availableUnitsCount": 3,
      "price": { "amount": 65000, "currency": "KZT", "pricingMode": "per_night", "unit": "night", "source": "crm_catalog" },
      "priceAvailability": "available"
    }
  ]
}
```

### 3. Create or Update Commercial Request (`POST /requests/upsert`)

**Request**:
```json
{
  "propertyId": "les_borovoe",
  "externalUserId": "123456789",
  "conversationId": "conversation_xyz789",
  "idempotencyKey": "req-upsert-001",
  "direction": "accommodation",
  "checkIn": "2026-10-15T15:00:00.000+05:00",
  "checkOut": "2026-10-17T12:00:00.000+05:00",
  "adults": 2,
  "children": 0,
  "category": "A-Frame",
  "quality": "target",
  "temperature": "hot",
  "probability": 75,
  "classificationReasons": [{ "code": "dates_and_category_chosen", "label": "Выбраны даты и категория" }]
}
```

**Response (201 Created)**:
```json
{
  "requestId": "lead_456",
  "created": true,
  "duplicate": false
}
```

### 4. Create Offer (`POST /offers/create`)

**Request**:
```json
{
  "propertyId": "les_borovoe",
  "externalUserId": "123456789",
  "conversationId": "conversation_xyz789",
  "category": "A-Frame",
  "idempotencyKey": "offer-create-001"
}
```

**Response (201 Created)**:
```json
{
  "offerId": "offer_789",
  "code": "O-LES-10023",
  "status": "viewed",
  "category": "A-Frame",
  "arrivalAt": "2026-10-15T15:00:00.000+05:00",
  "departureAt": "2026-10-17T12:00:00.000+05:00",
  "nights": 2,
  "total": 130000,
  "currency": "KZT",
  "expiresAt": "2026-10-02T10:00:00.000Z",
  "priceSource": "crm_catalog",
  "duplicate": false
}
```

### 5. Outbound Prepare with Proposal (`POST /messages/outbound/prepare`)

**Request**:
```json
{
  "propertyId": "les_borovoe",
  "externalUserId": "123456789",
  "conversationId": "conversation_xyz789",
  "text": "Забронировать A-Frame на 15–17 октября за 130 000 KZT?",
  "idempotencyKey": "outbound-001",
  "proposedAction": {
    "actionType": "book_accommodation",
    "payload": { "offerId": "offer_789" }
  }
}
```

**Response (201 Created)**:
```json
{
  "messageId": "message_prop_001",
  "conversationId": "conversation_xyz789",
  "text": "Забронировать A-Frame на 15–17 октября за 130 000 KZT?",
  "deliveryStatus": "pending",
  "proposedAction": {
    "actionType": "book_accommodation",
    "payload": { "offerId": "offer_789" },
    "payloadHash": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    "expiresAt": "2026-10-01T10:30:00.000Z"
  },
  "duplicate": false
}
```

### 6. Outbound Delivery Result (`POST /messages/outbound/result`)

**Request**:
```json
{
  "propertyId": "les_borovoe",
  "externalUserId": "123456789",
  "conversationId": "conversation_xyz789",
  "messageId": "message_prop_001",
  "idempotencyKey": "outbound-001",
  "success": true,
  "externalMessageId": "tg_msg_888"
}
```

**Response (200 OK)**:
```json
{
  "messageId": "message_prop_001",
  "deliveryStatus": "sent",
  "duplicate": false
}
```

### 7. Confirmed Accommodation Booking (`POST /accommodations/book`)

**Request**:
```json
{
  "propertyId": "les_borovoe",
  "externalUserId": "123456789",
  "conversationId": "conversation_xyz789",
  "offerId": "offer_789",
  "proposalMessageId": "message_prop_001",
  "confirmationMessageId": "message_guest_confirm_002",
  "idempotencyKey": "action-confirm-001"
}
```

**Response (201 Created)**:
```json
{
  "reservationId": "reservation_999",
  "stayId": "stay_888",
  "requestId": "lead_456",
  "confirmationNumber": "G-AB12CD34EF",
  "category": "A-Frame",
  "arrivalAt": "2026-10-15T15:00:00.000+05:00",
  "departureAt": "2026-10-17T12:00:00.000+05:00",
  "total": 130000,
  "currency": "KZT",
  "duplicate": false
}
```

### 8. Identity Verification (`POST /identity/verify`)

**Request**:
```json
{
  "propertyId": "les_borovoe",
  "externalUserId": "123456789",
  "bookingReference": "G-AB12CD34EF",
  "phone": "+7 701 555 44 33",
  "idempotencyKey": "verify-001"
}
```

**Response (200 OK)**:
```json
{
  "linked": true,
  "customerId": "guest_verified_123",
  "conversationId": "conversation_xyz789",
  "duplicate": false,
  "context": {
    "contractVersion": "agent-api-v1",
    "lifecycle": "pre_arrival",
    "reservation": {
      "id": "reservation_999",
      "role": "booker",
      "category": "A-Frame",
      "arrivalAt": "2026-10-15T15:00:00.000+05:00",
      "departureAt": "2026-10-17T12:00:00.000+05:00"
    }
  }
}
```

### 9. Handoff to Human Staff (`POST /handoff`)

**Request**:
```json
{
  "propertyId": "les_borovoe",
  "externalUserId": "123456789",
  "conversationId": "conversation_xyz789",
  "reasonCode": "custom_discount",
  "summary": "Гость просит скидку 30% на проживание 5 дней",
  "priority": "high",
  "requestedAction": "Согласовать индивидуальную скидку"
}
```

**Response (200 OK)**:
```json
{
  "conversationId": "conversation_xyz789",
  "automationMode": "needs_human",
  "reasonCode": "custom_discount",
  "handoffNote": "Гость просит скидку 30% на проживание 5 дней",
  "requestedAction": "Согласовать индивидуальную скидку",
  "handoffRequestedAt": "2026-10-01T10:15:00.000Z",
  "priority": "high",
  "duplicate": false
}
```

## Action confirmation and idempotency

Accommodation booking, service booking/cancel/reschedule, and stay extension require a proposal that was successfully sent in the same conversation, followed by a later inbound guest message with an explicit confirmation. The write call supplies both `proposalMessageId` and `confirmationMessageId`; payload must exactly match the proposal, the proposal is valid for 30 minutes, and each action can execute once. The backend caches successful results for safe retries. Never infer a confirmation from the model's own text or from an earlier message.

Every mutation carries an idempotency key. Reusing it with a different payload is a conflict. Availability checks are advisory; each booking repeats the check while holding the appropriate transaction locks. Accommodation requests specify category and dates; backend chooses an eligible unit in deterministic order. Physical unit numbers are internal allocation data.

## Identity, ownership, and escalation

A Telegram account sees private reservation/stay/folio context only through its linked identity. A new account must pass booking-reference plus phone verification before linking; name alone is not proof. Verification throttles repeated failures and can request staff review. While conversation mode is `human` or `needs_human`, context sets `aiReplyAllowed:false` and returns no AI actions. Escalation reason codes include discount, refund/payment issue, complaint, uncertainty, unsupported action, complex event, and guest-requested human. Discounts, refunds, payment corrections, room moves, and lifecycle overrides remain staff-only.

## Errors

Errors use `{ "error": "...", "code": "...", "retryable": false, "handoffRecommended": false }`. Stable codes are exported as `AGENT_ERROR_CODES` in the shared contract: `UNAUTHORIZED`, `VALIDATION_ERROR`, `INTERNAL_ERROR`, `IDENTITY_NOT_FOUND`, `IDENTITY_VERIFICATION_REQUIRED`, `CONVERSATION_NOT_FOUND`, `CONVERSATION_HUMAN_OWNED`, `ACTION_NOT_ALLOWED`, `CONFIRMATION_REQUIRED`, `CONFIRMATION_STALE`, `CONFIRMATION_PAYLOAD_MISMATCH`, `IDEMPOTENCY_CONFLICT`, `NO_AVAILABILITY`, `PRICE_NOT_AUTHORITATIVE`, `SERVICE_NOT_LIVE_BOOKABLE`, `RESOURCE_CONFLICT`, `REQUEST_NOT_FOUND`, `OFFER_EXPIRED`, `HANDOFF_REQUIRED`, `DELIVERY_FAILED`, `MESSAGE_NOT_FOUND`, and `CLASSIFICATION_MANUAL_OVERRIDE`. Retry only when the response marks an error retryable or when retrying the same idempotent delivery/action.

## Deployment

The migration `0010_agent_contract_hardening.sql` is additive and safe for existing PostgreSQL records. Configure `CRM_INTEGRATION_API_KEY`, `AGENT_OUTBOUND_WEBHOOK_TOKEN`, and the outbound webhook URL in the server environment. Do not put Telegram credentials in the CRM frontend or commit credentials. The companion n8n import and setup guide live in `integrations/n8n/`.
