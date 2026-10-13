// @vitest-environment node
import {readFile} from "node:fs/promises";
import {createHash,randomUUID} from "node:crypto";
import {PGlite} from "@electric-sql/pglite";
import {drizzle} from "drizzle-orm/pglite";
import {and,eq} from "drizzle-orm";
import request from "supertest";
import {beforeAll,afterAll,afterEach,describe,it,expect,vi} from "vitest";
import {createApp} from "../app.js";
import {bootstrapDatabase} from "../db/bootstrap.js";
import type {Database} from "../db/client.js";
import type {AppConfig} from "../config.js";
import * as s from "../db/schema.js";
import * as i from "./schema.js";
import {PmsClient} from "./pms-client.js";
import {acceptEvent,projectSnapshot,enqueueOperation,runOperation} from "./service.js";
import {getAgentContext} from "../services/agent-context-service.js";
import {findExternalIdentity,displayExternalIdentityId} from "../services/customer-service.js";
const key="scoped-integration-test-credential",remoteProperty="10000000-0000-4000-8000-000000000001",remoteTenant="20000000-0000-4000-8000-000000000001";
const config:AppConfig={DATABASE_URL:"postgresql://unused/test",SESSION_SECRET:"test-session-secret-that-is-at-least-32-characters",
 CRM_INTEGRATION_API_KEY:"legacy-integration-key",SALES_BOOTSTRAP_EMAIL:"sales@guestra.com",SALES_BOOTSTRAP_PASSWORD:"sales123",
 ADMIN_BOOTSTRAP_EMAIL:"admin@guestra.com",ADMIN_BOOTSTRAP_PASSWORD:"admin_123",PORT:3000,NODE_ENV:"test",
 CRM_PMS_INTEGRATION_ENABLED:"true",INTEGRATION_ENVIRONMENT:"test",PMS_CONNECT_URL:"http://127.0.0.1:4999/api/v1/connect",
 PMS_CONNECT_KEY:"test-pms-credential",PMS_EVENT_SECRET:"test-event-secret-at-least-thirty-two-characters",
 MEDIA_REFERENCE_SECRET:"test-media-reference-signing-secret-32-characters",MEDIA_ALLOWED_ORIGINS:'["https://media.test"]'};
let db:Database,client:PGlite,app:ReturnType<typeof createApp>,customerId:string,conversationId:string,tenantId:string;
beforeAll(async()=>{
 client=new PGlite();
 const journal=JSON.parse(await readFile(new URL("../../drizzle/meta/_journal.json",import.meta.url),"utf8"));
 for(const entry of journal.entries) {
  const migration=await readFile(new URL("../../drizzle/"+entry.tag+".sql",import.meta.url),"utf8");
  for(const statement of migration.split("--> statement-breakpoint").map((v:string)=>v.trim()).filter(Boolean))await client.exec(statement);
 }
 db=drizzle(client,{schema:s}) as unknown as Database;
 await bootstrapDatabase(db,config);
 const [property]=await db.select().from(s.properties).where(eq(s.properties.id,"les_borovoe"));
 tenantId=property.organizationId;
 config.PMS_PROPERTY_MAPPINGS=JSON.stringify([{crmPropertyId:property.id,crmTenantId:tenantId,pmsPropertyId:remoteProperty,pmsTenantId:remoteTenant,environment:"test"}]);
 config.CRM_INTEGRATION_PRINCIPALS=JSON.stringify([{id:"test-studio",keyHash:createHash("sha256").update(key).digest("hex"),environment:"test",
   propertyIds:["les_borovoe"],workspaceIds:["studio-test"],scopes:["agent.read","agent.write","integration.read","integration.write","integration.reconcile","events.consume","media.read","media.write","tool:get_context"]}]);
 const migration=await readFile(new URL("../../integration-migrations/0001_cross_database_v2.sql",import.meta.url),"utf8");
 await client.exec(migration);await client.exec(migration);
 await db.insert(i.integrationDeployment).values({id:true,environment:"test",deploymentId:randomUUID()});
 app=createApp(db,config);
 const result=await request(app).post("/api/integrations/agent/messages/inbound").set("x-crm-api-key",key)
  .send({channel:"simulator",externalUserId:"cross-user",externalChatId:"cross-chat",externalMessageId:"cross-first",propertyId:"les_borovoe",text:"Привет",firstName:"Тест"}).expect(201);
 customerId=result.body.context.customer.id;conversationId=result.body.context.conversation.id;
},40000);
afterAll(async()=>{await client.close();});
afterEach(()=>vi.unstubAllGlobals());
const get=(path:string)=>request(app).get("/api/integrations/agent"+path).set("x-crm-api-key",key);
const post=(path:string)=>request(app).post("/api/integrations/agent"+path).set("x-crm-api-key",key);
const scope={channel:"simulator",externalUserId:"cross-user",propertyId:"les_borovoe"};
const snapshot=(revision:number,status="assigned",id="30000000-0000-4000-8000-000000000001")=>({
 sourceSystem:"guestra_pms",propertyId:remoteProperty,tenantId:remoteTenant,entityType:"reservation",id,
 guestId:"40000000-0000-4000-8000-000000000001",revision,status,confirmationNumber:"PMS-TEST",totalAmount:"50000.00",currencyCode:"KZT",
 checkIn:"2027-01-01",checkOut:"2027-01-02",integrationContext:{sourceSystem:"guestra_crm",customerId}});
function fakeRemote(readback:Record<string,unknown>,onBook?:()=>void) {
 vi.stubGlobal("fetch",vi.fn(async(url:URL,options:RequestInit)=>{
  if(url.pathname.endsWith("/capabilities"))return Response.json({contractVersion:"guestra-connect-v2",propertyId:remoteProperty,tenantId:remoteTenant,environment:"test"});
  if(url.pathname.includes("/operations/"))return new Response("missing",{status:404});
  if(url.pathname.endsWith("/v2/book")){onBook?.();return Response.json({reservationId:readback.id});}
  return Response.json(readback);
 }));
}
describe("Cross database integration invariants",()=>{
 it("signs only clean, owned, short lived media references and denies workspace and origin substitution",async()=>{
  const input={...scope,conversationId,externalChatId:"cross-chat",externalMessageId:"media-owned-message",text:"Голосовое сообщение",
   attachments:[{kind:"audio",externalFileId:"voice-test",mimeType:"audio/ogg",fileName:"voice.ogg",fileSize:2000}]};
  const inbound=await post("/messages/inbound").send(input).expect(201);
  const [attachment]=await db.select().from(s.messageAttachments).where(eq(s.messageAttachments.messageId,inbound.body.messageId));
  const path="/v2/media/"+attachment.id;
  const ref={...scope,conversationId,workspaceId:"studio-test",referenceUrl:"https://media.test/short-signed-object",expiresAt:new Date(Date.now()+120000).toISOString(),mimeType:"audio/ogg",fileSize:2000,scanStatus:"clean",callId:"virtual-call-1"};
  await post(path+"/reference").send({...ref,workspaceId:"other-workspace"}).expect(403);
  await post(path+"/reference").send({...ref,referenceUrl:"https://untrusted.test/file"}).expect(403);
  await post(path+"/reference").send(ref).expect(200);
  await get(path+"/url").query({...scope,conversationId}).expect(409);
  await db.update(s.messageAttachments).set({processingStatus:"ready",transcript:"Привет"}).where(eq(s.messageAttachments.id,attachment.id));
  const signed=await get(path+"/url").query({...scope,conversationId}).expect(200);
  expect(signed.body.url).not.toContain("short-signed-object");
  await request(app).get(signed.body.url).expect(303).expect("Location",ref.referenceUrl);
  await request(app).get(signed.body.url+"tampered").expect(401);
  const [ready]=await db.select().from(s.messageAttachments).where(eq(s.messageAttachments.id,attachment.id));
  await db.update(s.messageAttachments).set({metadata:{...ready.metadata,referenceExpiresAt:new Date(Date.now()-1).toISOString()}}).where(eq(s.messageAttachments.id,attachment.id));
  await request(app).get(signed.body.url).expect(410);
 });
 it("preserves original external ids and isolates same phone and ids across properties",async()=>{
  const identity=await findExternalIdentity(db,"simulator","les_borovoe","cross-user");
  expect(displayExternalIdentityId(identity!.externalUserId)).toBe("cross-user");
  const input={...scope,externalChatId:"cross-chat",externalMessageId:"same-message",text:"Другой отель",phone:"+77000000000"};
  const second=await request(app).post("/api/integrations/agent/messages/inbound").set("x-crm-api-key",config.CRM_INTEGRATION_API_KEY)
    .send({...input,propertyId:"les_astana"}).expect(201);
  expect(second.body.context.customer.id).not.toBe(customerId);
  const first=await post("/messages/inbound").send(input).expect(201);
  expect(first.body.context.customer.id).toBe(customerId);
  const separate=await post("/messages/inbound").send({...input,externalUserId:"second-identity",externalMessageId:"second-message"}).expect(201);
  expect(separate.body.context.customer.id).not.toBe(customerId);
 });
 it("denies mock account business writes even with a valid integration key",async()=>{
  const sales=request.agent(app);
  await sales.post("/api/auth/login").send({email:"sales@guestra.com",password:"sales123"}).expect(200);
  const before=await db.select().from(s.guests);
  const denied=await sales.post("/api/integrations/agent/messages/inbound").set("x-crm-api-key",key)
    .send({...scope,externalUserId:"should-not-exist",externalChatId:"bad",externalMessageId:"bad",text:"bad"}).expect(403);
  expect(denied.body.code).toBe("MOCK_MODE_WRITE_DENIED");
  expect((await db.select().from(s.guests)).length).toBe(before.length);
  await sales.get("/api/crm/bootstrap").expect(403);
 });
 it("excludes staff notes from transcript, LLM context and the durable feed",async()=>{
  await db.insert(s.messages).values({id:"private-cross-note",conversationId,direction:"note",senderType:"employee",text:"PRIVATE STAFF NOTE",sentAt:new Date().toISOString()});
  const transcript=await get("/conversations/"+conversationId+"/messages").query(scope).expect(200);
  expect(JSON.stringify(transcript.body)).not.toContain("PRIVATE STAFF NOTE");
  const context=await getAgentContext(db,conversationId,customerId);
  expect(JSON.stringify(context)).not.toContain("PRIVATE STAFF NOTE");
  expect(await db.select().from(s.messages).where(eq(s.messages.id,"private-cross-note"))).toHaveLength(1);
  const changes=await get("/v2/conversations/"+conversationId+"/changes").query({...scope,after:0}).expect(200);
  expect(JSON.stringify(changes.body)).not.toContain("PRIVATE STAFF NOTE");
 });
 it("tracks delivery and attachment edits without changing the old message id",async()=>{
  const prepared=await post("/messages/outbound/prepare").send({...scope,conversationId,text:"Ответ",idempotencyKey:"changes-one"}).expect(201);
  const before=await get("/v2/conversations/"+conversationId+"/changes").query({...scope,after:0}).expect(200);
  await post("/messages/outbound/result").send({...scope,conversationId,messageId:prepared.body.messageId,idempotencyKey:"changes-one",success:true,
    externalMessageId:"simulator:"+prepared.body.messageId}).expect(200);
  const changed=await get("/v2/conversations/"+conversationId+"/changes").query({...scope,after:before.body.nextCursor}).expect(200);
  expect(changed.body.changes).toEqual(expect.arrayContaining([expect.objectContaining({messageId:prepared.body.messageId,message:expect.objectContaining({deliveryStatus:"sent"})})]));
  await db.insert(s.messageAttachments).values({id:"cross-attachment",messageId:prepared.body.messageId,kind:"audio",externalFileId:"studio-file",processingStatus:"received"});
  const media=await get("/v2/conversations/"+conversationId+"/changes").query({...scope,after:changed.body.nextCursor}).expect(200);
  expect(media.body.changes[0].message.attachments[0].externalFileId).toBe("studio-file");
  await db.delete(s.messages).where(eq(s.messages.id,prepared.body.messageId));
  const deleted=await get("/v2/conversations/"+conversationId+"/changes").query({...scope,after:media.body.nextCursor}).expect(200);
  expect(deleted.body.changes.at(-1).kind).toBe("tombstone");
 });
 it("applies only newer verified PMS facts and preserves human takeover",async()=>{
  const pms=new PmsClient(config);
  await db.update(s.conversations).set({automationMode:"human"}).where(eq(s.conversations.id,conversationId));
  await db.transaction(tx=>projectSnapshot(tx,pms,"les_borovoe",customerId,snapshot(10,"checked_in"),"first"));
  await db.transaction(tx=>projectSnapshot(tx,pms,"les_borovoe",customerId,snapshot(2,"assigned"),"old"));
  const [projection]=await db.select().from(i.integrationProjections).where(eq(i.integrationProjections.customerId,customerId));
  expect(projection.revision).toBe(10);expect(projection.snapshot.status).toBe("checked_in");
  const [conversation]=await db.select().from(s.conversations).where(eq(s.conversations.id,conversationId));
  expect(conversation.automationMode).toBe("human");
 });
 it("audits commercial lifecycle once per changed authoritative state",async()=>{
  const pms=new PmsClient(config),leadId="cross-history-lead",timestamp=new Date().toISOString();
  const [owner]=await db.select().from(s.employees).where(eq(s.employees.organizationId,tenantId)).limit(1);
  await db.insert(s.leads).values({id:leadId,code:"CROSS-HISTORY",guestId:customerId,propertyId:"les_borovoe",source:"simulator",
    stage:"qualified",requestLifecycle:"enquire",ownerId:owner.id,lastActivityAt:timestamp});
  const input={...snapshot(30,"confirmed"),id:"30000000-0000-4000-8000-000000000030",integrationContext:{sourceSystem:"guestra_crm",customerId,requestId:leadId}};
  await db.transaction(tx=>projectSnapshot(tx,pms,"les_borovoe",customerId,input,"history-first"));
  await db.transaction(tx=>projectSnapshot(tx,pms,"les_borovoe",customerId,input,"history-repeat"));
  expect(await db.select().from(s.leadStageHistory).where(eq(s.leadStageHistory.leadId,leadId))).toHaveLength(1);
  await db.transaction(tx=>projectSnapshot(tx,pms,"les_borovoe",customerId,{...input,revision:31,status:"cancelled"},"history-cancel"));
  const history=await db.select().from(s.requestLifecycleHistory).where(eq(s.requestLifecycleHistory.leadId,leadId));
  expect(history.map(row=>row.toStatus)).toEqual(["won","lost"]);
  expect(history.every(row=>row.source==="pms_projection")).toBe(true);
 });
 it("deduplicates durable events, rejects changed replay and retains events during outages",async()=>{
  const event={schemaVersion:"guestra-domain-event-v1",eventId:randomUUID(),sourceSystem:"guestra_pms",propertyId:remoteProperty,tenantId:remoteTenant,
    entityType:"reservation",entityId:"30000000-0000-4000-8000-000000000001",revision:11,eventType:"reservation.checked_out",occurredAt:new Date().toISOString(),
    integrationContext:{sourceSystem:"guestra_crm",customerId}} as const;
  const pms=new PmsClient(config);
  vi.stubGlobal("fetch",vi.fn().mockRejectedValue(new Error("offline")));
  await expect(acceptEvent(db,pms,"les_borovoe",event)).rejects.toMatchObject({code:"PMS_UNAVAILABLE"});
  const [pending]=await db.select().from(i.integrationInbox).where(eq(i.integrationInbox.eventId,event.eventId));
  expect(pending.status).toBe("pending");expect(pending.attempts).toBe(1);
  fakeRemote(snapshot(11,"checked_out"));
  await acceptEvent(db,pms,"les_borovoe",event);
  expect(await acceptEvent(db,pms,"les_borovoe",event)).toMatchObject({duplicate:true});
  await expect(acceptEvent(db,pms,"les_borovoe",{...event,revision:12})).rejects.toMatchObject({code:"EVENT_ID_CONFLICT"});
 });
 it("recovers a remote commit after a lost response without a second reservation or local ledger",async()=>{
  const pms=new PmsClient(config),remote=snapshot(12),key="lost-response-one";
  const operation=await db.transaction(tx=>enqueueOperation(tx,{propertyId:"les_borovoe",customerId,conversationId,kind:"book_accommodation",key,
    payload:{propertyId:remoteProperty,idempotencyKey:key,integrationContext:{sourceSystem:"guestra_crm",customerId}}}));
  let remoteWrites=0,committed=false;
  vi.stubGlobal("fetch",vi.fn(async(url:URL)=>{
    if(url.pathname.endsWith("/capabilities"))return Response.json({contractVersion:"guestra-connect-v2",propertyId:remoteProperty,tenantId:remoteTenant,environment:"test"});
    if(url.pathname.includes("/operations/"))return committed?Response.json({status:"completed",snapshot:remote}):new Response("",{status:404});
    if(url.pathname.endsWith("/book")){remoteWrites++;committed=true;throw new Error("response lost");}
    return Response.json(remote);
  }));
  const reservationsBefore=await db.select().from(s.reservations),paymentsBefore=await db.select().from(s.guestPayments);
  await expect(runOperation(db,pms,"les_borovoe",operation.id)).rejects.toMatchObject({retryable:true});
  const result=await runOperation(db,pms,"les_borovoe",operation.id);
  expect(result.status).toBe("completed");expect(remoteWrites).toBe(1);
  expect(await db.select().from(s.reservations)).toHaveLength(reservationsBefore.length);
  expect(await db.select().from(s.guestPayments)).toHaveLength(paymentsBefore.length);
  expect(await db.select().from(i.integrationOutbox).where(eq(i.integrationOutbox.id,"operation:"+operation.id))).toHaveLength(1);
 });
 it("rejects cross-property callers, wrong environment and local operational fallbacks",async()=>{
  await get("/v2/context").query({...scope,conversationId,propertyId:"les_alakol"}).expect(403);
  await request(app).post("/api/integrations/agent/accommodations/book").set("x-crm-api-key",config.CRM_INTEGRATION_API_KEY)
    .send({...scope,conversationId,offerId:"x"}).expect(409);
  const disabled=createApp(db,{...config,CRM_PMS_INTEGRATION_ENABLED:"false"});
  await request(disabled).get("/api/integrations/agent/v2/context").set("x-crm-api-key",key).query({...scope,conversationId}).expect(503);
 });
});
