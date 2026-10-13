import { z } from "zod";
export const IntegrationEventSchema=z.object({
  schemaVersion:z.literal("guestra-domain-event-v1"),eventId:z.string().uuid(),sourceSystem:z.literal("guestra_pms"),
  propertyId:z.string().uuid(),tenantId:z.string().min(1),entityType:z.enum(["reservation","service_booking","service_request","folio","payment"]),
  entityId:z.string().uuid(),guestId:z.string().uuid().optional(),revision:z.number().int().nonnegative().safe(),
  eventType:z.string().min(1),occurredAt:z.string().datetime({offset:true}),correlationId:z.string().max(200).optional(),
  integrationContext:z.object({sourceSystem:z.literal("guestra_crm"),customerId:z.string().min(1),
    requestId:z.string().optional(),offerId:z.string().optional(),conversationId:z.string().optional(),operationId:z.string().optional()}).optional(),
}).strict();
export type IntegrationEvent=z.infer<typeof IntegrationEventSchema>;
export class IntegrationError extends Error {
  constructor(readonly code:string,readonly status=409,readonly retryable=false) {super(code);}
}
