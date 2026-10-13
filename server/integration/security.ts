import { createHash, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import type { Request, Response, NextFunction } from "express";
import type { AuthenticatedRequest } from "../auth/middleware.js";
import type { AppConfig } from "../config.js";
import { IntegrationError } from "./contract.js";
export const principalSchema = z.object({
  id:z.string().min(1),keyHash:z.string().regex(/^[a-f0-9]{64}$/),environment:z.enum(["sandbox","production","test"]),
  propertyIds:z.array(z.string().min(1)).min(1),scopes:z.array(z.string().min(1)),revoked:z.boolean().optional(),
  workspaceIds:z.array(z.string().min(1)).optional(),
});
export type IntegrationPrincipal = z.infer<typeof principalSchema>;
export function resolvePrincipal(raw: string | undefined, config: AppConfig) {
  if (!raw || !config.CRM_INTEGRATION_PRINCIPALS) return undefined;
  const hash=createHash("sha256").update(raw).digest("hex");
  const principal=z.array(principalSchema).parse(JSON.parse(config.CRM_INTEGRATION_PRINCIPALS)).find(p=>p.keyHash===hash);
  if(principal && (principal.revoked || principal.environment!==(config.INTEGRATION_ENVIRONMENT ?? "production")))
    throw new IntegrationError("CREDENTIAL_REVOKED_OR_WRONG_ENVIRONMENT",401);
  return principal;
}
export function denyMockSession(request: Request, response: Response, next: NextFunction) {
  if ((request as AuthenticatedRequest).authUser?.dataMode==="mock")
    return response.status(403).json({code:"MOCK_MODE_WRITE_DENIED",error:"Mock account cannot access business integrations"});
  next();
}
export function requireScope(scope:string) {
  return (request:Request,response:Response,next:NextFunction)=>{
    const p=response.locals.integrationPrincipal as IntegrationPrincipal|undefined;
    const property=request.body?.propertyId ?? request.query.propertyId;
    if (!p || !p.scopes.includes(scope) || typeof property!=="string" || !p.propertyIds.includes(property))
      return response.status(403).json({code:"SCOPE_DENIED",error:"Integration scope denied"});
    next();
  };
}
export function equalSecret(raw:string|undefined,secret:string) {
  const a=Buffer.from(raw ?? ""),b=Buffer.from(secret);
  return a.length===b.length && timingSafeEqual(a,b);
}
export function requireTool(response:Response,tool:string) {
  const principal=response.locals.integrationPrincipal as IntegrationPrincipal|undefined;
  if(!principal?.scopes.includes("tool:"+tool))throw new IntegrationError("TOOL_SCOPE_DENIED",403);
}
export function principalRateLimit() {
  const buckets=new Map<string,{start:number;count:number}>();
  return (_request:Request,response:Response,next:NextFunction)=>{
    const principal=response.locals.integrationPrincipal as IntegrationPrincipal|undefined;
    if(!principal)return next();
    const now=Date.now(),existing=buckets.get(principal.id);
    const bucket=!existing||now-existing.start>=60000?{start:now,count:0}:existing;
    if(buckets.size>1000)for(const [id,value] of buckets)if(now-value.start>=60000)buckets.delete(id);
    bucket.count++;buckets.set(principal.id,bucket);
    if(bucket.count>120) {
      response.setHeader("Retry-After",Math.max(1,Math.ceil((bucket.start+60000-now)/1000)));
      return response.status(429).json({code:"RATE_LIMITED",retryable:true});
    }
    next();
  };
}
