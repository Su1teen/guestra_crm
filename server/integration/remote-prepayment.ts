import {and,eq} from "drizzle-orm";
import type {Database} from "../db/client.js";
import * as s from "../db/schema.js";
import * as i from "./schema.js";
import type {PmsClient} from "./pms-client.js";
import {IntegrationError} from "./contract.js";

type Db=Pick<Database,"select"|"insert"|"update">;
/** Mapping kind that remembers a Kaspi invoice was sent from CRM for a request (lead). */
export const REMOTE_PAYMENT_MAPPING="remote_payment_request";

/** The PMS stay booked for this request, as verified by the PMS projection. */
export async function pmsReservationOfLead(db:Pick<Database,"select">,propertyId:string,leadId:string) {
  const [mapping]=await db.select().from(i.integrationMappings).where(and(eq(i.integrationMappings.propertyId,propertyId),
    eq(i.integrationMappings.sourceSystem,"guestra_pms"),eq(i.integrationMappings.localType,"request"),
    eq(i.integrationMappings.localId,leadId),eq(i.integrationMappings.remoteType,"reservation"))).limit(1);
  return mapping?.remoteId ?? null;
}

/** Phone for the invoice: the one given, else the WhatsApp number of the chat, else the guest card. */
export function invoicePhone(input:{phone?:string|null;channel?:string|null;externalUserId?:string|null;customerPhone?:string|null}) {
  const candidates=[input.phone,input.channel==="whatsapp"?input.externalUserId:null,input.customerPhone];
  return candidates.map(value=>value?.trim()).find(value=>value && /\d{10,}/.test(value.replace(/\D/g,""))) ?? null;
}

export interface RemotePrepaymentView {
  requestId:string;reservationId:string;status:string;amount:string;currencyCode:string;phone:string;mode:"test"|"live";
  payUrl:string|null;optionUntil?:string|null;providerExpiresAt:string|null;paidAt:string|null;errorCode:string|null;reviewReason:string|null;
  source:string;createdAt:string;
}

/**
 * Asks PMS to send the guest a Kaspi invoice for the stay's prepayment. PMS decides the amount and owns the money;
 * CRM only remembers that the invoice went out from this request, so the guest gets one confirmation when paid.
 */
export async function sendRemotePrepayment(db:Db,pms:PmsClient,input:{propertyId:string;leadId:string;customerId:string;
  conversationId?:string|null;phone:string;source:"agent"|"staff";requestedBy?:string;expectedAmount?:string}) {
  const reservationId=await pmsReservationOfLead(db,input.propertyId,input.leadId);
  if(!reservationId)throw new IntegrationError("RESERVATION_NOT_FOUND",404);
  const remote=pms.mapping(input.propertyId);
  const result=await pms.call(input.propertyId,`v2/reservations/${encodeURIComponent(reservationId)}/remote-prepayment`,"POST",{
    propertyId:remote.pmsPropertyId,customerId:input.customerId,phone:input.phone,source:input.source,
    ...(input.conversationId?{conversationId:input.conversationId}:{}),...(input.requestedBy?{requestedBy:input.requestedBy}:{}),
    ...(input.expectedAmount?{expectedAmount:input.expectedAmount}:{}),
  }) as unknown as RemotePrepaymentView;
  const [property]=await db.select({organizationId:s.properties.organizationId}).from(s.properties).where(eq(s.properties.id,input.propertyId)).limit(1);
  const timestamp=new Date().toISOString();
  await db.insert(i.integrationMappings).values({id:"remote_payment_"+result.requestId,propertyId:input.propertyId,tenantId:property?.organizationId??"",
    sourceSystem:"guestra_pms",localType:"request",localId:input.leadId,remotePropertyId:remote.pmsPropertyId,remoteType:REMOTE_PAYMENT_MAPPING,
    remoteId:result.requestId,verifiedAt:timestamp,evidence:{reservationId,conversationId:input.conversationId??null,amount:result.amount,source:input.source}})
    .onConflictDoUpdate({target:[i.integrationMappings.propertyId,i.integrationMappings.sourceSystem,i.integrationMappings.localType,
      i.integrationMappings.localId,i.integrationMappings.remoteType],
    set:{remoteId:result.requestId,verifiedAt:timestamp,evidence:{reservationId,conversationId:input.conversationId??null,amount:result.amount,source:input.source}}});
  return {...result,reservationId};
}

/** Kaspi invoices of the request's PMS stay (newest first), read from PMS. */
export async function readRemotePrepayments(db:Pick<Database,"select">,pms:PmsClient,input:{propertyId:string;leadId:string;customerId:string}) {
  const reservationId=await pmsReservationOfLead(db,input.propertyId,input.leadId);
  if(!reservationId)return {reservationId:null,enabled:false,mode:null,requests:[] as RemotePrepaymentView[]};
  const read=await pms.call(input.propertyId,`v2/reservations/${encodeURIComponent(reservationId)}/remote-prepayment`,"GET",undefined,
    {customerId:input.customerId}) as {enabled?:boolean;mode?:string|null;requests?:RemotePrepaymentView[]};
  return {reservationId,enabled:read.enabled===true,mode:read.mode??null,requests:Array.isArray(read.requests)?read.requests:[]};
}

/** Guest-facing text that carries the invoice: amount, deadline, link. */
export function remotePrepaymentText(view:RemotePrepaymentView,propertyName:string|null|undefined,timezone?:string|null) {
  const amount=Number(view.amount).toLocaleString("ru-RU");
  const deadline=view.optionUntil?new Intl.DateTimeFormat("ru-RU",{timeZone:timezone??"Asia/Almaty",day:"numeric",month:"long",hour:"2-digit",minute:"2-digit"})
    .format(new Date(view.optionUntil)):null;
  return [`Для подтверждения бронирования в ${propertyName??"нашем отеле"} просим внести предоплату ${amount} ₸.`,
    `Счёт отправлен в приложение Kaspi на номер ${view.phone}.`,
    deadline?`Оплатите, пожалуйста, до ${deadline}.`:null,
    view.payUrl?`Ссылка на оплату: ${view.payUrl}`:null].filter(Boolean).join("\n");
}

/** Whether CRM sent a Kaspi invoice for this request (then the paid confirmation goes to the chat). */
export async function remotePrepaymentSent(db:Pick<Database,"select">,propertyId:string,leadId:string) {
  const [row]=await db.select({id:i.integrationMappings.id}).from(i.integrationMappings).where(and(eq(i.integrationMappings.propertyId,propertyId),
    eq(i.integrationMappings.sourceSystem,"guestra_pms"),eq(i.integrationMappings.localType,"request"),eq(i.integrationMappings.localId,leadId),
    eq(i.integrationMappings.remoteType,REMOTE_PAYMENT_MAPPING))).limit(1);
  return !!row;
}
