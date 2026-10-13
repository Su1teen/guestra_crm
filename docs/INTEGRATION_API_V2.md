# CRM integration API v2

Base: `/api/integrations/agent`. All v2 endpoints require enabled mode, DB attestation and a scoped hashed principal. Identity-scoped input is propertyId/channel/externalUserId/conversationId. See [shared contract](CROSS_DATABASE_CONTRACT.md).

| Method/path | Scope / purpose |
|---|---|
| POST /messages/inbound | agent.write; persist guest input, preserve external refs and return CRM IDs |
| POST /context | agent.read + tool:get_context; legacy-compatible safe context |
| POST /requests/upsert, /requests/lifecycle | agent.write + corresponding tool scope; CRM commercial Request |
| POST /handoff | agent.write + tool:handoff_to_human; sticky human ownership |
| POST /messages/outbound/result | agent.write; acknowledge actual transport delivery/failure |
| GET /conversations/:id/messages | agent.read; guest-only v1 transcript |
| POST /v2/messages/outbound/prepare | agent.write + proposed tool; persist pending message/proposal |
| GET /v2/capabilities | integration.read; verified environment/property/tenant attestation |
| GET /v2/context | integration.read; guest-safe context with verified PMS projections |
| POST /v2/accommodations/search | integration.read; authoritative PMS availability/rates |
| POST /v2/offers | integration.write + tool:create_offer; persist CRM Offer with signed PMS quote |
| POST /v2/accommodations/book | integration.write + tool:book_accommodation; claim delivered proposal + guest confirmation |
| GET /v2/services, POST /v2/services/availability | integration.read; authoritative service options and price |
| POST /v2/actions | integration.write + exact tool; book_service/reschedule_service/cancel_service/amend_accommodation/cancel_accommodation |
| POST /v2/reservations/:id/quote | integration.read; owned amendment quote + expectedUpdatedAt |
| POST /v2/guest-requests | integration.write + tool:create_guest_request; actual guest source message required |
| GET /v2/operations/:id | integration.read; owned operation status/read-back/errors/attempts |
| POST /v2/reconcile | integration.reconcile; retry due durable receipts and return real counts |
| GET /v2/events, POST /v2/events/ack | events.read; CRM committed feed and monotonic scoped acknowledgement |
| POST /v2/events | events.consume + signed raw body; envelope wrapper propertyId/event |
| GET /v2/conversations/:id/changes | agent.read; after/limit, guest-message-changes-v1 |
| GET /v2/inspector | inspector.read; sanitized trace, bounded latest records |
| GET /v2/inbox, /v2/inbox/:id | inbox.read; staff-facing guest-only list/window |
| POST /v2/inbox/:id/takeover | inbox.handoff; authorized PMS server's real staff reference |
| POST /v2/media/:id/reference | media.write + workspaceIds; trusted scan/reference registration |
| GET /v2/media/:id/url | media.read + workspaceIds; short-lived retrieval capability |
| POST /v2/sandbox/fixtures | sandbox.setup; isolated stage/key setup and authoritative read-back |
| POST /v2/sandbox/fixtures/:key/retire | sandbox.setup; release only that fixture |
| POST /v2/sandbox/fixtures/:key/simulate-payment | sandbox.setup; labelled simulation, no ledger effect |

PMS webhook: POST `/api/integrations/pms/v1/events/:crmPropertyId`, signed existing PMS webhook body whose data.integrationEnvelope contains the versioned event. Media retrieval: GET `/api/integrations/media/v1/retrieve?token=...`, signed short-lived capability.

Canonical request validators live in server/contracts/agent-contract.ts and server/integration/{router,messaging,media,sandbox,contract}.ts. V2 action payload must exactly match the saved proposal; revisions are expectedRevision for services and expectedUpdatedAt for accommodation. Responses return pending/completed/rejected separately from HTTP success.

No enabled integration command creates CRM accommodation/stay/folio/payment duplicates. Commercial projection states distinguish pending payment, confirmed reservation, in-house, due-out, post-stay and cancellation. Server/API environment variables are in .env.integration.example.
