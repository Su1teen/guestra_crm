import type { NextFunction, Request, Response } from "express";
import { eq } from "drizzle-orm";
import type { Database } from "../db/client.js";
import { appUsers } from "../db/schema.js";
import { readCookie, SESSION_COOKIE, verifySession } from "./session.js";
import type { Access } from "./access.js";

export type SessionUser = typeof appUsers.$inferSelect;
export type AuthenticatedRequest = Request & { authUser?: SessionUser; access?: Access };

/** A blocked account or a revoked session (password reset, block) is treated as signed out. */
export const authMiddleware = (db: Database, secret: string) => async (request: AuthenticatedRequest, _response: Response, next: NextFunction) => {
  const session = verifySession(readCookie(request, SESSION_COOKIE), secret);
  if (session) {
    const [user] = await db.select().from(appUsers).where(eq(appUsers.id, session.userId)).limit(1);
    if (user && user.active !== false && (user.sessionVersion ?? 1) === session.sessionVersion) request.authUser = user;
  }
  next();
};

export const requireAuth = (request: AuthenticatedRequest, response: Response, next: NextFunction) => {
  if (!request.authUser) return response.status(401).json({ error: "Требуется авторизация" });
  next();
};

export const requireDatabaseMode = (request: AuthenticatedRequest, response: Response, next: NextFunction) => {
  if (!request.authUser) return response.status(401).json({ error: "Требуется авторизация" });
  if (request.authUser.dataMode !== "database") return response.status(403).json({ error: "Endpoint доступен только в database mode" });
  next();
};
