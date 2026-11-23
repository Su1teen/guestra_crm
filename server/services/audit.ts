import { randomUUID } from "node:crypto";
import type { Database } from "../db/client.js";
import * as s from "../db/schema.js";
import type { Access } from "../auth/access.js";

type Executor = Pick<Database, "insert">;

/** One line of "who changed what" for statuses, assignees, availability, accounts and settings. */
export const audit = async (db: Executor, access: Pick<Access, "userId" | "employeeId"> | null, event: {
  propertyId?: string | null; entityType: string; entityId: string; action: string; details?: Record<string, unknown>;
}) => {
  await db.insert(s.staffAuditEvents).values({ id: `audit_${randomUUID()}`, actorUserId: access?.userId ?? null,
    actorEmployeeId: access?.employeeId ?? null, propertyId: event.propertyId ?? null, entityType: event.entityType,
    entityId: event.entityId, action: event.action, details: event.details ?? {} });
};
