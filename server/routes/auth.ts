import { Router } from "express";
import { compare } from "bcryptjs";
import { eq } from "drizzle-orm";
import { z } from "zod";
import type { Database } from "../db/client.js";
import { appUsers } from "../db/schema.js";
import type { AppConfig } from "../config.js";
import type { AuthenticatedRequest } from "../auth/middleware.js";
import { requireAuth } from "../auth/middleware.js";
import { clearSessionCookie, createSessionToken, setSessionCookie } from "../auth/session.js";
import { loadAccess } from "../auth/access.js";
import { ROLE_LABELS } from "../../shared/permissions.js";

const loginSchema = z.object({ email: z.string().email(), password: z.string().min(1) });
const publicUser = (user: typeof appUsers.$inferSelect) => ({
  id: user.id,
  email: user.email,
  role: user.role,
  dataMode: user.dataMode,
  employeeId: user.employeeId ?? "emp_sultan",
  name: user.name,
});

/** Brute-force protection: after 5 failed attempts an email+address pair waits 15 minutes. */
const FAILED_LIMIT = 5;
const LOCK_MS = 15 * 60_000;
const failures = new Map<string, { count: number; until: number }>();

/** Session user plus what the UI needs to hide actions the server would refuse. */
const sessionPayload = async (db: Database, user: typeof appUsers.$inferSelect) => {
  if (user.dataMode !== "database") return { ...publicUser(user), permissions: [], propertyIds: [] };
  const access = await loadAccess(db, user);
  return { ...publicUser(user), role: access.role, roleLabel: ROLE_LABELS[access.role],
    permissions: [...access.permissions], propertyIds: [...access.propertyIds] };
};

export const createAuthRouter = (db: Database, config: AppConfig) => {
  const router = Router();
  router.post("/login", async (request, response) => {
    const parsed = loginSchema.safeParse(request.body);
    if (!parsed.success) return response.status(400).json({ error: "Некорректный email или пароль" });
    const email = parsed.data.email.toLowerCase();
    const key = `${email}|${request.ip}`;
    const failure = failures.get(key);
    if (failure && failure.until > Date.now())
      return response.status(429).json({ error: "Слишком много попыток. Попробуйте через 15 минут" });
    const [user] = await db.select().from(appUsers).where(eq(appUsers.email, email)).limit(1);
    if (!user || user.active === false || !(await compare(parsed.data.password, user.passwordHash))) {
      const count = (failure && failure.until <= Date.now() && failure.until !== 0 ? 0 : failure?.count ?? 0) + 1;
      failures.set(key, { count, until: count >= FAILED_LIMIT ? Date.now() + LOCK_MS : 0 });
      return response.status(401).json({ error: "Неверный email или пароль" });
    }
    failures.delete(key);
    await db.update(appUsers).set({ lastLoginAt: new Date().toISOString() }).where(eq(appUsers.id, user.id));
    setSessionCookie(response, createSessionToken(user.id, config.SESSION_SECRET, Date.now(), user.sessionVersion ?? 1),
      config.NODE_ENV === "production");
    return response.json(await sessionPayload(db, user));
  });
  router.get("/me", requireAuth, async (request: AuthenticatedRequest, response) => response.json(await sessionPayload(db, request.authUser!)));
  router.post("/logout", (_request, response) => {
    clearSessionCookie(response, config.NODE_ENV === "production");
    response.status(204).end();
  });
  return router;
};

