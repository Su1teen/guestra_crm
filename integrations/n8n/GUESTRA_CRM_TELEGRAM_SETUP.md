# Guestra CRM Telegram Agent — Setup

## What this workflow does

The workflow has two trigger branches:

1. `TG • Incoming Message` receives a Telegram message, persists it in Guestra, stops duplicated or human-owned conversations, supplies fresh CRM context to an AI Tools Agent, prepares the outbound CRM message, sends it through Telegram, and records delivery.
2. `Webhook • CRM Human Outbound` receives a human reply from Guestra Inbox, sends it through the same Telegram bot, and returns the exact delivery result expected by Guestra.

Guestra is the only business-state store. There is no Postgres node, CRM database credential, data store, or chat memory in this workflow.

## Target n8n version

No local n8n installation or deployment configuration was found. The export targets the current official node generations available from n8n source at the time of creation:

| Node | Exported type/version |
|---|---|
| Telegram Trigger | `n8n-nodes-base.telegramTrigger` 1.5 |
| Telegram Send Message | `n8n-nodes-base.telegram` 1.2 |
| AI Agent, Tools Agent V3 | `@n8n/n8n-nodes-langchain.agent` 3.1 |
| OpenAI Chat Model | `@n8n/n8n-nodes-langchain.lmChatOpenAi` 1.3 |
| Structured Output Parser | `@n8n/n8n-nodes-langchain.outputParserStructured` 1.3 |
| HTTP Request and HTTP Request Tool | `n8n-nodes-base.httpRequest[Tool]` 4.5 |
| Webhook / Respond to Webhook | 2.1 / 1.4 |

Use a current n8n 2.x instance with these node versions or newer. The workflow intentionally uses Tools Agent V3, not the deprecated Agent V1. If an older instance cannot import one of these node versions, update n8n before editing the workflow.

## Credentials to create first

| Credential name | Used by | What to enter | Where to obtain it |
|---|---|---|---|
| `Guestra Telegram Bot` | Telegram Trigger, `TG • Send AI Reply`, `TG • Send Human Reply` | Telegram bot token | Open BotFather in Telegram, create or open the bot, then use its API token. |
| `Guestra OpenAI API` | `Model • OpenAI Chat` | OpenAI API key | Create an API key in the OpenAI API platform. A ChatGPT subscription is separate from API billing. |
| `Guestra CRM Agent API` | Every `CRM •` and `Tool •` HTTP node | **Header Auth**: name `x-crm-api-key`; value equal to Railway `CRM_INTEGRATION_API_KEY` | Railway variables for the Guestra CRM service. |
| `Guestra CRM Outbound Webhook` | `Webhook • CRM Human Outbound` | **Header Auth**: name `x-agent-webhook-token`; value equal to Railway `AGENT_OUTBOUND_WEBHOOK_TOKEN` | Create the same secret in Railway and n8n. |

No PostgreSQL credential is needed in n8n.

## Import and configure

1. In n8n, open **Workflows**, then choose **Import from File** and select `guestra-crm-telegram-agent.workflow.json`.
2. Open `CONFIG • Guestra`. Change only `CRM_BASE_URL` from `https://YOUR-GUESTRA-CRM-DOMAIN` to the public HTTPS URL of Guestra CRM. Leave `PROPERTY_ID` as `les_borovoe` for the current local pilot inventory.
3. Open `TG • Incoming Message`, choose `Guestra Telegram Bot` in the Telegram credential field, and keep **Trigger On → Message** selected.
4. Open `TG • Send AI Reply` and `TG • Send Human Reply`; choose the same `Guestra Telegram Bot` credential in both.
5. Open `Model • OpenAI Chat`; choose `Guestra OpenAI API`. The initial model is `gpt-5.4`; change this in this single node if your account uses a different tool-capable model.
6. For every `CRM •` and `Tool •` HTTP node, choose `Guestra CRM Agent API`. n8n can match the credential name after it has been created; verify the credential selector on each imported HTTP node before activation.
7. Open `Webhook • CRM Human Outbound`; set **Authentication** to **Header Auth** and choose `Guestra CRM Outbound Webhook`.
8. In the same Webhook node, copy the **Production URL**. It must end with `/webhook/guestra-telegram-outbound`.
9. In Railway, set Guestra CRM variables:

   ```text
   AGENT_OUTBOUND_WEBHOOK_URL=<the production URL copied in step 8>
   AGENT_OUTBOUND_WEBHOOK_TOKEN=<same value stored in Guestra CRM Outbound Webhook>
   CRM_INTEGRATION_API_KEY=<same value stored in Guestra CRM Agent API>
   ```

10. Save, then activate the workflow. Activation makes n8n register the Telegram Trigger webhook and the production CRM webhook.

## Webhook and self-hosting requirements

Telegram Trigger supports a single Telegram trigger per bot. Use this workflow as that trigger for the selected bot. n8n registers the Telegram webhook when the workflow is active.

Both Telegram and Guestra CRM must reach n8n through a public HTTPS URL. If self-hosting n8n behind Railway or a reverse proxy, set the instance's public webhook URL according to the n8n deployment configuration before activation, then confirm that the Webhook node displays the intended production URL. Do not put `AGENT_OUTBOUND_WEBHOOK_TOKEN` into a URL or query string.

The workflow returns `{ "ok": true, "externalMessageId": "..." }` to Guestra after a human Telegram send. Invalid events and Telegram transport errors return a non-2xx failure so the CRM records delivery as failed. CRM already supplies `crm-message:<messageId>` as its human-outbound idempotency key. This workflow does not add an unsafe in-memory dedupe cache; if an external transport needs exact-once delivery across webhook retries, add a durable transport-level mechanism later rather than n8n memory.

## How confirmation works

For protected actions, the first AI response creates an exact CRM proposal before Telegram delivery. When the next guest message arrives, Guestra Context returns `activeProposal` only if it was sent, is unexpired, and has not been consumed. The workflow uses that backend-held payload plus the current inbound CRM message ID. It does not store booking proposals in n8n memory or a Data Store.

If the guest confirms after expiry or stock changes, CRM rejects the transaction and the agent must check and propose again.

## Test plan

Run these after activation. Inspect the n8n **Executions** page and the Guestra Inbox/Conversation at each step.

1. **FAQ:** send `Во сколько заезд?`. Expect CRM ingest, Property Knowledge, an AI reply, and an outbound CRM message with `deliveryStatus: sent`.
2. **Accommodation:** send `Нас двое, хотим на выходные`. Provide dates when asked. Expect a CRM request, category explanation, availability, offer, confirmation proposal, then booking after `Да, бронируйте`. The guest never selects a physical room.
3. **Service-only:** send `Сегодня SPA на двоих`. Expect catalog/slot check, a proposal, then one Service Reservation only after confirmation.
4. **In-house FAQ:** from an in-house linked guest, ask `Когда у нас выезд?`. Expect Stay Context and no new sales request.
5. **Guest request:** send `Принесите полотенца`. Expect an in-house housekeeping Guest Request.
6. **Technical request:** send `Не работает отопление`. Expect a maintenance Guest Request; the reply must say the request was passed on, not promise a technician is already present.
7. **Human handoff:** send `Позовите менеджера`. Expect conversation mode `needs_human` and no autonomous follow-up action.
8. **Human outbound:** in Guestra Inbox, take the conversation and send a reply. Expect the protected n8n webhook branch to send Telegram and Guestra to record success.
9. **Resume AI:** return the conversation to AI in Inbox, then send another guest message. Expect the inbound branch to proceed.
10. **Duplicate Telegram update:** replay a Telegram update. CRM responds `duplicate: true`; the guard stops before the model and no second reply appears.
11. **Telegram failure:** temporarily make the bot credential invalid. Expect `CRM • Delivery Failure` and a CRM failed delivery state, then restore the credential.
12. **Stale confirmation:** wait beyond the proposal lifetime or expire a test proposal, then confirm. Expect no transaction and a new check/proposal.

## Failure handling

- `UNAUTHORIZED`: correct the `Guestra CRM Agent API` credential; do not send a guest-facing workaround.
- `CONVERSATION_HUMAN_OWNED`: inbound guard stops the AI; staff owns the conversation.
- `ACTION_NOT_ALLOWED`, `CONFIRMATION_REQUIRED`, `CONFIRMATION_STALE`, or `CONFIRMATION_PAYLOAD_MISMATCH`: do not retry the transaction blindly; request/rebuild the current proposal.
- `NO_AVAILABILITY` or `RESOURCE_CONFLICT`: check alternatives.
- `PRICE_NOT_AUTHORITATIVE`: do not state a final price; hand off when necessary.
- `SERVICE_NOT_LIVE_BOOKABLE`: collect/request information without saying that the service is booked.
- `DELIVERY_FAILED`: inspect execution details, fix Telegram transport, and use CRM retry semantics.

## Files

- `guestra-crm-telegram-agent.workflow.json`: n8n workflow export. It contains no tokens or database credentials.
- `GUESTRA_AGENT_SYSTEM_PROMPT.md`: readable source of the system prompt. The same operating rules are embedded in the AI Agent node, so importing the JSON does not require copy/paste.
