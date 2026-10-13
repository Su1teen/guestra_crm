import {and,eq} from "drizzle-orm";
import type {Database} from "../db/client.js";
import {getAgentContext} from "../services/agent-context-service.js";
import {integrationProjections} from "./schema.js";

/** Commercial context stays local; operational facts come only from verified PMS reads. */
export async function getIntegratedContext(db:Pick<Database,"select">,conversationId:string,customerId:string) {
  const context=await getAgentContext(db,conversationId,customerId);
  if(!context)return null;
  const rows=await db.select().from(integrationProjections).where(and(eq(integrationProjections.propertyId,context.property.id),
    eq(integrationProjections.customerId,customerId)));
  const reservations=rows.filter(row=>row.entityType==="reservation").map(row=>row.snapshot);
  const active=reservations.filter(row=>["confirmed","assigned","checked_in","stayover","due_out","pending"].includes(String(row.status)));
  active.sort((a,b)=>Number(["checked_in","stayover","due_out"].includes(String(b.status)))-Number(["checked_in","stayover","due_out"].includes(String(a.status)))||
    String(a.checkIn).localeCompare(String(b.checkIn)));
  const current=active[0];
  const parts=new Intl.DateTimeFormat("en-CA",{timeZone:context.property.timezone,year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(new Date());
  const today=["year","month","day"].map(type=>parts.find(part=>part.type===type)!.value).join("-");
  let lifecycle:string=context.lifecycle;
  if(current) {
    lifecycle=current.status==="pending"?"pending_payment":["checked_in","stayover","due_out"].includes(String(current.status))?(String(current.checkOut)<=today?"due_out":"in_house"):
      String(current.checkIn)>today?"pre_arrival":"reserved";
  } else if(rows.some(row=>row.entityType==="service_booking"&&row.snapshot.status==="scheduled"))lifecycle="service_only";
  else if(reservations.some(row=>row.status==="checked_out"))lifecycle="post_stay";
  else if(reservations.length&&reservations.every(row=>["cancelled","no_show"].includes(String(row.status))))lifecycle="cancelled";
  // Confirmed reservations do not imply paid money.
  const actions=context.aiReplyAllowed?context.allowedActions.filter(action=>![
    "book_accommodation","book_service","reschedule_service","cancel_service","get_stay_context","get_folio_summary",
    "check_stay_extension","extend_stay","get_accommodation_options","check_accommodation_availability","create_offer","get_service_options","check_service_availability",
  ].includes(action)):[];
  if(context.aiReplyAllowed)actions.push("book_service");
  return {...context,lifecycle,operationalAuthority:"guestra_pms",reservation:null,stay:null,folio:null,paymentRequest:null,serviceReservations:[],
    allowedActions:[...actions,...(context.aiReplyAllowed?["search_accommodation","create_pms_offer","book_accommodation",
      ...(current?["amend_accommodation","cancel_accommodation"]:[]),
      ...(rows.some(row=>row.entityType==="service_booking"&&row.snapshot.status==="scheduled")?["reschedule_service","cancel_service"]:[])]:[])],
    pmsReferences:rows.map(row=>({type:row.entityType,id:row.entityId,revision:row.revision,snapshot:row.snapshot,verifiedAt:row.verifiedAt})),
    synchronization:{source:"authoritative_readback",mayBeStale:true},
  };
}
