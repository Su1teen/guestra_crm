import { createHash } from "node:crypto";
import { and, eq, or } from "drizzle-orm";
import type { Database } from "../db/client.js";
import * as s from "../db/schema.js";

type DbLike = Pick<Database, "select" | "insert" | "update">;

export const normalizePhone = (value: string | null | undefined) => {
  const digits = (value ?? "").replace(/\D/g, "");
  return (digits.length === 11 && digits.startsWith("8") ? `7${digits.slice(1)}` : digits) || null;
};
export const normalizeEmail = (value: string | null | undefined) => value?.trim().toLowerCase() || null;

/** Exact external ID wins. Contact matches are candidates, never silent merges. */
export const findCustomerCandidates = async (
  db: DbLike,
  organizationId: string,
  input: { channel?: string; externalUserId?: string; phone?: string; email?: string },
) => {
  if (input.channel && input.externalUserId) {
    const [identity] = await db.select().from(s.guestContactIdentities).where(and(
      eq(s.guestContactIdentities.channel, input.channel),
      eq(s.guestContactIdentities.externalUserId, input.externalUserId),
    )).limit(1);
    if (identity) return { exactCustomerId: identity.guestId, candidates: [identity.guestId] };
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
  input: { channel: string; externalUserId: string; propertyId: string; firstName?: string | null; externalChatId?: string | null; username?: string | null },
) => {
  const [property] = await db.select().from(s.properties).where(eq(s.properties.id, input.propertyId)).limit(1);
  if (!property) throw new Error("Объект размещения не найден");
  const found = await findCustomerCandidates(db, property.organizationId, input);
  if (found.exactCustomerId) {
    const [matched] = await db.select().from(s.guests).where(eq(s.guests.id, found.exactCustomerId)).limit(1);
    if (!matched || matched.organizationId !== property.organizationId) throw new Error("Контакт принадлежит другой организации");
    await db.insert(s.guestProperties).values({ guestId: found.exactCustomerId, propertyId: input.propertyId }).onConflictDoNothing();
    return { customerId: found.exactCustomerId, created: false };
  }
  const hash = createHash("sha256").update(`${input.channel}\0${input.externalUserId}`).digest("hex").slice(0, 32);
  const customerId = `customer_${hash}`;
  await db.insert(s.guests).values({
    id: customerId, organizationId: property.organizationId,
    firstName: input.firstName?.trim() || null,
    fullName: input.firstName?.trim() || `Контакт ${input.channel} ${input.externalUserId}`,
    preferredPropertyId: input.propertyId, preferredChannel: input.channel,
    profileStatus: input.firstName?.trim() ? "active" : "stub",
  }).onConflictDoNothing();
  await db.insert(s.guestContactIdentities).values({
    id: `identity_${hash}`, guestId: customerId, channel: input.channel,
    externalUserId: input.externalUserId, externalChatId: input.externalChatId ?? null,
    username: input.username ?? null,
  }).onConflictDoNothing();
  const [identity] = await db.select().from(s.guestContactIdentities).where(and(
    eq(s.guestContactIdentities.channel, input.channel),
    eq(s.guestContactIdentities.externalUserId, input.externalUserId),
  )).limit(1);
  if (!identity) throw new Error("Не удалось сохранить контакт");
  await db.insert(s.guestProperties).values({ guestId: identity.guestId, propertyId: input.propertyId }).onConflictDoNothing();
  return { customerId: identity.guestId, created: identity.guestId === customerId };
};
