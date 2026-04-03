import type { Request, Response, NextFunction } from "express";
import { logger } from "../utils/logger";

export function requestLogger(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const start = Date.now();
  const { method, originalUrl } = req;

  res.on("finish", () => {
    const ms = Date.now() - start;
    logger.info("http_request", {
      method,
      path: originalUrl,
      status: res.statusCode,
      ms,
    });
  });

  next();
}
