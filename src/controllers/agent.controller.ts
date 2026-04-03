import type { Request, Response } from "express";
import { getPool } from "../db/pool";
import {
  agentService,
  type RunAgentPayslipFile,
} from "../services/agent.service";

/**
 * POST /agent/query JSON body (application/json).
 * Optional multipart: field `payslip` file instead of payslipBase64.
 */
export interface AgentQueryJsonBody {
  userId: string;
  /** Required unless payslipBase64 (or multipart `payslip`) is sent. */
  query?: string;
  /** Use with payslipBase64 (e.g. application/pdf). Defaults to application/pdf if omitted. */
  payslipMimeType?: string;
  /** Base64-encoded payslip bytes (no data: URL prefix). */
  payslipBase64?: string;
}

interface FeedbackBody {
  query?: string;
  response?: string;
  rating?: number;
}

const DEFAULT_QUERY_WITH_PAYSLIP_ONLY =
  "What was parsed from the uploaded payslip and what payroll rows were saved or updated?";

function getTrimmedField(
  body: Record<string, unknown>,
  key: string,
): string | undefined {
  const v = body[key];
  if (typeof v === "string") {
    const t = v.trim();
    return t.length > 0 ? t : undefined;
  }
  return undefined;
}

function payslipFileFromMultipart(
  req: Request,
): RunAgentPayslipFile | undefined {
  const file = (req as Request & { file?: Express.Multer.File }).file;
  if (file?.buffer?.length) {
    return {
      buffer: file.buffer,
      mimeType: file.mimetype || "application/octet-stream",
    };
  }
  return undefined;
}

function payslipFileFromJsonBody(
  body: AgentQueryJsonBody,
): RunAgentPayslipFile | { error: string } | undefined {
  const b64 = body.payslipBase64;
  if (!b64) {
    return undefined;
  }
  const mime =
    (body.payslipMimeType?.trim() || "application/pdf").trim() ||
    "application/pdf";
  try {
    const buffer = Buffer.from(b64, "base64");
    if (buffer.length === 0) {
      return { error: "payslipBase64 decoded to empty buffer" };
    }
    return { buffer, mimeType: mime };
  } catch {
    return { error: "payslipBase64 is not valid base64" };
  }
}

export async function postAgentQuery(req: Request, res: Response): Promise<void> {
  try {
    const raw = req.body;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      res.status(400).json({
        success: false,
        error:
          "Expected JSON object with userId, query, and optional payslipMimeType + payslipBase64",
      });
      return;
    }

    const record = raw as unknown as Record<string, unknown>;
    const userIdRaw = getTrimmedField(record, "userId");
    if (!userIdRaw) {
      res.status(400).json({
        success: false,
        error:
          "userId is required (string). Example: { \"userId\": \"user-123\", \"query\": \"...\" }",
      });
      return;
    }

    const p64 = record.payslipBase64;
    const body: AgentQueryJsonBody = {
      userId: userIdRaw,
      query: getTrimmedField(record, "query"),
      payslipMimeType: getTrimmedField(record, "payslipMimeType"),
      payslipBase64:
        typeof p64 === "string" && p64.trim() ? p64.trim() : undefined,
    };

    let query = body.query ?? "";

    const fromMultipart = payslipFileFromMultipart(req);
    const fromJson = payslipFileFromJsonBody(body);

    if (fromJson && "error" in fromJson) {
      res.status(400).json({ success: false, error: fromJson.error });
      return;
    }

    const payslipFile = fromMultipart ?? fromJson;

    if (!query && !payslipFile) {
      res.status(400).json({
        success: false,
        error:
          "query is required unless you send a payslip (JSON payslipBase64 + payslipMimeType, or multipart field `payslip`)",
      });
      return;
    }
    if (!query) {
      query = DEFAULT_QUERY_WITH_PAYSLIP_ONLY;
    }

    const result = await agentService.runAgent({
      userId: userIdRaw,
      query,
      ...(payslipFile ? { payslipFile } : {}),
    });

    const status = result.success ? 200 : 502;
    res.status(status).json({
      success: result.success,
      response: result.response,
      toolsUsed: result.toolsUsed,
      ...(result.payslipParse !== undefined
        ? { payslipParse: result.payslipParse }
        : {}),
      ...(result.error ? { error: result.error } : {}),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({
      success: false,
      error: message,
    });
  }
}

export async function postFeedback(
  req: Request<object, unknown, FeedbackBody>,
  res: Response,
): Promise<void> {
  try {
    const { query, response, rating } = req.body ?? {};
    if (!query || typeof query !== "string") {
      res.status(400).json({ error: "query is required" });
      return;
    }
    if (!response || typeof response !== "string") {
      res.status(400).json({ error: "response is required" });
      return;
    }
    if (rating === undefined || typeof rating !== "number" || !Number.isInteger(rating)) {
      res.status(400).json({ error: "rating is required and must be an integer" });
      return;
    }

    const { rows } = await getPool().query(
      `INSERT INTO "Feedback" (query, response, rating) VALUES ($1, $2, $3) RETURNING id`,
      [query, response, rating],
    );
    const id = rows[0]?.id as number;

    res.status(201).json({ id, ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
}
