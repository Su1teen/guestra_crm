import { createHash } from "node:crypto";
import { and, eq, or } from "drizzle-orm";
import type { Database } from "../db/client.js";
import * as s from "../db/schema.js";

type DbLike = Pick<Database, "select" | "insert" | "update">;

/** Property-scoped storage keys retain the original external id at API boundaries. */
export const scopedExternalIdentityKey = (propertyId:string, externalUserId:string) =>
  "guestra:v2:"+Buffer.from(JSON.stringify([propertyId,externalUserId])).toString("base64url");
export const displayExternalIdentityId = (stored:string) => {
  if(!stored.startsWith("guestra:v2:"))return stored;
  try {return (JSON.parse(Buffer.from(stored.slice(11),"base64url").toString("utf8")) as string[])[1] ?? stored;}catch{return stored;}
};
export const findExternalIdentity = async (db:Pick<Database,"select">,channel:string,propertyId:string,externalUserId:string) => {
  const [scoped]=await db.select().from(s.guestContactIdentities).where(and(eq(s.guestContactIdentities.channel,channel),
    eq(s.guestContactIdentities.externalUserId,scopedExternalIdentityKey(propertyId,externalUserId)))).limit(1);
  if(scoped)return scoped;
  // Old rows remain usable only through their pre-existing property membership.
  const [legacy]=await db.select().from(s.guestContactIdentities)
    .where(and(eq(s.guestContactIdentities.channel,channel),eq(s.guestContactIdentities.externalUserId,externalUserId))).limit(1);
  if(!legacy)return undefined;
  const [membership]=await db.select().from(s.guestProperties).where(and(eq(s.guestProperties.guestId,legacy.guestId),eq(s.guestProperties.propertyId,propertyId))).limit(1);
  if(membership)return legacy;
  // Existing participant/staff-created conversations are also scoped evidence.
  const [conversation]=await db.select({id:s.conversations.id}).from(s.conversations).where(and(eq(s.conversations.guestId,legacy.guestId),eq(s.conversations.propertyId,propertyId),eq(s.conversations.channel,channel))).limit(1);
  if(conversation)return legacy;
  const [booker]=await db.select({id:s.reservations.id}).from(s.reservations).where(and(
    eq(s.reservations.bookerCustomerId,legacy.guestId),eq(s.reservations.propertyId,propertyId))).limit(1);
  if(booker)return legacy;
  const [participant]=await db.select({id:s.reservationGuests.id}).from(s.reservationGuests)
    .innerJoin(s.reservations,eq(s.reservations.id,s.reservationGuests.reservationId)).where(and(
      eq(s.reservationGuests.customerId,legacy.guestId),eq(s.reservations.propertyId,propertyId))).limit(1);
  return participant?legacy:undefined;
};

export const normalizePhone = (value: string | null | undefined) => {
  const digits = (value ?? "").replace(/\D/g, "");
  return (digits.length === 11 && digits.startsWith("8") ? `7${digits.slice(1)}` : digits) || null;
};
export const normalizeEmail = (value: string | null | undefined) => value?.trim().toLowerCase() || null;

/** Exact external ID wins. Contact matches are candidates, never silent merges. */
export const findCustomerCandidates = async (
  db: DbLike,
  organizationId: string,
  input: { channel?: string; externalUserId?: string; propertyId?: string; phone?: string; email?: string },
) => {
  if (input.channel && input.externalUserId) {
    const [unscoped] = input.propertyId ? [] : await db.select().from(s.guestContactIdentities).where(and(
      eq(s.guestContactIdentities.channel, input.channel),
      eq(s.guestContactIdentities.externalUserId, input.externalUserId),
    )).limit(1);
    const identity = input.propertyId ? await findExternalIdentity(db,input.channel,input.propertyId,input.externalUserId) : unscoped;
    if (identity) {
      const [customer] = await db.select().from(s.guests).where(and(eq(s.guests.id,identity.guestId),eq(s.guests.organizationId,organizationId))).limit(1);
      if (customer) return { exactCustomerId: customer.id, candidates: [customer.id] };
    }
  }
  const phone = normalizePhone(input.phone);
  const email = normalizeEmail(input.email);
  const matches = phone && email
    ? await db.select({ id: s.guests.id }).from(s.guests).where(and(eq(s.guests.organizationId, organizationId), or(eq(s.guests.normalizedPhone, phone), eq(s.guests.normalizedEmail, email))))
    : phone
      ? await db.select({ id: s.guests.id }).from(s.guests).where(and(eq(s.guests.organizationId, organizationId), eq(s.guests.normalizedPhone, phone)))
      : email
        ? await db.select({ id: s.guests.id }).from(s.guests).where(and(eq(s.guests.organizationId, organizationId), eq(s.guests.normalizedEmail, email)))
        : [];
  return { exactCustomerId: null, candidates: [...new Set(matches.map((row) => row.id))] };
};

/** Stable ID plus identity unique key makes retries safe without merging people. */
export const resolveOrCreateExternalCustomer = async (
  db: DbLike,
  input: { channel: string; externalUserId: string; propertyId: string; firstName?: string | null;
    lastName?: string | null; displayName?: string | null; language?: string | null;
    externalChatId?: string | null; username?: string | null; createAsStub?: boolean },
) => {
  const [property] = await db.select().from(s.properties).where(eq(s.properties.id, input.propertyId)).limit(1);
  if (!property) throw new Error("Объект размещения не найден");
  const found = await findCustomerCandidates(db, property.organizationId, input);
  if (found.exactCustomerId) {
    const [matched] = await db.select().from(s.guests).where(eq(s.guests.id, found.exactCustomerId)).limit(1);
    if (!matched || matched.organizationId !== property.organizationId) throw new Error("Контакт принадлежит другой организации");
    await db.insert(s.guestProperties).values({ guestId: found.exactCustomerId, propertyId: input.propertyId }).onConflictDoNothing();
    if (input.username) {
      const identity=await findExternalIdentity(db,input.channel,input.propertyId,input.externalUserId);
      await db.update(s.guestContactIdentities).set({ username: input.username, updatedAt: new Date().toISOString() })
        .where(and(eq(s.guestContactIdentities.channel, input.channel),
          eq(s.guestContactIdentities.id, identity!.id)));
    }
    return { customerId: found.exactCustomerId, created: false };
  }
  const storedExternalId = scopedExternalIdentityKey(input.propertyId,input.externalUserId);
  const hash = createHash("sha256").update(`${property.organizationId}\0${input.channel}\0${storedExternalId}`).digest("hex").slice(0, 32);
  const customerId = `customer_${hash}`;
  const displayName = input.displayName?.trim() ||
    [input.firstName?.trim(), input.lastName?.trim()].filter(Boolean).join(" ") || null;
  await db.insert(s.guests).values({
    id: customerId, organizationId: property.organizationId,
    firstName: input.firstName?.trim() || null, lastName: input.lastName?.trim() || null,
    fullName: displayName || `Контакт ${input.channel} ${input.externalUserId}`,
    preferredPropertyId: input.propertyId, preferredChannel: input.channel,
    ...(input.language?.trim() ? { language: input.language.trim() } : {}),
    profileStatus: input.createAsStub ? "stub" : displayName ? "active" : "stub",
  }).onConflictDoNothing();
  await db.insert(s.guestContactIdentities).values({
    id: `identity_${hash}`, guestId: customerId, channel: input.channel,
    externalUserId: storedExternalId, externalChatId: input.externalChatId ?? null,
    username: input.username ?? null,
  }).onConflictDoNothing();
  const [identity] = await db.select().from(s.guestContactIdentities).where(and(
    eq(s.guestContactIdentities.channel, input.channel),
    eq(s.guestContactIdentities.externalUserId, storedExternalId),
  )).limit(1);
  if (!identity) throw new Error("Не удалось сохранить контакт");
  await db.insert(s.guestProperties).values({ guestId: identity.guestId, propertyId: input.propertyId }).onConflictDoNothing();
  return { customerId: identity.guestId, created: identity.guestId === customerId };
};
