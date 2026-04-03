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
 * Verifies `Authorization: Bearer <jwt>` (signed with `JWT_SECRET`, claim `sub` = user id).
 * Sets `req.body.userId` from the token (overwrites any client-supplied `userId`).
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
    const decoded = jwt.verify(token, secret) as jwt.JwtPayload;
    const userId = decoded.sub;
    if (!userId || typeof userId !== "string") {
      res.status(401).json({
        success: false,
        error: "Invalid token: missing subject (user id)",
      });
      return;
    }

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
