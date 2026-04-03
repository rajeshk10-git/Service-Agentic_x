import type { Request, Response } from "express";
import { env } from "../config/env";
import { toolService } from "../services/tool.service";
import type { ParseSalarySlipArgs } from "../tools/parse.tool";

interface ParseTaskBody {
  userId?: string;
  gcs_uri?: string;
  document_text?: string;
  content_type?: string;
}

function authorizeTask(req: Request): boolean {
  if (!env.INTERNAL_TASKS_SECRET) {
    return false;
  }
  const h = req.headers["x-internal-tasks-secret"];
  return typeof h === "string" && h === env.INTERNAL_TASKS_SECRET;
}

/**
 * Cloud Tasks (or internal worker) hits this to run payslip parse synchronously.
 */
export async function postInternalParseTask(
  req: Request<object, unknown, ParseTaskBody>,
  res: Response,
): Promise<void> {
  if (!authorizeTask(req)) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  try {
    const { userId, gcs_uri, document_text, content_type } = req.body ?? {};
    if (!userId || typeof userId !== "string") {
      res.status(400).json({ error: "userId required" });
      return;
    }

    const args: ParseSalarySlipArgs = {
      gcs_uri,
      document_text,
      content_type: content_type as ParseSalarySlipArgs["content_type"],
    };

    const result = await toolService.runParseForWorker(args, userId.trim());
    res.status(200).json({ ok: true, result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
}
