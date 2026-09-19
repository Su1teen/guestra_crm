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

const loginSchema = z.object({ email: z.string().email(), password: z.string().min(1) });
const publicUser = (user: typeof appUsers.$inferSelect) => ({
  id: user.id,
  email: user.email,
  role: user.role,
  dataMode: user.dataMode,
  employeeId: user.employeeId ?? "emp_sultan",
  name: user.name,
});

export const createAuthRouter = (db: Database, config: AppConfig) => {
  const router = Router();
  router.post("/login", async (request, response) => {
    const parsed = loginSchema.safeParse(request.body);
    if (!parsed.success) return response.status(400).json({ error: "Некорректный email или пароль" });
    const [user] = await db.select().from(appUsers).where(eq(appUsers.email, parsed.data.email.toLowerCase())).limit(1);
    if (!user || !(await compare(parsed.data.password, user.passwordHash))) {
      return response.status(401).json({ error: "Неверный email или пароль" });
    }
    setSessionCookie(response, createSessionToken(user.id, config.SESSION_SECRET), config.NODE_ENV === "production");
    return response.json(publicUser(user));
  });
  router.get("/me", requireAuth, (request: AuthenticatedRequest, response) => response.json(publicUser(request.authUser!)));
  router.post("/logout", (_request, response) => {
    clearSessionCookie(response, config.NODE_ENV === "production");
    response.status(204).end();
  });
  return router;
};

