import {Router} from "express";
import {and,eq} from "drizzle-orm";
import {randomUUID} from "node:crypto";
import {z} from "zod";
import type {Database} from "../db/client.js";
import type {AppConfig} from "../config.js";
import * as s from "../db/schema.js";
import * as i from "./schema.js";
import {PmsClient} from "./pms-client.js";
import {IntegrationError} from "./contract.js";
import {requireScope} from "./security.js";
import {resolveOrCreateExternalCustomer} from "../services/customer-service.js";
import {hashAgentPayload} from "../services/agent-action-service.js";
import {projectSnapshot,verifiedMapping} from "./service.js";
import {getIntegratedContext} from "./context.js";
export const fixtureStages=["new_contact","returning_customer","enquire","tentative","definite","pending_payment", "confirmed_reservation",
 "pre_arrival","in_house","service_only","due_out","post_stay","cancelled","human_handoff"] as const;
export function registerSandbox(router:Router,db:Database,config:AppConfig,pms:PmsClient) {
 const inputSchema=z.object({propertyId:z.string().min(1),fixtureId:z.string().min(1).max(120),stage:z.enum(fixtureStages)}).strict();
 async function allowed(propertyId:string) {
  if(config.GUESTRA_SANDBOX_SETUP_ENABLED!=="true"||!["test","sandbox"].includes(config.INTEGRATION_ENVIRONMENT??"production"))throw new IntegrationError("SANDBOX_ISOLATION_REQUIRED",403);
  const [registered]=await db.select().from(i.sandboxProperties).where(eq(i.sandboxProperties.propertyId,propertyId));
  const [property]=await db.select().from(s.properties).where(eq(s.properties.id,propertyId));
  if(!property||registered?.tenantId!==property.organizationId)throw new IntegrationError("SANDBOX_ISOLATION_REQUIRED",403);
  await pms.attest(propertyId,property.organizationId);return property;
 }
 router.post("/v2/sandbox/fixtures",requireScope("sandbox.setup"),async(request,response)=>{
  const input=inputSchema.parse(request.body),property=await allowed(input.propertyId),digest=hashAgentPayload(input);
  const where=and(eq(i.sandboxFixtures.propertyId,input.propertyId),eq(i.sandboxFixtures.key,input.fixtureId));
  const row=await db.transaction(async tx=>{
   await tx.select().from(s.properties).where(eq(s.properties.id,input.propertyId)).for("no key update");
   const [prior]=await tx.select().from(i.sandboxFixtures).where(where);
   if(prior){if(prior.fingerprint!==digest)throw new IntegrationError("IDEMPOTENCY_CONFLICT");return prior;}
   const {customerId}=await resolveOrCreateExternalCustomer(tx,{propertyId:input.propertyId,channel:"simulator",externalUserId:"fixture:"+input.fixtureId,firstName:"Sandbox",lastName:input.stage});
   const conversationId="fixture_conversation_"+randomUUID(),timestamp=new Date().toISOString();
   const [owner]=await tx.select().from(s.employees).where(eq(s.employees.organizationId,property.organizationId)).limit(1);
   const commercial=["enquire","tentative","definite","pending_payment","confirmed_reservation","pre_arrival","in_house","due_out","post_stay","cancelled"].includes(input.stage);
   const requestId=commercial?"fixture_request_"+randomUUID():null;
   if(requestId) {
    if(!owner)throw new IntegrationError("SANDBOX_STAFF_NOT_CONFIGURED");
    await tx.insert(s.leads).values({id:requestId,code:"FIX-"+requestId.slice(-8),guestId:customerId,propertyId:input.propertyId,source:"simulator",stage:"new",ownerId:owner.id,
     requestLifecycle:["tentative","definite"].includes(input.stage)?input.stage:"enquire",lastActivityAt:timestamp});
   }
   await tx.insert(s.conversations).values({id:conversationId,guestId:customerId,propertyId:input.propertyId,channel:"simulator",externalChatId:"fixture:"+input.fixtureId,
    leadId:requestId,status:"open",automationMode:input.stage==="human_handoff"?"needs_human":"ai",lastMessageAt:timestamp});
   const [fixture]=await tx.insert(i.sandboxFixtures).values({propertyId:input.propertyId,key:input.fixtureId,fingerprint:digest,customerId,conversationId,requestId,
    stage:input.stage,expiresAt:new Date(Date.now()+86400000).toISOString()}).returning();return fixture;
  });
  if(row.status==="retired"||Date.parse(row.expiresAt)<=Date.now())throw new IntegrationError("FIXTURE_EXPIRED");
  const remote=pms.mapping(input.propertyId);
  const result=await pms.call(input.propertyId,"v2/sandbox/fixtures","POST",{propertyId:remote.pmsPropertyId,fixtureId:input.fixtureId,
   stage:input.stage,customerId:row.customerId,conversationId:row.conversationId,...(row.requestId?{requestId:row.requestId}:{})});
  if(result.propertyId!==remote.pmsPropertyId||result.customerId!==row.customerId||result.stage!==input.stage)throw new IntegrationError("FIXTURE_READBACK_MISMATCH");
  const refs=z.object({guestId:z.string().uuid()}).passthrough().parse(result.refs);
  await db.transaction(async tx=>{
   await verifiedMapping(tx,{id:"mapping_"+randomUUID(),propertyId:input.propertyId,tenantId:property.organizationId,sourceSystem:"guestra_pms",localType:"customer",
    localId:row.customerId,remotePropertyId:remote.pmsPropertyId,remoteType:"guest",remoteId:refs.guestId,verifiedAt:new Date().toISOString(),evidence:{source:"isolated_fixture_readback",fixtureId:input.fixtureId}});
   for(const snapshot of z.array(z.record(z.unknown())).parse(result.snapshots))await projectSnapshot(tx,pms,input.propertyId,row.customerId,snapshot,"fixture:"+input.fixtureId);
   await tx.update(i.sandboxFixtures).set({status:"ready"}).where(where);
  });
  response.json({...result,propertyId:input.propertyId,pmsPropertyId:remote.pmsPropertyId,conversationId:row.conversationId,requestId:row.requestId,
   externalUserId:"fixture:"+input.fixtureId,context:await getIntegratedContext(db,row.conversationId,row.customerId)});
 });
 router.post("/v2/sandbox/fixtures/:key/retire",requireScope("sandbox.setup"),async(request,response)=>{
  const propertyId=z.string().parse(request.body.propertyId);await allowed(propertyId);
  const [row]=await db.select().from(i.sandboxFixtures).where(and(eq(i.sandboxFixtures.propertyId,propertyId),eq(i.sandboxFixtures.key,String(request.params.key))));
  if(!row)throw new IntegrationError("FIXTURE_NOT_FOUND",404);
  await pms.call(propertyId,"v2/sandbox/fixtures/"+encodeURIComponent(row.key)+"/retire","POST",{propertyId:pms.mapping(propertyId).pmsPropertyId,fixtureId:row.key,customerId:row.customerId,conversationId:row.conversationId,stage:row.stage});
  await db.transaction(async tx=>{
   await tx.update(s.conversations).set({status:"closed",automationMode:"human",updatedAt:new Date().toISOString()}).where(eq(s.conversations.id,row.conversationId));
   await tx.update(i.sandboxFixtures).set({status:"retired"}).where(and(eq(i.sandboxFixtures.propertyId,propertyId),eq(i.sandboxFixtures.key,row.key)));
  });
  response.json({fixtureId:row.key,retired:true,retainedForAudit:true});
 });
 router.post("/v2/sandbox/fixtures/:key/simulate-payment",requireScope("sandbox.setup"),async(request,response)=>{
  const propertyId=z.string().parse(request.body.propertyId);await allowed(propertyId);
  const [row]=await db.select().from(i.sandboxFixtures).where(and(eq(i.sandboxFixtures.propertyId,propertyId),eq(i.sandboxFixtures.key,String(request.params.key))));
  if(!row||row.status!=="ready"||Date.parse(row.expiresAt)<=Date.now())throw new IntegrationError("FIXTURE_EXPIRED");
  response.json(await pms.call(propertyId,"v2/sandbox/fixtures/"+encodeURIComponent(row.key)+"/simulate-payment","POST",{
   propertyId:pms.mapping(propertyId).pmsPropertyId,fixtureId:row.key,customerId:row.customerId,conversationId:row.conversationId,stage:row.stage}));
 });
}
