import type { AppConfig } from "../config.js";
import { z } from "zod";
import { IntegrationError } from "./contract.js";
import {createHmac} from "node:crypto";
const mappings=z.array(z.object({crmPropertyId:z.string().min(1),crmTenantId:z.string().min(1),
  pmsPropertyId:z.string().uuid(),pmsTenantId:z.string().min(1),environment:z.enum(["test","sandbox","production"])}));
export class PmsClient {
  constructor(readonly config:AppConfig) {}
  mapping(propertyId:string) {
    const mapping=mappings.parse(JSON.parse(this.config.PMS_PROPERTY_MAPPINGS ?? "[]")).find(m=>m.crmPropertyId===propertyId);
    if(!mapping || mapping.environment!==(this.config.INTEGRATION_ENVIRONMENT ?? "production"))
      throw new IntegrationError("VERIFIED_PROPERTY_MAPPING_REQUIRED",403);
    return mapping;
  }
  /** The PMS integration key of this property (keys are issued per property), else the shared key. */
  keyFor(propertyId:string) {
    let keys:Record<string,unknown>={};
    try {keys=JSON.parse(this.config.PMS_CONNECT_KEYS ?? "{}") as Record<string,unknown>;} catch {throw new IntegrationError("PMS_NOT_CONFIGURED",503,true);}
    const own=keys[propertyId];
    return typeof own==="string"&&own.length>=16?own:this.config.PMS_CONNECT_KEY;
  }
  async call(propertyId:string,path:string,method="GET",body?:unknown,query:Record<string,string>={}) {
    const mapping=this.mapping(propertyId);
    const key=this.keyFor(propertyId);
    if(!this.config.PMS_CONNECT_URL || !key) throw new IntegrationError("PMS_NOT_CONFIGURED",503,true);
    const url=new URL(this.config.PMS_CONNECT_URL.replace(/\/$/,"")+"/"+path.replace(/^\//,""));
    if(url.username||url.password || (url.protocol!=="https:" && !(this.config.INTEGRATION_ENVIRONMENT==="test" &&
        url.protocol==="http:" && ["localhost","127.0.0.1","[::1]"].includes(url.hostname))))
      throw new IntegrationError("UNSAFE_PMS_URL",503);
    if(method==="GET") for(const [k,v] of Object.entries({propertyId:mapping.pmsPropertyId,...query})) url.searchParams.set(k,v);
    const serialized=body!==undefined?JSON.stringify(body):undefined;
    const headers:Record<string,string>={"Content-Type":"application/json","x-api-key":key};
    if(method!=="GET"&&this.config.PMS_COMMAND_SECRET) {
      const timestamp=String(Math.floor(Date.now()/1000));headers["x-guestra-command-time"]=timestamp;
      headers["x-guestra-command-signature"]=createHmac("sha256",this.config.PMS_COMMAND_SECRET)
        .update(timestamp+"."+method+"."+url.pathname+"."+(serialized??"")).digest("hex");
    }
    let response:Response;
    try { response=await fetch(url,{method,headers,
      ...(serialized!==undefined ? {body:serialized}:{}),signal:AbortSignal.timeout(10000),redirect:"error"}); }
    catch {throw new IntegrationError("PMS_UNAVAILABLE",503,true);}
    if(!response.ok) {
      // Remote prepayment answers carry their own stable codes; the agent and the manager act on them.
      const payload=await response.clone().json().catch(()=>undefined) as {code?:unknown;message?:unknown}|undefined;
      const own=[payload?.code,(payload?.message as {code?:unknown}|undefined)?.code].find(value=>typeof value==="string"&&/^REMOTE_PAYMENT_[A-Z_]+$/.test(value)) as string|undefined;
      if(own)throw new IntegrationError(own,response.status>=500||response.status===429?503:response.status===404?404:409,own==="REMOTE_PAYMENT_PROVIDER_UNCERTAIN"||own==="REMOTE_PAYMENT_PROVIDER_LIMIT");
      if(response.status===404) throw new IntegrationError("PMS_REFERENCE_NOT_FOUND",404);
      let code="PMS_OPERATION_REJECTED";
      try {const payload=await response.json();const text=JSON.stringify(payload);
        for(const known of ["PRICE_CHANGED","QUOTE_EXPIRED","IDEMPOTENCY_CONFLICT","IDENTITY_CONFLICT","REVISION_CONFLICT","SCOPE_DENIED",
          "INTEGRATION_DISABLED","INTEGRATION_DATABASE_NOT_ATTESTED","V2_REQUIRES_SCOPED_PRINCIPAL","PROPERTY_SCOPE_REQUIRED","ENVIRONMENT_NOT_CONFIGURED","BUSINESS_WRITES_DISABLED","TRUSTED_CRM_COMMAND_REQUIRED",
          "PREPAYMENT_TERMS_CHANGED","REMOTE_PREPAYMENT_TERMS_CHANGED","REMOTE_PREPAYMENT_OPTION_UNAVAILABLE","REMOTE_PREPAYMENT_WHOLE_TENGE_REQUIRED",
          "REMOTE_PREPAYMENT_ALREADY_SETTLED","REMOTE_PREPAYMENT_INVOICE_NOT_PAYABLE","REMOTE_PREPAYMENT_REQUIRES_PROVIDER_READBACK"])
          if(text.includes(known))code=known;
      }catch { /* HTTP status remains authoritative. */ }
      if(code==="PMS_OPERATION_REJECTED"&&response.status===401)code="AUTH_REQUIRED";
      throw new IntegrationError(code,response.status>=500||response.status===429?503:409,response.status>=500||response.status===429);
    }
    return await response.json() as Record<string,unknown>;
  }
  async attest(propertyId:string,crmTenantId:string) {
    const mapping=this.mapping(propertyId);
    if(mapping.crmTenantId!==crmTenantId) throw new IntegrationError("TENANT_MAPPING_MISMATCH",403);
    const result=await this.call(propertyId,"v2/capabilities");
    if(result.contractVersion!=="guestra-connect-v2" || result.propertyId!==mapping.pmsPropertyId ||
        result.tenantId!==mapping.pmsTenantId || result.environment!==mapping.environment)
      throw new IntegrationError("PMS_ATTESTATION_FAILED",403);
    return mapping;
  }
}
