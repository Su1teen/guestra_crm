import type { NextFunction, Request, Response } from "express";
import { eq } from "drizzle-orm";
import type { Database } from "../db/client.js";
import { appUsers } from "../db/schema.js";
import { readCookie, SESSION_COOKIE, verifySessionToken } from "./session.js";

export type SessionUser = typeof appUsers.$inferSelect;
export type AuthenticatedRequest = Request & { authUser?: SessionUser };

export const authMiddleware = (db: Database, secret: string) => async (request: AuthenticatedRequest, _response: Response, next: NextFunction) => {
  const userId = verifySessionToken(readCookie(request, SESSION_COOKIE), secret);
  if (userId) {
    const [user] = await db.select().from(appUsers).where(eq(appUsers.id, userId)).limit(1);
    request.authUser = user;
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

