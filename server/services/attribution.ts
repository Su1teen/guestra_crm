import { and, eq, isNull } from "drizzle-orm";
import type { Database } from "../db/client.js";
import * as s from "../db/schema.js";

type Executor = Pick<Database, "select" | "update">;

/**
 * Fixes who closed a won request, once. The closer is the person who made it won (a manual status
 * change or a recorded payment), otherwise the manager who owns the chat at that moment. With no
 * person involved the sale is "completed via Guestra": no commission manager.
 * Later chat transfers never move this attribution.
 */
export const recordLeadClosed = async (tx: Executor, leadId: string, actorEmployeeId: string | null | undefined, at = new Date().toISOString()) => {
  const [lead] = await tx.select({ id: s.leads.id, closingEmployeeId: s.leads.closingEmployeeId, closedVia: s.leads.closedVia })
    .from(s.leads).where(eq(s.leads.id, leadId)).limit(1);
  if (!lead || lead.closedVia) return;
  let closer = actorEmployeeId ?? null;
  if (!closer) {
    const [conversation] = await tx.select({ assigneeId: s.conversations.assigneeId }).from(s.conversations)
      .where(eq(s.conversations.leadId, leadId)).limit(1);
    closer = conversation?.assigneeId ?? null;
  }
  await tx.update(s.leads).set({ closingEmployeeId: closer, commissionEmployeeId: closer, closedAt: at,
    closedVia: closer ? "manager" : "guestra" }).where(and(eq(s.leads.id, leadId), isNull(s.leads.closedVia)));
};
