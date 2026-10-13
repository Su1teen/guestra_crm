import {createHmac,timingSafeEqual} from "node:crypto";
import {Router} from "express";
import {and,eq,inArray,notInArray} from "drizzle-orm";
import {z} from "zod";
import type {Database} from "../db/client.js";
import type {AppConfig} from "../config.js";
import * as s from "../db/schema.js";
import {IntegrationError} from "./contract.js";
import {requireScope,type IntegrationPrincipal} from "./security.js";
import type {identity} from "./router.js";
const supported=["image/jpeg","image/png","image/webp","application/pdf","application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "audio/ogg","audio/mpeg","audio/wav","audio/webm","video/mp4","video/webm"] as const;
function validateReference(config:AppConfig,url:string,expiresAt:string) {
  const parsed=new URL(url),origins=z.array(z.string().url()).parse(JSON.parse(config.MEDIA_ALLOWED_ORIGINS??"[]"));
  if(parsed.username||parsed.password||!origins.includes(parsed.origin)||
    (parsed.protocol!=="https:"&&!(config.INTEGRATION_ENVIRONMENT==="test"&&parsed.protocol==="http:"&&["127.0.0.1","localhost","[::1]"].includes(parsed.hostname))))
    throw new IntegrationError("MEDIA_ORIGIN_DENIED",403);
  const ttl=Date.parse(expiresAt)-Date.now();
  if(!Number.isFinite(ttl)||ttl<=0||ttl>300000)throw new IntegrationError("MEDIA_REFERENCE_EXPIRED");
}
export function registerV2Media(router:Router,db:Database,config:AppConfig,resolve:typeof identity) {
  const scopeFields={propertyId:z.string().min(1),channel:z.enum(["simulator","telegram","whatsapp","instagram"]),
    externalUserId:z.string().min(1),conversationId:z.string().min(1)};
  router.post("/v2/media/:id/reference",requireScope("media.write"),async(request,response)=>{
    const input=z.object({...scopeFields,workspaceId:z.string().min(1).max(160),referenceUrl:z.string().url().max(4000),
      expiresAt:z.string().datetime(),mimeType:z.enum(supported),fileSize:z.number().int().positive().max(20*1024*1024),
      scanStatus:z.literal("clean"),callId:z.string().max(160).optional()}).parse(request.body);
    const principal=response.locals.integrationPrincipal as IntegrationPrincipal;
    if(!principal.workspaceIds?.includes(input.workspaceId))throw new IntegrationError("WORKSPACE_SCOPE_DENIED",403);
    await resolve(db,input);validateReference(config,input.referenceUrl,input.expiresAt);
    const [row]=await db.select({attachment:s.messageAttachments}).from(s.messageAttachments)
      .innerJoin(s.messages,eq(s.messages.id,s.messageAttachments.messageId))
      .where(and(eq(s.messageAttachments.id,String(request.params.id)),eq(s.messages.conversationId,input.conversationId),
        inArray(s.messages.direction,["in","out"]),notInArray(s.messages.senderType,["note","internal"]))).limit(1);
    if(!row)throw new IntegrationError("ATTACHMENT_NOT_FOUND",404);
    if(row.attachment.mimeType&&row.attachment.mimeType!==input.mimeType)throw new IntegrationError("MEDIA_METADATA_CONFLICT");
    await db.update(s.messageAttachments).set({mimeType:input.mimeType,fileSize:input.fileSize,
      metadata:{...row.attachment.metadata,workspaceId:input.workspaceId,referenceUrl:input.referenceUrl,
        referenceExpiresAt:input.expiresAt,scanStatus:input.scanStatus,scanAttestedBy:principal.id,...(input.callId?{callId:input.callId}:{})},
      updatedAt:new Date().toISOString()}).where(eq(s.messageAttachments.id,row.attachment.id));
    response.json({mediaReferenceId:row.attachment.id,expiresAt:input.expiresAt,workspaceId:input.workspaceId});
  });
  router.get("/v2/media/:id/url",requireScope("media.read"),async(request,response)=>{
    const input=z.object(scopeFields).parse(request.query);const scope=await resolve(db,input);
    const [row]=await db.select({attachment:s.messageAttachments}).from(s.messageAttachments)
      .innerJoin(s.messages,eq(s.messages.id,s.messageAttachments.messageId))
      .where(and(eq(s.messageAttachments.id,String(request.params.id)),eq(s.messages.conversationId,input.conversationId),
        inArray(s.messages.direction,["in","out"]),notInArray(s.messages.senderType,["note","internal"]))).limit(1);
    const metadata=row?.attachment.metadata,principal=response.locals.integrationPrincipal as IntegrationPrincipal;
    if(!metadata||typeof metadata.workspaceId!=="string"||!principal.workspaceIds?.includes(metadata.workspaceId)||
      metadata.scanStatus!=="clean"||row?.attachment.processingStatus!=="ready")throw new IntegrationError("MEDIA_NOT_READY_OR_NOT_OWNED");
    if(typeof metadata.referenceUrl!=="string"||typeof metadata.referenceExpiresAt!=="string")throw new IntegrationError("MEDIA_REFERENCE_UNAVAILABLE",503,true);
    validateReference(config,metadata.referenceUrl,metadata.referenceExpiresAt);
    if(!config.MEDIA_REFERENCE_SECRET)throw new IntegrationError("MEDIA_SIGNING_NOT_CONFIGURED",503);
    const claims={propertyId:input.propertyId,conversationId:input.conversationId,customerId:scope.customer.id,attachmentId:row.attachment.id,
      workspaceId:metadata.workspaceId,expiresAt:Math.min(Date.parse(metadata.referenceExpiresAt),Date.now()+60000)};
    const body=Buffer.from(JSON.stringify(claims)).toString("base64url");
    const token=body+"."+createHmac("sha256",config.MEDIA_REFERENCE_SECRET).update(body).digest("base64url");
    response.setHeader("Cache-Control","no-store");
    response.json({mediaReferenceId:row.attachment.id,url:"/api/integrations/media/v1/retrieve?token="+encodeURIComponent(token),expiresAt:new Date(claims.expiresAt).toISOString()});
  });
}
export function createMediaRetrievalRouter(db:Database,config:AppConfig) {
  const router=Router();
  router.get("/v1/retrieve",async(request,response)=>{
    if(config.CRM_PMS_INTEGRATION_ENABLED!=="true"||!config.MEDIA_REFERENCE_SECRET)return response.sendStatus(404);
    const [body,signature,...extra]=z.string().max(4000).parse(request.query.token).split(".");
    const expected=createHmac("sha256",config.MEDIA_REFERENCE_SECRET).update(body??"").digest(),provided=Buffer.from(signature??"","base64url");
    if(extra.length||expected.length!==provided.length||!timingSafeEqual(expected,provided))return response.sendStatus(401);
    let claims;
    try {claims=z.object({propertyId:z.string(),conversationId:z.string(),customerId:z.string(),attachmentId:z.string(),workspaceId:z.string(),
      expiresAt:z.number().int().min(Date.now()).max(Date.now()+60000)}).parse(JSON.parse(Buffer.from(body!,"base64url").toString("utf8")));}
    catch{return response.sendStatus(401);}
    const [row]=await db.select({attachment:s.messageAttachments}).from(s.messageAttachments)
      .innerJoin(s.messages,eq(s.messages.id,s.messageAttachments.messageId)).innerJoin(s.conversations,eq(s.conversations.id,s.messages.conversationId))
      .where(and(eq(s.messageAttachments.id,claims.attachmentId),eq(s.messages.conversationId,claims.conversationId),
        eq(s.conversations.propertyId,claims.propertyId),eq(s.conversations.guestId,claims.customerId),
        inArray(s.messages.direction,["in","out"]),notInArray(s.messages.senderType,["note","internal"]))).limit(1);
    const metadata=row?.attachment.metadata;
    if(!metadata||metadata.workspaceId!==claims.workspaceId||metadata.scanStatus!=="clean"||row?.attachment.processingStatus!=="ready"||
      typeof metadata.referenceUrl!=="string"||typeof metadata.referenceExpiresAt!=="string")return response.sendStatus(404);
    try {validateReference(config,metadata.referenceUrl,metadata.referenceExpiresAt);}catch{return response.sendStatus(410);}
    response.setHeader("Cache-Control","no-store");response.setHeader("Referrer-Policy","no-referrer");
    response.redirect(303,metadata.referenceUrl);
  });
  return router;
}
