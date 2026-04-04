import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { env } from "../config/env";

function bearerToken(req: Request): string | undefined {
  const h = req.headers.authorization;
  if (typeof h !== "string") return undefined;
  const m = /^Bearer\s+(\S+)$/i.exec(h.trim());
  return m?.[1];
}

/**
 * Resolved user id: JWT `userId` claim if present, otherwise `sub` (must match when both set).
 */
export function getAuthUserId(req: Request): string | undefined {
  if (typeof req.authUserId === "string" && req.authUserId.trim()) {
    return req.authUserId.trim();
  }
  const b = req.body;
  if (b && typeof b === "object" && !Array.isArray(b)) {
    const u = (b as Record<string, unknown>).userId;
    if (typeof u === "string" && u.trim()) return u.trim();
  }
  return undefined;
}

/**
 * Verifies `Authorization: Bearer <jwt>` (signed with `JWT_SECRET`).
 * Payload includes `userId` and `sub` (same value) plus `email`.
 * Sets `req.authUserId` and `req.body.userId` (overwrites any client-supplied `userId`).
 *
 * Mount **after** `express.json` and, for `/agent/query`, after `payslipUploadMiddleware`
 * so `req.body` exists for JSON and multipart.
 */
export function requireJwtUserId(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const secret = env.JWT_SECRET?.trim();
  if (!secret) {
    res.status(503).json({
      success: false,
      error:
        "Authentication is not configured. Set JWT_SECRET to enable protected routes.",
    });
    return;
  }

  const token = bearerToken(req);
  if (!token) {
    res.status(401).json({
      success: false,
      error: "Missing Authorization header. Use: Authorization: Bearer <token>",
    });
    return;
  }

  try {
    const decoded = jwt.verify(token, secret) as jwt.JwtPayload & {
      userId?: string;
    };
    const sub =
      typeof decoded.sub === "string" ? decoded.sub.trim() : "";
    const claimUserId =
      typeof decoded.userId === "string" ? decoded.userId.trim() : "";
    if (claimUserId && sub && claimUserId !== sub) {
      res.status(401).json({
        success: false,
        error: "Invalid token: userId and sub must match",
      });
      return;
    }
    const userId = claimUserId || sub;
    if (!userId) {
      res.status(401).json({
        success: false,
        error: "Invalid token: missing user id (userId or sub)",
      });
      return;
    }

    req.authUserId = userId;

    if (!req.body || typeof req.body !== "object" || Array.isArray(req.body)) {
      req.body = {};
    }
    (req.body as Record<string, unknown>).userId = userId;
    next();
  } catch {
    res.status(401).json({
      success: false,
      error: "Invalid or expired token",
    });
  }
}
