import { createHmac, timingSafeEqual } from "node:crypto";
import type { Request, Response } from "express";

export const SESSION_COOKIE = "guestra_session";
const MAX_AGE_SECONDS = 60 * 60 * 24 * 7;

const encode = (value: string) => Buffer.from(value).toString("base64url");
const sign = (payload: string, secret: string) => createHmac("sha256", secret).update(payload).digest("base64url");

export const createSessionToken = (userId: string, secret: string, now = Date.now()) => {
  const payload = encode(JSON.stringify({ userId, issuedAt: now, expiresAt: now + MAX_AGE_SECONDS * 1000 }));
  return `${payload}.${sign(payload, secret)}`;
};

export const verifySessionToken = (token: string | undefined, secret: string): string | null => {
  if (!token) return null;
  const [payload, signature] = token.split(".");
  if (!payload || !signature) return null;
  const expected = sign(payload, secret);
  const left = Buffer.from(signature);
  const right = Buffer.from(expected);
  if (left.length !== right.length || !timingSafeEqual(left, right)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { userId: string; expiresAt: number };
    return parsed.expiresAt > Date.now() ? parsed.userId : null;
  } catch {
    return null;
  }
};

export const readCookie = (request: Request, name: string) => {
  const cookies = request.headers.cookie?.split(";").map((item) => item.trim()) ?? [];
  const match = cookies.find((item) => item.startsWith(`${name}=`));
  return match ? decodeURIComponent(match.slice(name.length + 1)) : undefined;
};

export const setSessionCookie = (response: Response, token: string, production: boolean) => {
  response.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: production,
    sameSite: "lax",
    path: "/",
    maxAge: MAX_AGE_SECONDS * 1000,
  });
};

export const clearSessionCookie = (response: Response, production: boolean) => {
  response.clearCookie(SESSION_COOKIE, { httpOnly: true, secure: production, sameSite: "lax", path: "/" });
};

