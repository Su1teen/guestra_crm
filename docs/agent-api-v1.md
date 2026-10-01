# Guestra Agent API v1

The Agent API is a protected, channel-neutral integration surface for orchestration clients: n8n (Telegram, WhatsApp), future adapters (Instagram), and the Guestra Agent Hub simulator. Guestra CRM remains the sole system of record and executes all domain changes through its backend services. The API does not run LLM reasoning, and orchestration clients never access PostgreSQL directly — they call this API.

## Authentication and base path

All endpoints are mounted under `/api/integrations/agent`. Send `x-crm-api-key: <CRM_INTEGRATION_API_KEY>`. Use JSON request bodies except for the documented query endpoints. The capability response identifies the contract version (`agent-api-v1`), supported channels, tools, tool descriptors, lifecycle states, booking modes, attachment kinds, and feature flags. Do not expose API keys, CRM identifiers, folio data, or physical unit numbers in guest-facing text unless context explicitly permits it.

## Channels

| Channel | Value | Inbound | Outbound transport |
|---|---|---|---|
| Telegram | `telegram` | `POST /messages/inbound` | webhook (`AGENT_OUTBOUND_WEBHOOK_URL`) |
| WhatsApp | `whatsapp` | `POST /messages/inbound` | webhook (`WHATSAPP_OUTBOUND_WEBHOOK_URL`) |
| Instagram | `instagram` | `POST /messages/inbound` | adapter not yet configured — outbound reports `DELIVERY_FAILED` |
| Agent Hub simulator | `simulator` | `POST /messages/inbound` | local — marked `sent` by CRM, polled via `GET /conversations/:id/messages` |

Identity is resolved per `(channel, externalUserId)`: the same person on two channels produces two separate identities until a human or verification flow merges them. All identity-scoped endpoints accept `channel` (default `telegram` for backward compatibility), `externalUserId`, `propertyId`, and either `conversationId` or `externalChatId` for conversation scoping. Cross-channel reads return `IDENTITY_NOT_FOUND`/`CONVERSATION_NOT_FOUND`.

## Channel message loop

1. The adapter sends `POST /messages/inbound` with `channel`, `externalUserId`, `externalChatId`, `externalMessageId`, optional `externalUpdateId`, optional contact fields (`username`, `firstName`, `lastName`, `displayName`, `phone`, `email`, `language`), optional `attachments`, `text`, and `propertyId`. Either `text` or at least one attachment is required.
2. Guestra resolves or creates a stub Customer and Conversation, persists one inbound Message (durable transcript) with its attachments, and returns `conversationId` inside `context.conversation.id`, the normalized context, `aiReplyAllowed`, `allowedActions`, and `activeProposal`. A repeated update/message is idempotent; reused keys with changed payload return `IDEMPOTENCY_CONFLICT`.
3. Only when `aiReplyAllowed` is true, the orchestrator gives the model the context and its allowed actions. The model may call only the listed business tools below. Guestra rechecks lifecycle, identity, ownership, availability, and domain rules on every operation.
4. Prepare a reply with `POST /messages/outbound/prepare`, then send the returned text through the channel. Report the outcome with `POST /messages/outbound/result`; only a confirmed send is recorded as sent. On transport failure, report `success:false`; retry with the same idempotency key. Human replies use the same outbound delivery contract from the CRM.

The result endpoint body includes `channel`, `propertyId`, `externalUserId`, `conversationId`, `messageId`, `idempotencyKey`, `success`, and `externalMessageId` on success. Outbound dispatch from CRM to n8n uses the separate configured webhook token (`AGENT_OUTBOUND_WEBHOOK_TOKEN` / `WHATSAPP_OUTBOUND_WEBHOOK_TOKEN`), not the CRM API key.

### Simulator loop (Agent Hub)

The simulator needs no channel credentials:

1. `POST /messages/inbound` with `channel:"simulator"` — creates guest/identity/conversation exactly like any channel.
2. `POST /messages/outbound/prepare` — creates the durable outbound message.
3. `GET /conversations/:id/messages?channel=simulator&propertyId=…&externalUserId=…` — poll the transcript; use `after=<messageId>` cursor and `limit` for incremental reads. Messages include `deliveryStatus` and `attachments`.
4. `POST /messages/outbound/result` — confirm receipt; the simulator transport already marks messages `sent` with `externalMessageId = "simulator:<messageId>"`, so a matching confirmation returns `duplicate:true`.

## Tool Catalog & Descriptors

| Tool | Method | Path | Mutation | Confirmation Required | Description |
|---|---|---|---|---|---|
| `get_context` | POST | `/context` | No | No | Load identity-scoped CRM context |
| `classify_conversation` | POST | `/conversations/classify` | Yes | No | Record AI conversation classification |
| `get_property_knowledge` | GET | `/property-knowledge` | No | No | Query property FAQ and policies |
| `get_accommodation_options` | GET | `/accommodations/options` | No | No | List accommodation categories for occupancy |
| `check_accommodation_availability` | POST | `/accommodations/availability` | No | No | Check category availability for dates |
| `create_or_update_request` | POST | `/requests/upsert` | Yes | No | Upsert commercial lead/request |
| `update_request_lifecycle` | POST | `/requests/lifecycle` | Yes | No | Move request through enquire/tentative/definite/lost/closed |
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
| `update_guest_profile` | POST | `/guests/profile` | Yes | No | Persist allowlisted guest facts collected in conversation |
| `update_conversation_memory` | POST | `/conversations/memory` | Yes | No | Store versioned compact conversation memory |

Infrastructure endpoints:
- `GET /capabilities` — Discover version, channels, tools, states, policies, and flags
- `POST /identity/verify` — Link an unverified channel identity with booking reference and normalized phone
- `POST /messages/outbound/prepare` — Persist reply and optional action proposal before channel transport
- `POST /messages/outbound/result` — Record channel delivery outcome
- `GET /conversations/:id/messages` — Identity-scoped transcript read for orchestration clients (cursor: `after`, `limit`)
- `POST /messages/:messageId/attachments/:attachmentId/process-result` — Report async attachment processing (e.g. voice transcription)

## Request lifecycle

`update_request_lifecycle` (`POST /requests/lifecycle`) moves a commercial Request through `enquire → tentative → definite` or terminal `lost`/`closed`:

- `tentative` — records the lifecycle and creates or updates one open Follow-Up for staff (`dueAt` defaults to +24h). The follow-up inherits the request's real direction (e.g. `spa`), channel, and owner.
- `definite` — pauses the AI: conversation becomes `needs_human` with `handoffReasonCode:"payment_ready"`, `handoffPriority:"high"`, and `requestedAction:"Отправить счёт или ссылку на оплату"`. Open follow-ups are completed. This is the payment-ready human handoff — staff send the invoice/link; the AI never collects payments.
- `lost`/`closed` — require `reason`, mark the request closed, and complete open follow-ups.

Availability, prices, reservations, and payments are always server-authoritative: the agent may only *propose* commercial actions; the CRM executes them.

## Conversation memory and guest facts

Two controlled write paths let the agent persist distilled knowledge without touching raw CRM records:

- `update_conversation_memory` — stores a compact memory object (`narrative`, `knownFacts`, `unresolvedFacts`, `lastCommitment`, `nextBestAction`) under `conversation.summary.memory` with `schemaVersion:1`, `sourceMessageId`, and `updatedAt`. Requires `sourceMessageId` pointing at a real inbound contact message. Idempotent per `idempotencyKey`; the latest write wins.
- `update_guest_profile` — persists allowlisted guest facts (`firstName`, `lastName`, `phone`, `email`, `language`, `company`, `preferences.{roomPreference,bedPreference,foodPreference,specialRequests}`). Conflicting phone/email values or values belonging to another guest return `GUEST_PROFILE_CONFLICT` instead of silently merging — a human reconciles. Identity fields (`externalChatId`, `externalUserId`) are never modified here.

## Attachments and voice

Inbound accepts `attachments[]` (`kind`: `image|document|audio|video|other`, `mimeType`, `fileName`, `fileSize`, `externalFileId`, `storageProvider`, `storageKey`, `durationMs`, `metadata`). Rows persist in `message_attachments` and surface in `recentMessages` and `GET /conversations/:id/messages` with `processingStatus`. A future STT worker reports results via `POST /messages/:messageId/attachments/:attachmentId/process-result`; a `ready` audio transcript appears as message text in context. No media binary flows through this API — adapters pass metadata/keys only.

## Orchestration contract (n8n and Agent Hub)

1. **Trigger Handling**:
   - Receive the channel webhook/polling event.
   - Construct `idempotencyKey` deterministically: `${update_id}` or `${chat_id}:${message_id}`.
   - Call `POST /api/integrations/agent/messages/inbound`.

2. **Gating Check**:
   - Inspect response: if `aiReplyAllowed === false`, **stop execution immediately**. Do NOT call the LLM or invoke tools. The conversation is currently owned by human staff (`human`) or awaiting staff attention (`needs_human`). After a handoff the agent may send exactly one short acknowledgement via `outbound/prepare`; subsequent replies are rejected.
   - If `aiReplyAllowed === true`, provide the model with `context` and `allowedActions`.

3. **Tool Execution Guard**:
   - The LLM must ONLY invoke tools present in `context.allowedActions`.
   - All mutation endpoints require unique, reproducible `idempotencyKey` strings.

4. **Action Confirmation Protocol**:
   - For actions requiring explicit confirmation (`book_accommodation`, `book_service`, `reschedule_service`, `cancel_service`, `extend_stay`):
     - Step A: When the model wants to suggest an action, call `POST /messages/outbound/prepare` with `proposedAction: { actionType, payload }`.
     - Step B: Send the prepared message text through the channel (or read it via the simulator poll).
     - Step C: Call `POST /messages/outbound/result` with `success: true` and `externalMessageId`.
     - Step D: When the guest replies in the next turn confirming explicitly ("Да, бронируйте"), verify confirmation with `isExplicitConfirmation()`.
     - Step E: Call the confirmed endpoint (e.g. `POST /services/book`) providing `proposalMessageId` from Step A and `confirmationMessageId` from the guest's reply.

5. **Outbound Dispatch (CRM to Guest)**:
   - When human operators reply in Guestra CRM, Guestra calls the channel webhook (`AGENT_OUTBOUND_WEBHOOK_URL` / `WHATSAPP_OUTBOUND_WEBHOOK_URL`) with the matching `x-agent-webhook-token` header.
   - The adapter sends the message via the channel API and reports status back to `POST /messages/outbound/result`. Simulator conversations are marked `sent` locally — no webhook involved.

6. **Error & Handoff Routing**:
   - If response returns `handoffRecommended: true` or status 409 with unresolvable conflict, invoke `POST /handoff` with appropriate `reasonCode`.
   - If response returns `retryable: true`, the orchestrator may retry after an exponential backoff.

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

The same call with `channel:"simulator"` works identically for the Agent Hub. Voice notes arrive as `attachments: [{ "kind": "audio", "mimeType": "audio/ogg", "externalFileId": "…", "durationMs": 4200 }]` without `text`.

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
    "handoff_to_human",
    "update_guest_profile",
    "update_conversation_memory"
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
      "requestedAction": null,
      "memory": null
    },
    "customer": { "id": "guest_111", "name": "Алиса", "repeatGuest": false, "stayCount": 0 },
    "lifecycle": "new_contact",
    "request": null,
    "offer": null,
    "reservation": null,
    "serviceReservations": [],
    "recentMessages": [
      { "id": "message_abc123", "senderType": "contact", "direction": "in", "text": "Здравствуйте! Хотим забронировать домик на 2 дня в октябре", "at": "2026-10-01T10:00:00.000Z", "attachments": [] }
    ],
    "activeProposal": null,
    "allowedActions": ["get_property_knowledge", "get_accommodation_options", "check_accommodation_availability", "get_service_options", "check_service_availability", "classify_conversation", "create_or_update_request", "handoff_to_human", "update_guest_profile", "update_conversation_memory"],
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
  "channel": "telegram",
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

### 4. Request Lifecycle (`POST /requests/lifecycle`)

**Request**:
```json
{
  "channel": "telegram",
  "propertyId": "les_borovoe",
  "externalUserId": "123456789",
  "conversationId": "conversation_xyz789",
  "requestId": "lead_456",
  "status": "definite",
  "idempotencyKey": "req-lifecycle-001"
}
```

**Response (200 OK)**:
```json
{ "requestId": "lead_456", "requestLifecycle": "definite", "duplicate": false }
```

### 5. Create Offer (`POST /offers/create`)

**Request**:
```json
{
  "channel": "telegram",
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

### 6. Outbound Prepare with Proposal (`POST /messages/outbound/prepare`)

**Request**:
```json
{
  "channel": "telegram",
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

### 7. Outbound Delivery Result (`POST /messages/outbound/result`)

**Request**:
```json
{
  "channel": "telegram",
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

### 8. Confirmed Accommodation Booking (`POST /accommodations/book`)

**Request**:
```json
{
  "channel": "telegram",
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

### 9. Transcript Read (`GET /conversations/:id/messages`)

**Request**: `GET /api/integrations/agent/conversations/conversation_xyz789/messages?channel=simulator&propertyId=les_borovoe&externalUserId=sim_user_1&after=message_abc123&limit=50`

**Response (200 OK)**:
```json
{
  "conversationId": "conversation_xyz789",
  "nextCursor": null,
  "messages": [
    {
      "id": "message_prop_001", "direction": "out", "senderType": "ai",
      "text": "Забронировать A-Frame на 15–17 октября за 130 000 KZT?",
      "at": "2026-10-01T10:00:05.000Z", "deliveryStatus": "sent",
      "externalMessageId": "simulator:message_prop_001", "attachments": []
    }
  ]
}
```

### 10. Guest Profile Update (`POST /guests/profile`)

**Request**:
```json
{
  "channel": "simulator",
  "propertyId": "les_borovoe",
  "externalUserId": "sim_user_1",
  "conversationId": "conversation_xyz789",
  "sourceMessageId": "message_abc123",
  "idempotencyKey": "profile-001",
  "firstName": "Айгерим",
  "phone": "+77011234567",
  "preferences": { "bedPreference": "king", "specialRequests": ["тихое место"] }
}
```

**Response (200 OK)**:
```json
{ "guestId": "guest_111", "updated": ["phone", "firstName", "preferences"], "duplicate": false }
```

### 11. Conversation Memory (`POST /conversations/memory`)

**Request**:
```json
{
  "channel": "simulator",
  "propertyId": "les_borovoe",
  "externalUserId": "sim_user_1",
  "conversationId": "conversation_xyz789",
  "sourceMessageId": "message_abc123",
  "idempotencyKey": "mem-001",
  "memory": {
    "narrative": "Семья с двумя детьми выбирает тихий домик",
    "knownFacts": ["2 взрослых", "2 детей"],
    "unresolvedFacts": ["даты"],
    "nextBestAction": "Уточнить даты"
  }
}
```

**Response (200 OK)**:
```json
{ "conversationId": "conversation_xyz789", "memory": { "schemaVersion": 1, "narrative": "…" }, "duplicate": false }
```

### 12. Identity Verification (`POST /identity/verify`)

**Request**:
```json
{
  "channel": "telegram",
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

### 13. Handoff to Human Staff (`POST /handoff`)

**Request**:
```json
{
  "channel": "telegram",
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

A channel identity sees private reservation/stay/folio context only through its linked identity — scoped by `(channel, externalUserId)` and verified against the property's organization. A new account must pass booking-reference plus phone verification before linking; name alone is not proof. Verification throttles repeated failures and can request staff review. While conversation mode is `human` or `needs_human`, context sets `aiReplyAllowed:false` and returns no AI actions. Escalation reason codes include discount, refund/payment issue, complaint, uncertainty, unsupported action, complex event, and guest-requested human. Discounts, refunds, payment corrections, room moves, and lifecycle overrides remain staff-only.

## Tool trace

Every request under `/api/integrations/agent` writes one `agent_tool_events` row (tool name, channel, property, conversation, guest, idempotency `requestId`, status code, error code, duration) — sanitized metadata only, never payloads or secrets. Tracing never affects the tool response.

## Errors

Errors use `{ "error": "...", "code": "...", "retryable": false, "handoffRecommended": false }`. Stable codes are exported as `AGENT_ERROR_CODES` in the shared contract: `UNAUTHORIZED`, `VALIDATION_ERROR`, `INTERNAL_ERROR`, `IDENTITY_NOT_FOUND`, `IDENTITY_VERIFICATION_REQUIRED`, `CONVERSATION_NOT_FOUND`, `CONVERSATION_HUMAN_OWNED`, `ACTION_NOT_ALLOWED`, `CONFIRMATION_REQUIRED`, `CONFIRMATION_STALE`, `CONFIRMATION_PAYLOAD_MISMATCH`, `IDEMPOTENCY_CONFLICT`, `NO_AVAILABILITY`, `PRICE_NOT_AUTHORITATIVE`, `SERVICE_NOT_LIVE_BOOKABLE`, `RESOURCE_CONFLICT`, `REQUEST_NOT_FOUND`, `REQUEST_CLOSED`, `OFFER_EXPIRED`, `HANDOFF_REQUIRED`, `DELIVERY_FAILED`, `MESSAGE_NOT_FOUND`, `CLASSIFICATION_MANUAL_OVERRIDE`, `GUEST_PROFILE_CONFLICT`, and `ATTACHMENT_NOT_FOUND`. Retry only when the response marks an error retryable or when retrying the same idempotent delivery/action.

## Deployment

Migrations `0010_agent_contract_hardening.sql`, `0013_commercial_payment_and_communications.sql`, and `0014_channel_neutral_agent_hub.sql` are additive and safe for existing PostgreSQL records. Configure `CRM_INTEGRATION_API_KEY`, `AGENT_OUTBOUND_WEBHOOK_TOKEN`, `AGENT_OUTBOUND_WEBHOOK_URL`, and optionally `WHATSAPP_OUTBOUND_WEBHOOK_URL` / `WHATSAPP_OUTBOUND_WEBHOOK_TOKEN` in the server environment. Do not put channel credentials in the CRM frontend or commit credentials. The companion n8n import and setup guide live in `integrations/n8n/`.
