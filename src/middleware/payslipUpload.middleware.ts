import type { NextFunction, Request, Response } from "express";
import multer from "multer";

const memory = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 },
});

/**
 * Parses multipart/form-data with optional `payslip` file; JSON-only requests pass through.
 */
export function payslipUploadMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (req.is("multipart/form-data")) {
    memory.single("payslip")(req, res, (err: unknown) => {
      if (err) {
        const message = err instanceof Error ? err.message : String(err);
        res.status(400).json({
          success: false,
          error: message,
        });
        return;
      }
      next();
    });
    return;
  }
  next();
}
