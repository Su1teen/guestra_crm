import {Router} from "express";
import {createHmac,timingSafeEqual} from "node:crypto";
import type {Database} from "../db/client.js";
import type {AppConfig} from "../config.js";
import {PmsClient} from "./pms-client.js";
import {acceptEvent} from "./service.js";
import {IntegrationError} from "./contract.js";
import {integrationDeployment} from "./schema.js";
export function createPmsWebhookRouter(db:Database,config:AppConfig) {
  const router=Router(),pms=new PmsClient(config);
  router.post("/v1/events/:propertyId",async(request,response)=>{
    if(config.CRM_PMS_INTEGRATION_ENABLED!=="true")return response.status(503).json({code:"INTEGRATION_DISABLED"});
    const timestamp=request.header("x-guestra-timestamp"),signature=request.header("x-guestra-signature");
    if(!config.PMS_EVENT_SECRET || !timestamp || !/^\d+$/.test(timestamp) || Math.abs(Date.now()/1000-Number(timestamp))>300)
      return response.status(401).json({code:"INVALID_EVENT_SIGNATURE"});
    const raw=(request as unknown as {rawBody:Buffer}).rawBody;
    const expected=createHmac("sha256",config.PMS_EVENT_SECRET).update(timestamp+".").update(raw).digest();
    const supplied=Buffer.from(signature??"","hex");
    if(expected.length!==supplied.length || !timingSafeEqual(expected,supplied))return response.status(401).json({code:"INVALID_EVENT_SIGNATURE"});
    try {
      const [deployment]=await db.select().from(integrationDeployment).limit(1);
      if(!deployment||deployment.environment!==(config.INTEGRATION_ENVIRONMENT??"production"))
        return response.status(503).json({code:"INTEGRATION_DATABASE_NOT_ATTESTED"});
      const envelope=request.body.data?.integrationEnvelope;
      const result=await acceptEvent(db,pms,String(request.params.propertyId),envelope);
      // Durable receipt acknowledges ingestion even when its projection awaits PMS.
      response.json({received:true,...result});
    }catch(error) {
      if(error instanceof IntegrationError)return response.status(error.retryable?202:error.status).json({received:error.retryable,code:error.code,retryable:error.retryable});
      return response.status(400).json({code:"INVALID_EVENT"});
    }
  });
  return router;
}
