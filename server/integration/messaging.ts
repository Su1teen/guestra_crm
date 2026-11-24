import {randomUUID} from "node:crypto";
import type {Router} from "express";
import {and,eq,inArray,notInArray} from "drizzle-orm";
import {z} from "zod";
import type {Database} from "../db/client.js";
import * as s from "../db/schema.js";
import * as i from "./schema.js";
import {PmsClient} from "./pms-client.js";
import {IntegrationError} from "./contract.js";
import {requireScope,requireTool} from "./security.js";
import {hashAgentPayload} from "../services/agent-action-service.js";
import {AgentConfirmationActionSchema} from "../contracts/agent-contract.js";
import type {identity} from "./router.js";

/** Preparing never delivers. Existing outbound/result acknowledges actual transport delivery. */
export function registerV2Messaging(router:Router,db:Database,pms:PmsClient,resolve:typeof identity) {
  const schema=z.object({propertyId:z.string().min(1),channel:z.enum(["simulator","telegram","whatsapp","instagram"]),
    externalUserId:z.string().min(1),conversationId:z.string().min(1),text:z.string().trim().min(1).max(10000),
    idempotencyKey:z.string().min(1).max(120),mediaReferenceIds:z.array(z.string().min(1)).max(10).default([]),
    proposedAction:z.object({actionType:AgentConfirmationActionSchema,payload:z.record(z.unknown())}).optional()});
  router.post("/v2/messages/outbound/prepare",requireScope("agent.write"),async(request,response)=>{
    const input=schema.parse(request.body),scope=await resolve(db,input);
    if(input.proposedAction)requireTool(response,input.proposedAction.actionType);
    const key="agent-ai:"+scope.customer.id+":"+input.propertyId+":"+input.idempotencyKey;
    const hash=hashAgentPayload(input);
    // Resolve immutable retries before asking an unavailable platform for another quote.
    const [existing]=await db.select().from(s.messages).where(and(eq(s.messages.idempotencyKey,key),eq(s.messages.conversationId,input.conversationId))).limit(1);
    if(existing) {
      if(existing.metadata.requestPayloadHash!==hash)throw new IntegrationError("IDEMPOTENCY_CONFLICT");
      return response.json({messageId:existing.id,conversationId:existing.conversationId,text:existing.text,
        deliveryStatus:existing.deliveryStatus,duplicate:true,proposedAction:existing.metadata.proposedAction??null});
    }
    let expiresAt=new Date(Date.now()+300000).toISOString();
    if(input.proposedAction) {
      const action=input.proposedAction,payload=action.payload;
      if(action.actionType==="book_accommodation") {
        const offerId=z.string().min(1).parse(payload.offerId);
        const [offer]=await db.select().from(s.offers).where(and(eq(s.offers.id,offerId),eq(s.offers.propertyId,input.propertyId),eq(s.offers.guestId,scope.customer.id))).limit(1);
        const [mapping]=await db.select().from(i.integrationMappings).where(and(eq(i.integrationMappings.propertyId,input.propertyId),
          eq(i.integrationMappings.localType,"offer"),eq(i.integrationMappings.localId,offerId),eq(i.integrationMappings.remoteType,"quote"))).limit(1);
        if(!offer||!mapping||scope.conversation?.leadId!==offer.leadId||Date.parse(offer.expiresAt)<=Date.now())throw new IntegrationError("PMS_ACCEPTED_QUOTE_REQUIRED");
        if(Object.keys(payload).length!==1)throw new IntegrationError("CONFIRMATION_PAYLOAD_MISMATCH");
        expiresAt=new Date(Math.min(Date.parse(offer.expiresAt),Date.parse(expiresAt))).toISOString();
      } else if(action.actionType==="book_service") {
        const fields=z.object({serviceId:z.string().uuid(),startAt:z.string().datetime(),endAt:z.string().datetime(),
          quantity:z.number().int().positive().default(1),participants:z.number().int().positive(),expectedTotal:z.string(),
          reservationId:z.string().uuid().optional()}).strict().parse(payload);
        const availability=await pms.call(input.propertyId,"v2/services/availability","POST",
          {...fields,expectedTotal:undefined,reservationId:undefined,propertyId:pms.mapping(input.propertyId).pmsPropertyId});
        if(!availability.available||String((availability.pricing as Record<string,unknown>)?.totalAmount)!==fields.expectedTotal)
          throw new IntegrationError("PRICE_CHANGED");
      } else {
        if(action.actionType==="extend_stay")throw new IntegrationError("USE_AMEND_ACCOMMODATION");
        const id=z.string().uuid().parse(payload.entityId);
        const type=["cancel_service","reschedule_service"].includes(action.actionType)?"service_booking":"reservation";
        const current=await pms.call(input.propertyId,"v2/entities/"+type+"/"+id,"GET",undefined,{customerId:scope.customer.id});
        if(type==="service_booking" && payload.expectedRevision!==current.entityRevision)throw new IntegrationError("REVISION_CONFLICT");
        if(type==="reservation" && payload.expectedUpdatedAt!==current.updatedAt)throw new IntegrationError("REVISION_CONFLICT");
      }
    }
    const prepared=await db.transaction(async tx=>{
      const current=await resolve(tx,input);
      // Conversation mutex also coordinates takeover and action confirmation.
      const [conversation]=await tx.select().from(s.conversations).where(and(eq(s.conversations.id,input.conversationId),
        eq(s.conversations.propertyId,input.propertyId))).for("update");
      const [prior]=await tx.select().from(s.messages).where(eq(s.messages.idempotencyKey,key)).limit(1);
      if(prior) {
        if(prior.conversationId!==input.conversationId||prior.metadata.requestPayloadHash!==hash)throw new IntegrationError("IDEMPOTENCY_CONFLICT");
        return {message:prior,duplicate:true};
      }
      if(current.customer.id!==scope.customer.id||conversation.automationMode!=="ai")throw new IntegrationError("CONVERSATION_HUMAN_OWNED");
      const media=input.mediaReferenceIds.length?await tx.select({attachment:s.messageAttachments}).from(s.messageAttachments)
        .innerJoin(s.messages,eq(s.messages.id,s.messageAttachments.messageId))
        .where(and(inArray(s.messageAttachments.id,input.mediaReferenceIds),eq(s.messages.conversationId,input.conversationId),
          inArray(s.messages.direction,["in","out"]),notInArray(s.messages.senderType,["note","internal"]))):[];
      if(media.length!==new Set(input.mediaReferenceIds).size||media.some(row=>row.attachment.processingStatus!=="ready"||row.attachment.metadata.scanStatus!=="clean"))
        throw new IntegrationError("MEDIA_NOT_READY_OR_NOT_OWNED");
      const timestamp=new Date().toISOString(),proposedAction=input.proposedAction?{...input.proposedAction,
        payloadHash:hashAgentPayload(input.proposedAction.payload),expiresAt}:null;
      const [message]=await tx.insert(s.messages).values({id:"message_"+randomUUID(),conversationId:conversation.id,direction:"out",
        senderType:"ai",text:input.text,sentAt:timestamp,deliveryStatus:"pending",idempotencyKey:key,
        metadata:{source:"agent_integration_v2",requestPayloadHash:hash,...(proposedAction?{proposedAction}: {})}}).returning();
      for(const {attachment} of media)await tx.insert(s.messageAttachments).values({...attachment,id:"attachment_"+randomUUID(),
        messageId:message.id,createdAt:timestamp,updatedAt:timestamp});
      await tx.update(s.conversations).set({lastMessageAt:timestamp,updatedAt:timestamp}).where(eq(s.conversations.id,conversation.id));
      return {message,duplicate:false};
    });
    response.status(prepared.duplicate?200:201).json({messageId:prepared.message.id,conversationId:input.conversationId,text:prepared.message.text,
      deliveryStatus:prepared.message.deliveryStatus,duplicate:prepared.duplicate,proposedAction:prepared.message.metadata.proposedAction??null});
  });
}
