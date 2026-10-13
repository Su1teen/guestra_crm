import {randomUUID} from "node:crypto";
import {and,eq,sql} from "drizzle-orm";
import type {Database} from "../db/client.js";
import * as s from "../db/schema.js";
import * as i from "./schema.js";
import {hashAgentPayload} from "../services/agent-action-service.js";
import {IntegrationError,IntegrationEventSchema,type IntegrationEvent} from "./contract.js";
import {PmsClient} from "./pms-client.js";
type Tx=Pick<Database,"select"|"insert"|"update"|"execute">;
export async function verifiedMapping(tx:Tx,input:typeof i.integrationMappings.$inferInsert) {
  const where=and(eq(i.integrationMappings.propertyId,input.propertyId),eq(i.integrationMappings.sourceSystem,input.sourceSystem),
    eq(i.integrationMappings.localType,input.localType),eq(i.integrationMappings.localId,input.localId),eq(i.integrationMappings.remoteType,input.remoteType));
  await tx.insert(i.integrationMappings).values(input).onConflictDoNothing();
  const [mapping]=await tx.select().from(i.integrationMappings).where(where).limit(1);
  if(!mapping || mapping.tenantId!==input.tenantId || mapping.remotePropertyId!==input.remotePropertyId || mapping.remoteId!==input.remoteId)
    throw new IntegrationError("IDENTITY_CONFLICT");
  return mapping;
}
export async function enqueueOperation(tx:Tx,input:Omit<typeof i.integrationOperations.$inferInsert,"id"|"fingerprint">) {
  const fingerprint=hashAgentPayload({kind:input.kind,customerId:input.customerId,conversationId:input.conversationId,payload:input.payload});
  const row={...input,id:"operation_"+randomUUID(),fingerprint};
  await tx.insert(i.integrationOperations).values(row).onConflictDoNothing();
  const [operation]=await tx.select().from(i.integrationOperations).where(and(eq(i.integrationOperations.propertyId,input.propertyId),eq(i.integrationOperations.key,input.key))).limit(1);
  if(!operation || operation.fingerprint!==fingerprint) throw new IntegrationError("IDEMPOTENCY_CONFLICT");
  // The command is the transactional outbox for the remote mutation.
  return operation;
}
export async function projectSnapshot(tx:Tx,pms:PmsClient,propertyId:string,customerId:string,snapshot:Record<string,unknown>,eventId:string) {
  const mapping=pms.mapping(propertyId);
  if(snapshot.propertyId!==mapping.pmsPropertyId || typeof snapshot.id!=="string" || typeof snapshot.entityType!=="string" ||
      typeof snapshot.guestId!=="string") throw new IntegrationError("INVALID_AUTHORITATIVE_READBACK");
  const [property]=await tx.select().from(s.properties).where(eq(s.properties.id,propertyId)).for("no key update").limit(1);
  const [customer]=await tx.select().from(s.guests).where(eq(s.guests.id,customerId)).limit(1);
  if(!property || property.organizationId!==mapping.crmTenantId || customer?.organizationId!==property.organizationId)
    throw new IntegrationError("TENANT_MAPPING_MISMATCH",403);
  const timestamp=new Date().toISOString();
  await verifiedMapping(tx,{id:"mapping_"+randomUUID(),propertyId,tenantId:property.organizationId,sourceSystem:"guestra_pms",
    localType:"customer",localId:customerId,remotePropertyId:mapping.pmsPropertyId,remoteType:"guest",remoteId:snapshot.guestId,
    verifiedAt:timestamp,evidence:{source:"authoritative_readback",eventId}});
  await verifiedMapping(tx,{id:"mapping_"+randomUUID(),propertyId,tenantId:property.organizationId,sourceSystem:"guestra_pms",
    localType:"projection",localId:customerId+":"+String(snapshot.entityType)+":"+String(snapshot.id),
    remotePropertyId:mapping.pmsPropertyId,remoteType:String(snapshot.entityType),remoteId:String(snapshot.id),
    verifiedAt:timestamp,evidence:{source:"authoritative_readback",eventId,customerId,
      ...((snapshot.integrationContext as Record<string,unknown>|undefined)?.conversationId?{conversationId:(snapshot.integrationContext as Record<string,unknown>).conversationId}:{})}});
  const revision=Number(snapshot.revision);
  if(!Number.isSafeInteger(revision)||revision<0)throw new IntegrationError("INVALID_SOURCE_REVISION");
  const value={propertyId,remotePropertyId:mapping.pmsPropertyId,entityType:snapshot.entityType,entityId:snapshot.id,customerId,
    revision,snapshot,verifiedAt:timestamp};
  const [current]=await tx.select().from(i.integrationProjections).where(and(eq(i.integrationProjections.propertyId,propertyId),
    eq(i.integrationProjections.remotePropertyId,mapping.pmsPropertyId),eq(i.integrationProjections.entityType,snapshot.entityType),eq(i.integrationProjections.entityId,snapshot.id))).limit(1);
  if(current && current.customerId!==customerId)throw new IntegrationError("IDENTITY_CONFLICT");
  if(current && current.revision>=revision)return {applied:false};
  await tx.insert(i.integrationProjections).values(value).onConflictDoUpdate({
    target:[i.integrationProjections.propertyId,i.integrationProjections.remotePropertyId,i.integrationProjections.entityType,i.integrationProjections.entityId],
    set:{revision,snapshot,verifiedAt:timestamp},setWhere:sql`${i.integrationProjections.revision}<${revision} and ${i.integrationProjections.customerId}=${customerId}`,
  });
  if(snapshot.entityType==="reservation") {
    const context=snapshot.integrationContext as Record<string,unknown>|undefined;
    if(context?.sourceSystem==="guestra_crm"&&context.customerId!==customerId)throw new IntegrationError("ORIGIN_MISMATCH");
    if(context?.sourceSystem==="guestra_crm"&&typeof context.requestId==="string") {
      const [lead]=await tx.select().from(s.leads).where(and(eq(s.leads.id,context.requestId),eq(s.leads.propertyId,propertyId),eq(s.leads.guestId,customerId))).limit(1);
      if(!lead)throw new IntegrationError("REQUEST_NOT_FOUND");
      await verifiedMapping(tx,{id:"mapping_"+randomUUID(),propertyId,tenantId:property.organizationId,sourceSystem:"guestra_pms",
        localType:"request",localId:lead.id,remotePropertyId:mapping.pmsPropertyId,remoteType:"reservation",remoteId:snapshot.id,verifiedAt:timestamp,evidence:{eventId}});
      const active=!["cancelled","no_show","checked_out"].includes(String(snapshot.status)),pending=snapshot.status==="pending";
      const stage=pending?"payment_pending":active?"confirmed":snapshot.status==="cancelled"?"cancelled":"completed";
      const lifecycle=pending?"definite":active?"won":snapshot.status==="cancelled"?"lost":"closed";
      await tx.update(s.leads).set({stage,requestLifecycle:lifecycle,bookingReference:String(snapshot.confirmationNumber??""),
        updatedAt:timestamp}).where(and(eq(s.leads.id,lead.id),eq(s.leads.propertyId,propertyId),eq(s.leads.guestId,customerId)));
      if(lead.stage!==stage)await tx.insert(s.leadStageHistory).values({id:"pms_stage_"+randomUUID(),leadId:lead.id,stage,changedAt:timestamp});
      if(lead.requestLifecycle!==lifecycle)await tx.insert(s.requestLifecycleHistory).values({id:"pms_lifecycle_"+randomUUID(),leadId:lead.id,
        fromStatus:lead.requestLifecycle,toStatus:lifecycle,source:"pms_projection",reason:"Verified PMS "+String(snapshot.status),changedAt:timestamp});
    }
    if(context?.sourceSystem==="guestra_crm"&&typeof context.offerId==="string") {
      await tx.update(s.offers).set({status:snapshot.status==="cancelled"?"cancelled":"accepted",updatedAt:timestamp})
        .where(and(eq(s.offers.id,context.offerId),eq(s.offers.propertyId,propertyId),eq(s.offers.guestId,customerId)));
      await verifiedMapping(tx,{id:"mapping_"+randomUUID(),propertyId,tenantId:property.organizationId,sourceSystem:"guestra_pms",localType:"offer",
        localId:context.offerId,remotePropertyId:mapping.pmsPropertyId,remoteType:"reservation",remoteId:snapshot.id,verifiedAt:timestamp,evidence:{eventId}});
    }
  }
  // Projections never create local inventory, folio, payment or release AI ownership.
  return {applied:true};
}
export async function runOperation(db:Database,pms:PmsClient,propertyId:string,operationId:string) {
  const [row]=await db.select().from(i.integrationOperations).where(and(eq(i.integrationOperations.propertyId,propertyId),eq(i.integrationOperations.id,operationId))).limit(1);
  if(!row)throw new IntegrationError("OPERATION_NOT_FOUND",404);
  if(row.status==="completed" || row.status==="rejected")return row;
  try {
    await pms.attest(propertyId,pms.mapping(propertyId).crmTenantId);
    // Lookup first: a timed-out response can have committed in the remote DB.
    let receipt:Record<string,unknown>|undefined;
    try {receipt=await pms.call(propertyId,"v2/operations/"+encodeURIComponent(row.key),"GET",undefined,{customerId:row.customerId});}
    catch(error) {if(!(error instanceof IntegrationError) || error.status!==404)throw error;}
    let snapshot=receipt?.snapshot as Record<string,unknown>|undefined;
    if(!snapshot) {
      const routes:Record<string,{path:string;type:string;id:string}> = {
        book_accommodation:{path:"v2/book",type:"reservation",id:"reservationId"},
        book_service:{path:"v2/services/book",type:"service_booking",id:"serviceBookingId"},
        reschedule_service:{path:"v2/services/"+encodeURIComponent(String(row.payload.entityId))+"/reschedule",type:"service_booking",id:"id"},
        cancel_service:{path:"v2/services/"+encodeURIComponent(String(row.payload.entityId))+"/cancel",type:"service_booking",id:"id"},
        amend_accommodation:{path:"v2/reservations/"+encodeURIComponent(String(row.payload.entityId))+"/amend",type:"reservation",id:"reservationId"},
        cancel_accommodation:{path:"v2/reservations/"+encodeURIComponent(String(row.payload.entityId))+"/cancel",type:"reservation",id:"reservationId"},
        guest_request:{path:"v2/guest-requests",type:"service_request",id:"id"},
      };
      const route=routes[row.kind];if(!route)throw new IntegrationError("UNSUPPORTED_OPERATION");
      const {entityId: _entityId,...payload}=row.payload;
      const result=await pms.call(propertyId,route.path,"POST",payload);
      const remoteId=result[route.id];
      if(typeof remoteId!=="string")throw new IntegrationError("INVALID_PMS_RESULT",503,true);
      snapshot=await pms.call(propertyId,"v2/entities/"+route.type+"/"+encodeURIComponent(remoteId),"GET",undefined,{customerId:row.customerId});
    }
    return await db.transaction(async tx=>{
      const [current]=await tx.select().from(i.integrationOperations).where(and(eq(i.integrationOperations.id,row.id),eq(i.integrationOperations.propertyId,propertyId))).for("update");
      if(current.status==="completed")return current;
      await projectSnapshot(tx,pms,propertyId,row.customerId,snapshot!,"operation:"+row.id);
      const [completed]=await tx.update(i.integrationOperations).set({status:"completed",result:snapshot,attempts:current.attempts+1,lastError:null,updatedAt:new Date().toISOString()})
        .where(and(eq(i.integrationOperations.id,row.id),eq(i.integrationOperations.propertyId,propertyId))).returning();
      await tx.insert(i.integrationOutbox).values({id:"operation:"+row.id,propertyId,eventType:"crm.operation.completed",
        payload:{schemaVersion:"guestra-domain-event-v1",operationId:row.id,customerId:row.customerId,entityId:snapshot!.id}}).onConflictDoNothing();
      return completed;
    });
  } catch(error) {
    const failure=error instanceof IntegrationError?error:new IntegrationError("INTEGRATION_RECOVERY_REQUIRED",503,true);
    const retry=new Date(Date.now()+Math.min(3600000,1000*2**Math.min(row.attempts,12))).toISOString();
    await db.update(i.integrationOperations).set({status:failure.retryable?"pending":"rejected",attempts:sql`${i.integrationOperations.attempts}+1`,
      availableAt:retry,lastError:failure.code,updatedAt:new Date().toISOString()}).where(and(eq(i.integrationOperations.id,row.id),
        eq(i.integrationOperations.propertyId,propertyId),eq(i.integrationOperations.status,"pending")));
    throw failure;
  }
}
export async function acceptEvent(db:Database,pms:PmsClient,propertyId:string,input:unknown) {
  const event=IntegrationEventSchema.parse(input);
  const mapping=pms.mapping(propertyId);
  if(event.propertyId!==mapping.pmsPropertyId || event.tenantId!==mapping.pmsTenantId)throw new IntegrationError("EVENT_SCOPE_MISMATCH",403);
  const fingerprint=hashAgentPayload(event);
  await db.transaction(async tx=>{
    await tx.insert(i.integrationInbox).values({propertyId,eventId:event.eventId,fingerprint,envelope:event}).onConflictDoNothing();
    const [row]=await tx.select().from(i.integrationInbox).where(and(eq(i.integrationInbox.propertyId,propertyId),eq(i.integrationInbox.eventId,event.eventId))).limit(1);
    if(row.fingerprint!==fingerprint)throw new IntegrationError("EVENT_ID_CONFLICT");
  });
  return consumeEvent(db,pms,propertyId,event);
}
export async function consumeEvent(db:Database,pms:PmsClient,propertyId:string,event:IntegrationEvent) {
  const [receipt]=await db.select().from(i.integrationInbox).where(and(eq(i.integrationInbox.propertyId,propertyId),eq(i.integrationInbox.eventId,event.eventId))).limit(1);
  if(receipt?.status==="applied")return {duplicate:true};
  let customerId=event.integrationContext?.customerId;
  if(!customerId) {
    const [mapping]=await db.select().from(i.integrationMappings).where(and(eq(i.integrationMappings.propertyId,propertyId),
      eq(i.integrationMappings.remotePropertyId,event.propertyId),eq(i.integrationMappings.remoteType,event.entityType),eq(i.integrationMappings.remoteId,event.entityId))).limit(1);
    customerId=mapping?.localType==="customer"?mapping.localId:typeof mapping?.evidence.customerId==="string"?mapping.evidence.customerId:undefined;
    if(!customerId && mapping?.localType==="request") {
      const [lead]=await db.select({id:s.leads.guestId}).from(s.leads).where(and(eq(s.leads.id,mapping.localId),eq(s.leads.propertyId,propertyId))).limit(1);
      customerId=lead?.id;
    }
  }
  if(!customerId&&event.guestId) {
    const [mapping]=await db.select().from(i.integrationMappings).where(and(eq(i.integrationMappings.propertyId,propertyId),
      eq(i.integrationMappings.sourceSystem,"guestra_pms"),eq(i.integrationMappings.remotePropertyId,event.propertyId),
      eq(i.integrationMappings.remoteType,"guest"),eq(i.integrationMappings.remoteId,event.guestId),eq(i.integrationMappings.localType,"customer"))).limit(1);
    customerId=mapping?.localId;
  }
  if(!customerId) {
    await db.update(i.integrationInbox).set({lastError:"MAPPING_PENDING",
      availableAt:new Date(Date.now()+30000).toISOString(),attempts:sql`${i.integrationInbox.attempts}+1`})
      .where(and(eq(i.integrationInbox.propertyId,propertyId),eq(i.integrationInbox.eventId,event.eventId)));
    return {status:"pending",code:"MAPPING_PENDING"};
  }
  try {
    const snapshot=await pms.call(propertyId,"v2/entities/"+event.entityType+"/"+encodeURIComponent(event.entityId),"GET",undefined,{customerId});
    if(Number(snapshot.revision)<event.revision)throw new IntegrationError("READBACK_BEHIND_EVENT",503,true);
    return await db.transaction(async tx=>{
      const outcome=await projectSnapshot(tx,pms,propertyId,customerId!,snapshot,event.eventId);
      await tx.update(i.integrationInbox).set({status:"applied",lastError:null}).where(and(eq(i.integrationInbox.propertyId,propertyId),eq(i.integrationInbox.eventId,event.eventId)));
      return outcome;
    });
  }catch(error) {
    await db.update(i.integrationInbox).set({attempts:sql`${i.integrationInbox.attempts}+1`,lastError:error instanceof IntegrationError?error.code:"READBACK_FAILED",
      availableAt:new Date(Date.now()+Math.min(3600000,1000*2**Math.min(receipt?.attempts??0,12))).toISOString()})
      .where(and(eq(i.integrationInbox.propertyId,propertyId),eq(i.integrationInbox.eventId,event.eventId)));
    throw error;
  }
}
