import {createHmac,randomUUID,timingSafeEqual} from "node:crypto";
import {Router} from "express";
import {and,eq,gt,asc,desc,inArray,lte,notInArray} from "drizzle-orm";
import {z} from "zod";
import type {Database} from "../db/client.js";
import type {AppConfig} from "../config.js";
import * as s from "../db/schema.js";
import * as i from "./schema.js";
import {PmsClient} from "./pms-client.js";
import {requireScope,requireTool} from "./security.js";
import {IntegrationError,IntegrationEventSchema} from "./contract.js";
import {acceptEvent,consumeEvent,enqueueOperation,runOperation} from "./service.js";
import {AgentAccommodationBookSchema,AgentContextRequestSchema,AgentConfirmationActionSchema,AgentGuestRequestSchema} from "../contracts/agent-contract.js";
import {AgentActionError,executeConfirmedAgentAction,hashAgentPayload} from "../services/agent-action-service.js";
import {findExternalIdentity} from "../services/customer-service.js";
import {registerV2Messaging} from "./messaging.js";
import {getIntegratedContext} from "./context.js";
import {registerV2Media} from "./media.js";
import {registerSandbox} from "./sandbox.js";
const identityFields={channel:z.enum(["simulator","telegram","whatsapp","instagram"]).default("telegram"),
  externalUserId:z.string().min(1),propertyId:z.string().min(1),conversationId:z.string().min(1)};
const quoteSchema=z.object({...identityFields,requestId:z.string().min(1),roomTypeId:z.string().uuid(),ratePlanId:z.string().uuid(),idempotencyKey:z.string().min(1).max(120)});
export async function identity(db:Pick<Database,"select">,input:{channel:string;externalUserId:string;propertyId:string;conversationId?:string}) {
  const [property]=await db.select().from(s.properties).where(eq(s.properties.id,input.propertyId)).limit(1);
  const contact=await findExternalIdentity(db,input.channel,input.propertyId,input.externalUserId);
  const [customer]=contact?await db.select().from(s.guests).where(eq(s.guests.id,contact.guestId)).limit(1):[];
  if(!property || !customer || customer.organizationId!==property.organizationId)throw new IntegrationError("IDENTITY_NOT_FOUND",404);
  const [conversation]=input.conversationId?await db.select().from(s.conversations).where(and(eq(s.conversations.id,input.conversationId),
    eq(s.conversations.guestId,customer.id),eq(s.conversations.propertyId,input.propertyId),eq(s.conversations.channel,input.channel))).limit(1):[];
  if(input.conversationId && !conversation)throw new IntegrationError("CONVERSATION_NOT_FOUND",404);
  return {property,customer,conversation};
}
export function createIntegrationV2Router(db:Database,config:AppConfig) {
  const router=Router(),pms=new PmsClient(config);
  router.use("/v2",async(request,response,next)=>{
    if(config.CRM_PMS_INTEGRATION_ENABLED!=="true")return response.status(503).json({code:"INTEGRATION_DISABLED",retryable:false});
    try {
      const [deployment]=await db.select().from(i.integrationDeployment).limit(1);
      if(!deployment||deployment.environment!==(config.INTEGRATION_ENVIRONMENT??"production"))
        throw new IntegrationError("INTEGRATION_DATABASE_NOT_ATTESTED",503);
      response.locals.integrationDeployment=deployment;
    } catch {
      return response.status(503).json({code:"INTEGRATION_DATABASE_NOT_ATTESTED",retryable:false});
    }
    next();
  });
  // Enabled agent paths fail closed; operational data never falls back into CRM.
  router.use((request,response,next)=>{
    if(config.CRM_PMS_INTEGRATION_ENABLED==="true" && [
      "/accommodations/options","/accommodations/availability","/offers/create","/accommodations/book",
      "/services/options","/services/availability","/services/book","/services/reschedule","/services/cancel",
      "/stay-context","/folio-summary","/guest-requests","/stays/extension/preview","/stays/extend",
    ].includes(request.path))return response.status(409).json({code:"PMS_V2_REQUIRED",error:"Use the authoritative PMS integration v2 contract",retryable:false});
    if(config.CRM_PMS_INTEGRATION_ENABLED==="true"&&request.path==="/messages/outbound/prepare"&&request.body?.proposedAction)
      return response.status(409).json({code:"PMS_V2_REQUIRED",retryable:false});
    next();
  });
  registerV2Messaging(router,db,pms,identity);
  registerV2Media(router,db,config,identity);
  registerSandbox(router,db,config,pms);
  router.get("/v2/capabilities",requireScope("integration.read"),async(request,response)=>{
    const propertyId=z.string().parse(request.query.propertyId);
    const [property]=await db.select().from(s.properties).where(eq(s.properties.id,propertyId)).limit(1);
    if(!property)throw new IntegrationError("PROPERTY_NOT_FOUND",404);
    const mapping=await pms.attest(propertyId,property.organizationId);
    response.json({contractVersion:"guestra-crm-integration-v2",environment:config.INTEGRATION_ENVIRONMENT??"production",
      propertyId,tenantId:property.organizationId,pmsPropertyId:mapping.pmsPropertyId,pmsTenantId:mapping.pmsTenantId,
      deploymentId:response.locals.integrationDeployment.deploymentId,
      verifiedMapping:true,operationalAuthority:"guestra_pms",features:{durableOperations:true,guestMessageChanges:true,operationReceipts:true}});
  });
  router.post("/v2/offers",requireScope("integration.write"),async(request,response)=>{
    requireTool(response,"create_offer");
    const input=quoteSchema.parse(request.body),scope=await identity(db,input);
    if(scope.conversation?.automationMode!=="ai")throw new IntegrationError("CONVERSATION_HUMAN_OWNED");
    const [lead]=await db.select().from(s.leads).where(and(eq(s.leads.id,input.requestId),eq(s.leads.guestId,scope.customer.id),eq(s.leads.propertyId,input.propertyId))).limit(1);
    if(!lead || scope.conversation?.leadId!==lead.id || !lead.checkIn || !lead.checkOut)throw new IntegrationError("REQUEST_NOT_FOUND",404);
    const externalQuoteId="pms:"+hashAgentPayload({propertyId:input.propertyId,customerId:scope.customer.id,key:input.idempotencyKey});
    const [existing]=await db.select().from(s.offers).where(eq(s.offers.externalQuoteId,externalQuoteId)).limit(1);
    if(existing) {
      const [mapping]=await db.select().from(i.integrationMappings).where(and(eq(i.integrationMappings.propertyId,input.propertyId),
        eq(i.integrationMappings.localType,"offer"),eq(i.integrationMappings.localId,existing.id),eq(i.integrationMappings.remoteType,"quote"))).limit(1);
      if(mapping?.evidence.inputHash!==hashAgentPayload(input))throw new IntegrationError("IDEMPOTENCY_CONFLICT");
      return response.json({offer:existing,pricing:mapping.evidence.pricing,duplicate:true});
    }
    const [booked]=await db.select().from(i.integrationMappings).where(and(eq(i.integrationMappings.propertyId,input.propertyId),
      eq(i.integrationMappings.localType,"request"),eq(i.integrationMappings.localId,lead.id),eq(i.integrationMappings.remoteType,"reservation"))).limit(1);
    if(booked)throw new IntegrationError("REQUEST_ALREADY_BOOKED");
    const mapping=await pms.attest(input.propertyId,scope.property.organizationId);
    const pricing=await pms.call(input.propertyId,"v2/quote","POST",{propertyId:mapping.pmsPropertyId,roomTypeId:input.roomTypeId,ratePlanId:input.ratePlanId,
      checkIn:lead.checkIn.slice(0,10),checkOut:lead.checkOut.slice(0,10),adults:lead.adults,children:lead.children,customerId:scope.customer.id});
    // Legacy CRM UI money columns are integral KZT. Never round accepted money silently.
    const total=Number(pricing.totalAmount);
    if(pricing.currency!=="KZT" || !Number.isSafeInteger(total)||total<0||total>2147483647)throw new IntegrationError("CRM_MONEY_PRECISION_UNSUPPORTED");
    const offer=await db.transaction(async tx=>{
      const id="offer_"+randomUUID(),timestamp=new Date().toISOString();
      const [created]=await tx.insert(s.offers).values({id,code:"PMS-"+id.slice(-8),leadId:lead.id,guestId:scope.customer.id,propertyId:input.propertyId,
        externalQuoteId,roomType:String(pricing.roomTypeName),checkIn:lead.checkIn,checkOut:lead.checkOut,adults:lead.adults,children:lead.children,
        nights:Number(pricing.nights),total,deposit:0,ownerId:lead.ownerId,status:"draft",expiresAt:String(pricing.expiresAt),createdAt:timestamp,updatedAt:timestamp}).onConflictDoNothing().returning();
      if(!created)throw new IntegrationError("QUOTE_RETRY_REQUIRED",503,true);
      await tx.update(s.leads).set({totalAmount:total,roomAmount:total,updatedAt:timestamp})
        .where(and(eq(s.leads.id,lead.id),eq(s.leads.propertyId,input.propertyId),eq(s.leads.guestId,scope.customer.id)));
      await tx.insert(i.integrationMappings).values({id:"mapping_"+randomUUID(),propertyId:input.propertyId,tenantId:scope.property.organizationId,sourceSystem:"guestra_pms",
        localType:"offer",localId:created.id,remotePropertyId:mapping.pmsPropertyId,remoteType:"quote",remoteId:hashAgentPayload(pricing.acceptedQuote),
        verifiedAt:timestamp,evidence:{inputHash:hashAgentPayload(input),pricing}});
      return created;
    });
    response.status(201).json({offer,pricing,duplicate:false});
  });
  router.post("/v2/accommodations/book",requireScope("integration.write"),async(request,response)=>{
    requireTool(response,"book_accommodation");
    const input=AgentAccommodationBookSchema.parse(request.body),scope=await identity(db,input);
    const [offer]=await db.select().from(s.offers).where(and(eq(s.offers.id,input.offerId),eq(s.offers.propertyId,input.propertyId),eq(s.offers.guestId,scope.customer.id))).limit(1);
    const [quote]=await db.select().from(i.integrationMappings).where(and(eq(i.integrationMappings.propertyId,input.propertyId),eq(i.integrationMappings.localType,"offer"),
      eq(i.integrationMappings.localId,input.offerId),eq(i.integrationMappings.remoteType,"quote"))).limit(1);
    if(!offer || !quote || scope.conversation?.leadId!==offer.leadId)throw new IntegrationError("PMS_ACCEPTED_QUOTE_REQUIRED");
    const price=quote.evidence.pricing as Record<string,unknown>;
    const remote=pms.mapping(input.propertyId);
    const claim=await executeConfirmedAgentAction(db,{...input,customerId:scope.customer.id,actionType:"book_accommodation",payload:{offerId:offer.id},
      allowedActions:["book_accommodation"]},async tx=>{
      const [latest]=await tx.select().from(s.offers).where(and(eq(s.offers.id,offer.id),eq(s.offers.propertyId,input.propertyId))).for("update");
      if(!latest || Date.parse(latest.expiresAt)<=Date.now() || ["cancelled","expired"].includes(latest.status))throw new IntegrationError("QUOTE_EXPIRED");
      const key="crm:"+hashAgentPayload({propertyId:input.propertyId,proposal:input.proposalMessageId,confirmation:input.confirmationMessageId});
      const [booked]=await tx.select().from(i.integrationMappings).where(and(eq(i.integrationMappings.propertyId,input.propertyId),
        eq(i.integrationMappings.localType,"request"),eq(i.integrationMappings.localId,offer.leadId),eq(i.integrationMappings.remoteType,"reservation"))).limit(1);
      if(booked)throw new IntegrationError("REQUEST_ALREADY_BOOKED");
      const pending=await tx.select().from(i.integrationOperations).where(and(eq(i.integrationOperations.propertyId,input.propertyId),
        eq(i.integrationOperations.customerId,scope.customer.id),eq(i.integrationOperations.kind,"book_accommodation"),eq(i.integrationOperations.status,"pending")));
      if(pending.some(row=>(row.payload.integrationContext as Record<string,unknown>|undefined)?.requestId===offer.leadId))
        throw new IntegrationError("REQUEST_BOOKING_IN_PROGRESS",503,true);
      const operation=await enqueueOperation(tx,{propertyId:input.propertyId,customerId:scope.customer.id,conversationId:input.conversationId,kind:"book_accommodation",key,
        payload:{propertyId:remote.pmsPropertyId,roomTypeId:price.roomTypeId,ratePlanId:price.ratePlanId,checkIn:offer.checkIn!.slice(0,10),
          checkOut:offer.checkOut!.slice(0,10),adults:offer.adults,children:offer.children,guestFirstName:scope.customer.firstName??scope.customer.fullName,
          guestLastName:scope.customer.lastName??undefined,idempotencyKey:key,acceptedQuote:price.acceptedQuote,
          integrationContext:{sourceSystem:"guestra_crm",customerId:scope.customer.id,requestId:offer.leadId,offerId:offer.id,conversationId:input.conversationId,operationId:key}}});
      return {operationId:operation.id,operationKey:key,status:"pending"};
    });
    const result=await runOperation(db,pms,input.propertyId,String(claim.result.operationId));
    response.json({operationId:result.id,status:result.status,snapshot:result.result,duplicate:claim.duplicate});
  });
  router.get("/v2/operations/:id",requireScope("integration.read"),async(request,response)=>{
    const query=AgentContextRequestSchema.extend({conversationId:z.string().min(1)}).parse(request.query),scope=await identity(db,query);
    const [row]=await db.select().from(i.integrationOperations).where(and(eq(i.integrationOperations.id,String(request.params.id)),eq(i.integrationOperations.propertyId,query.propertyId),
      eq(i.integrationOperations.customerId,scope.customer.id),eq(i.integrationOperations.conversationId,query.conversationId))).limit(1);
    if(!row)throw new IntegrationError("OPERATION_NOT_FOUND",404);
    response.json({operationId:row.id,operationKey:row.key,status:row.status,result:row.result,errorCode:row.lastError,attempts:row.attempts});
  });
  const confirmationFields={...identityFields,proposalMessageId:z.string().min(1),confirmationMessageId:z.string().min(1),idempotencyKey:z.string().min(1).max(120)};
  const servicePayload=z.object({serviceId:z.string().uuid(),startAt:z.string().datetime(),endAt:z.string().datetime(),
    participants:z.number().int().positive().max(10000),quantity:z.number().int().positive().max(10000).default(1),
    expectedTotal:z.string().regex(/^\d+(\.\d{1,2})?$/),reservationId:z.string().uuid().optional()}).strict();
  const revisionFields={entityId:z.string().uuid(),expectedRevision:z.number().int().positive()};
  const actionSchema=z.discriminatedUnion("actionType",[
    z.object({...confirmationFields,actionType:z.literal("book_service"),payload:servicePayload}),
    z.object({...confirmationFields,actionType:z.literal("reschedule_service"),payload:z.object({...revisionFields,startAt:z.string().datetime(),endAt:z.string().datetime()}).strict()}),
    z.object({...confirmationFields,actionType:z.literal("cancel_service"),payload:z.object(revisionFields).strict()}),
    z.object({...confirmationFields,actionType:z.literal("cancel_accommodation"),payload:z.object({entityId:z.string().uuid(),expectedUpdatedAt:z.string().datetime(),reason:z.string().max(1000).optional()}).strict()}),
    z.object({...confirmationFields,actionType:z.literal("amend_accommodation"),payload:z.object({entityId:z.string().uuid(),expectedUpdatedAt:z.string().datetime(),acceptedQuote:z.string().min(1).max(20000)}).strict()}),
  ]);
  router.post("/v2/actions",requireScope("integration.write"),async(request,response)=>{
    const input=actionSchema.parse(request.body),scope=await identity(db,input);
    requireTool(response,input.actionType);
    const remote=await pms.attest(input.propertyId,scope.property.organizationId);
    const claim=await executeConfirmedAgentAction(db,{...input,customerId:scope.customer.id,
      allowedActions:AgentConfirmationActionSchema.options},async tx=>{
      const key="crm:"+hashAgentPayload({propertyId:input.propertyId,conversationId:input.conversationId,key:input.idempotencyKey});
      const operation=await enqueueOperation(tx,{propertyId:input.propertyId,customerId:scope.customer.id,conversationId:input.conversationId,
        kind:input.actionType,key,payload:{...input.payload,propertyId:remote.pmsPropertyId,idempotencyKey:key,
          ...(input.actionType==="book_service"?{guestFirstName:scope.customer.firstName??scope.customer.fullName,
            integrationContext:{sourceSystem:"guestra_crm",customerId:scope.customer.id,conversationId:input.conversationId,operationId:key}}:{customerId:scope.customer.id})}});
      return {operationId:operation.id,status:"pending"};
    });
    const result=await runOperation(db,pms,input.propertyId,String(claim.result.operationId));
    response.json({operationId:result.id,status:result.status,snapshot:result.result,duplicate:claim.duplicate});
  });
  router.post("/v2/guest-requests",requireScope("integration.write"),async(request,response)=>{
    requireTool(response,"create_guest_request");
    const input=AgentGuestRequestSchema.extend({conversationId:z.string().min(1)}).parse(request.body),scope=await identity(db,input);
    const [message]=await db.select().from(s.messages).where(and(eq(s.messages.id,input.sourceMessageId),
      eq(s.messages.conversationId,scope.conversation!.id),eq(s.messages.direction,"in"),eq(s.messages.senderType,"contact"))).limit(1);
    if(!message||scope.conversation?.automationMode!=="ai")throw new IntegrationError("GUEST_REQUEST_SOURCE_REQUIRED");
    const remote=await pms.attest(input.propertyId,scope.property.organizationId);
    const key="crm:"+hashAgentPayload({propertyId:input.propertyId,conversationId:input.conversationId,key:input.idempotencyKey});
    const operation=await db.transaction(tx=>enqueueOperation(tx,{propertyId:input.propertyId,customerId:scope.customer.id,
      conversationId:input.conversationId,kind:"guest_request",key,payload:{propertyId:remote.pmsPropertyId,idempotencyKey:key,
        type:"service_request",title:input.title,description:input.description,department:input.department,
        priority:["low","medium","high","urgent"].indexOf(input.priority),integrationContext:{sourceSystem:"guestra_crm",
          customerId:scope.customer.id,conversationId:input.conversationId,operationId:key}}}));
    const result=await runOperation(db,pms,input.propertyId,operation.id);
    response.json({operationId:result.id,status:result.status,snapshot:result.result});
  });
  router.post("/v2/reservations/:id/quote",requireScope("integration.read"),async(request,response)=>{
    const input=z.object({...identityFields,checkIn:z.string().regex(/^\d{4}-\d{2}-\d{2}$/),checkOut:z.string().regex(/^\d{4}-\d{2}-\d{2}$/)}).parse(request.body);
    const scope=await identity(db,input),id=z.string().uuid().parse(request.params.id);
    const snapshot=await pms.call(input.propertyId,"v2/entities/reservation/"+id,"GET",undefined,{customerId:scope.customer.id});
    const quote=await pms.call(input.propertyId,"v2/quote","POST",{propertyId:pms.mapping(input.propertyId).pmsPropertyId,
      roomTypeId:snapshot.roomTypeId,ratePlanId:snapshot.ratePlanId,checkIn:input.checkIn,checkOut:input.checkOut,
      adults:snapshot.adults,children:snapshot.children,customerId:scope.customer.id});
    response.json({quote,expectedUpdatedAt:snapshot.updatedAt});
  });
  router.get("/v2/services",requireScope("integration.read"),async(request,response)=>{
    const input=z.object(identityFields).parse(request.query);await identity(db,input);
    response.json({services:await pms.call(input.propertyId,"v2/services")});
  });
  router.post("/v2/accommodations/search",requireScope("integration.read"),async(request,response)=>{
    const input=z.object({...identityFields,checkIn:z.string().regex(/^\d{4}-\d{2}-\d{2}$/),checkOut:z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      adults:z.number().int().positive().max(100),children:z.number().int().nonnegative().max(100).default(0)}).parse(request.body);
    await identity(db,input);
    response.json(await pms.call(input.propertyId,"v2/search","POST",{propertyId:pms.mapping(input.propertyId).pmsPropertyId,
      checkIn:input.checkIn,checkOut:input.checkOut,adults:input.adults,children:input.children,rooms:1}));
  });
  router.post("/v2/services/availability",requireScope("integration.read"),async(request,response)=>{
    const input=z.object({...identityFields,serviceId:z.string().uuid(),startAt:z.string().datetime(),endAt:z.string().datetime(),
      quantity:z.number().int().positive().max(10000).default(1),participants:z.number().int().positive().max(10000).default(1)}).parse(request.body);
    await identity(db,input);
    response.json(await pms.call(input.propertyId,"v2/services/availability","POST",{propertyId:pms.mapping(input.propertyId).pmsPropertyId,
      serviceId:input.serviceId,startAt:input.startAt,endAt:input.endAt,quantity:input.quantity,participants:input.participants}));
  });
  router.post("/v2/reconcile",requireScope("integration.reconcile"),async(request,response)=>{
    const propertyId=z.string().parse(request.body.propertyId);
    const operations=await db.select().from(i.integrationOperations).where(and(eq(i.integrationOperations.propertyId,propertyId),eq(i.integrationOperations.status,"pending"),
      lte(i.integrationOperations.availableAt,new Date().toISOString()))).limit(50);
    let completed=0,rejected=0;for(const operation of operations)try{const row=await runOperation(db,pms,propertyId,operation.id);if(row.status==="completed")completed++;else if(row.status==="rejected")rejected++;}catch{/* durable pending receipt */}
    const receipts=await db.select().from(i.integrationInbox).where(and(eq(i.integrationInbox.propertyId,propertyId),eq(i.integrationInbox.status,"pending"),
      lte(i.integrationInbox.availableAt,new Date().toISOString()))).limit(50);
    let applied=0;for(const receipt of receipts)try{const result=await consumeEvent(db,pms,propertyId,IntegrationEventSchema.parse(receipt.envelope));if(!("status" in result)||result.status!=="pending")applied++;}catch{/* durable retry */}
    response.json({completed,rejected,applied,pendingOperations:operations.length-completed-rejected,pendingEvents:receipts.length-applied});
  });
  router.post("/v2/events",requireScope("events.consume"),async(request,response)=>{
    const timestamp=request.header("x-guestra-timestamp"),signature=request.header("x-guestra-signature");
    if(!config.PMS_EVENT_SECRET || !timestamp || !/^\d+$/.test(timestamp) || Math.abs(Date.now()/1000-Number(timestamp))>300)
      throw new IntegrationError("INVALID_EVENT_SIGNATURE",401);
    const raw=(request as unknown as {rawBody:Buffer}).rawBody;
    const expected=createHmac("sha256",config.PMS_EVENT_SECRET).update(timestamp+".").update(raw).digest();
    const provided=Buffer.from(signature??"","hex");
    if(expected.length!==provided.length || !timingSafeEqual(expected,provided))throw new IntegrationError("INVALID_EVENT_SIGNATURE",401);
    const propertyId=z.string().parse(request.body.propertyId),event=request.body.event;
    const result=await acceptEvent(db,pms,propertyId,event);
    response.json(result);
  });
  router.get("/v2/events",requireScope("events.read"),async(request,response)=>{
    const input=z.object({propertyId:z.string().min(1),after:z.coerce.number().int().nonnegative().safe().optional(),
      limit:z.coerce.number().int().min(1).max(200).default(100)}).parse(request.query);
    const principalId=response.locals.integrationPrincipal.id as string;
    const [consumer]=await db.select().from(i.integrationEventConsumers).where(and(
      eq(i.integrationEventConsumers.propertyId,input.propertyId),eq(i.integrationEventConsumers.principalId,principalId))).limit(1);
    const after=input.after??consumer?.sequence??0;
    const rows=await db.select().from(i.integrationOutbox).where(and(eq(i.integrationOutbox.propertyId,input.propertyId),
      gt(i.integrationOutbox.sequence,after))).orderBy(asc(i.integrationOutbox.sequence)).limit(input.limit+1);
    const page=rows.slice(0,input.limit);
    response.json({contractVersion:"guestra-crm-events-v1",events:page.map(row=>({eventId:row.id,sequence:row.sequence,eventType:row.eventType,
      propertyId:row.propertyId,occurredAt:row.createdAt,payload:row.payload})),nextCursor:page.at(-1)?.sequence??after,hasMore:rows.length>input.limit});
  });
  router.post("/v2/events/ack",requireScope("events.read"),async(request,response)=>{
    const input=z.object({propertyId:z.string().min(1),sequence:z.number().int().nonnegative().safe()}).parse(request.body);
    const [head]=await db.select({sequence:i.integrationOutbox.sequence}).from(i.integrationOutbox)
      .where(eq(i.integrationOutbox.propertyId,input.propertyId)).orderBy(desc(i.integrationOutbox.sequence)).limit(1);
    if(input.sequence>(head?.sequence??0))throw new IntegrationError("INVALID_EVENT_CURSOR");
    await db.insert(i.integrationEventConsumers).values({propertyId:input.propertyId,principalId:response.locals.integrationPrincipal.id,sequence:input.sequence})
      .onConflictDoUpdate({target:[i.integrationEventConsumers.propertyId,i.integrationEventConsumers.principalId],
        set:{sequence:input.sequence,updatedAt:new Date().toISOString()},setWhere:lte(i.integrationEventConsumers.sequence,input.sequence)});
    response.json({acknowledged:input.sequence});
  });
  router.get("/v2/conversations/:id/changes",requireScope("agent.read"),async(request,response)=>{
    const query=AgentContextRequestSchema.extend({after:z.coerce.number().int().nonnegative().safe().default(0),limit:z.coerce.number().int().min(1).max(200).default(100)}).parse(request.query);
    const scope=await identity(db,{...query,conversationId:String(request.params.id)});
    const rows=await db.select().from(i.messageChanges).where(and(eq(i.messageChanges.conversationId,scope.conversation!.id),gt(i.messageChanges.sequence,query.after)))
      .orderBy(asc(i.messageChanges.sequence)).limit(query.limit+1);
    const page=rows.slice(0,query.limit);
    const messages=page.length?await db.select().from(s.messages).where(and(inArray(s.messages.id,page.map(r=>r.messageId)),
      inArray(s.messages.direction,["in","out"]),notInArray(s.messages.senderType,["internal","note"]))):[];
    const attachments=messages.length?await db.select().from(s.messageAttachments).where(inArray(s.messageAttachments.messageId,messages.map(m=>m.id))):[];
    response.json({contractVersion:"guest-message-changes-v1",conversationId:scope.conversation!.id,nextCursor:page.at(-1)?.sequence??query.after,hasMore:rows.length>query.limit,
      changes:page.map(change=>{const message=messages.find(m=>m.id===change.messageId);
        return {sequence:change.sequence,kind:!message?"tombstone":change.kind,messageId:change.messageId,...(message?{message:{
          id:message.id,direction:message.direction,senderType:message.senderType,text:message.text,at:message.sentAt,deliveryStatus:message.deliveryStatus,
          externalMessageId:message.externalMessageId,attachments:attachments.filter(a=>a.messageId===message.id).map(a=>({
            id:a.id,externalFileId:a.externalFileId,kind:a.kind,mimeType:a.mimeType,fileName:a.fileName,fileSize:a.fileSize,
            processingStatus:a.processingStatus,...(a.processingStatus==="ready"?{transcript:a.transcript}:{})}))}}:{})};})});
  });
  router.get("/v2/context",requireScope("integration.read"),async(request,response)=>{
    const query=AgentContextRequestSchema.extend({conversationId:z.string().min(1)}).parse(request.query),scope=await identity(db,query);
    const projections=await db.select().from(i.integrationProjections).where(and(eq(i.integrationProjections.propertyId,query.propertyId),eq(i.integrationProjections.customerId,scope.customer.id)));
    response.json({customerId:scope.customer.id,conversationId:scope.conversation!.id,automationMode:scope.conversation!.automationMode,
      context:await getIntegratedContext(db,scope.conversation!.id,scope.customer.id),
      aiReplyAllowed:scope.conversation!.automationMode==="ai",operationalAuthority:"guestra_pms",projections:projections.map(p=>({type:p.entityType,id:p.entityId,revision:p.revision,snapshot:p.snapshot,verifiedAt:p.verifiedAt}))});
  });
  router.get("/v2/inspector",requireScope("inspector.read"),async(request,response)=>{
    const input=z.object(identityFields).parse(request.query),scope=await identity(db,input);
    const events=await db.select().from(s.agentToolEvents).where(and(eq(s.agentToolEvents.propertyId,input.propertyId),
      eq(s.agentToolEvents.guestId,scope.customer.id),eq(s.agentToolEvents.conversationId,input.conversationId)))
      .orderBy(desc(s.agentToolEvents.createdAt)).limit(100);
    response.json({customerId:scope.customer.id,conversationId:input.conversationId,events:events.map(event=>({
      id:event.id,tool:event.tool,statusCode:event.statusCode,success:event.success,errorCode:event.errorCode,
      durationMs:event.durationMs,at:event.createdAt,operationReference:event.requestId,
      references:Object.fromEntries(["correlationId","executionReference","promptVersion","deploymentReference","messageId","requestId","offerId","operationId","reservationId","serviceBookingId"]
        .filter(key=>typeof event.metadata[key]==="string").map(key=>[key,event.metadata[key]])),
    }))});
  });
  router.get("/v2/inbox",requireScope("inbox.read"),async(request,response)=>{
    const input=z.object({propertyId:z.string().min(1),offset:z.coerce.number().int().min(0).max(100000).default(0),
      limit:z.coerce.number().int().positive().max(100).default(50)}).parse(request.query);
    const remote=pms.mapping(input.propertyId);
    const rows=await db.select({conversation:s.conversations,customer:s.guests}).from(s.conversations)
      .innerJoin(s.guests,eq(s.guests.id,s.conversations.guestId)).where(and(eq(s.conversations.propertyId,input.propertyId),
        eq(s.guests.organizationId,remote.crmTenantId))).orderBy(desc(s.conversations.lastMessageAt),asc(s.conversations.id)).offset(input.offset).limit(input.limit+1);
    response.json({propertyId:input.propertyId,pmsPropertyId:remote.pmsPropertyId,tenantId:remote.crmTenantId,hasMore:rows.length>input.limit,
      conversations:rows.slice(0,input.limit).map(({conversation,customer})=>({id:conversation.id,customerId:customer.id,
        customerName:customer.fullName,channel:conversation.channel,status:conversation.status,automationMode:conversation.automationMode,
        unreadCount:conversation.unreadCount,lastMessageAt:conversation.lastMessageAt,requestId:conversation.leadId}))});
  });
  router.get("/v2/inbox/:id",requireScope("inbox.read"),async(request,response)=>{
    const propertyId=z.string().min(1).parse(request.query.propertyId);
    const [conversation]=await db.select().from(s.conversations).where(and(eq(s.conversations.id,String(request.params.id)),eq(s.conversations.propertyId,propertyId))).limit(1);
    if(!conversation)throw new IntegrationError("CONVERSATION_NOT_FOUND",404);
    const rows=await db.select().from(s.messages).where(and(eq(s.messages.conversationId,conversation.id),
      inArray(s.messages.direction,["in","out"]),notInArray(s.messages.senderType,["note","internal"]))).orderBy(desc(s.messages.sentAt),desc(s.messages.id)).limit(100);
    response.json({id:conversation.id,customerId:conversation.guestId,propertyId,automationMode:conversation.automationMode,
      messages:rows.reverse().map(message=>({id:message.id,direction:message.direction,text:message.text,at:message.sentAt,
        senderType:message.senderType,deliveryStatus:message.deliveryStatus})),hasOlderMessages:rows.length===100});
  });
  router.post("/v2/inbox/:id/takeover",requireScope("inbox.handoff"),async(request,response)=>{
    const input=z.object({propertyId:z.string().min(1),staffReference:z.string().min(1).max(160)}).parse(request.body);
    const [conversation]=await db.transaction(async tx=>{
      const timestamp=new Date().toISOString();
      const rows=await tx.update(s.conversations).set({automationMode:"human",handoffResolvedAt:timestamp,updatedAt:timestamp})
        .where(and(eq(s.conversations.id,String(request.params.id)),eq(s.conversations.propertyId,input.propertyId))).returning();
      if(rows.length)await tx.insert(s.agentToolEvents).values({id:"handoff_"+randomUUID(),propertyId:input.propertyId,conversationId:rows[0].id,
        guestId:rows[0].guestId,tool:"pms_staff_takeover",success:true,statusCode:200,durationMs:0,
        metadata:{principalId:response.locals.integrationPrincipal.id,staffReference:input.staffReference}});
      return rows;
    });
    if(!conversation)throw new IntegrationError("CONVERSATION_NOT_FOUND",404);
    response.json({id:conversation.id,automationMode:conversation.automationMode});
  });
  router.use((error:unknown,_request:import("express").Request,response:import("express").Response,next:import("express").NextFunction)=>{
    if(error instanceof IntegrationError || error instanceof AgentActionError)return response.status(error.status).json({code:error.code,retryable:error.retryable,error:error.code});
    if(error instanceof z.ZodError)return response.status(400).json({code:"VALIDATION_ERROR",retryable:false});
    next(error);
  });
  return router;
}
