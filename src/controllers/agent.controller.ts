import { randomUUID } from "crypto";
import type { Request, Response } from "express";
import { getAuthUserId } from "../middleware/auth.middleware";
import { getPool } from "../db/pool";
import {
  agentService,
  type RunAgentPayslipFile,
} from "../services/agent.service";
import { chatHistoryService } from "../services/chat-history.service";

/**
 * POST /agent/query JSON body (application/json).
 * Optional multipart: field `payslip` file instead of payslipBase64.
 */
const SESSION_UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface AgentQueryJsonBody {
  /**
   * Set by `requireJwtUserId` from JWT (`userId` / `sub`). Omit in JSON when using Bearer auth;
   * do not send a different userId than the token — the server overwrites from the JWT.
   */
  userId: string;
  /** Required unless payslipBase64 (or multipart `payslip`) is sent. */
  query?: string;
  /** Use with payslipBase64 (e.g. application/pdf). Defaults to application/pdf if omitted. */
  payslipMimeType?: string;
  /** Base64-encoded payslip bytes (no data: URL prefix). */
  payslipBase64?: string;
  /**
   * Client-supplied UUID to group turns in one conversation. Omit to start a new session
   * (server returns a new `sessionId` in the response).
   */
  sessionId?: string;
}

const FEEDBACK_COMMENT_MAX = 4000;

/**
 * POST `/agent/feedback` and POST `/feedback` — store user feedback on a chat turn.
 */
export interface ChatFeedbackBody {
  /** User message that was sent to the agent. */
  query: string;
  /** Assistant reply the user is reacting to. */
  response: string;
  /** Set from JWT by `requireJwtUserId`; optional in body for tests without auth middleware. */
  userId?: string;
  /** Optional 1–5 (1 poor, 5 great). */
  rating?: number;
  /** Optional free-text note. */
  comment?: string;
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
  let sessionId: string | undefined;
  try {
    const raw = req.body;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      res.status(400).json({
        success: false,
        error:
          "Expected JSON object with query (and optional payslip fields). userId comes from JWT when using Bearer auth.",
      });
      return;
    }

    const record = raw as unknown as Record<string, unknown>;
    const userIdRaw = getAuthUserId(req);
    if (!userIdRaw) {
      res.status(400).json({
        success: false,
        error:
          "Authenticated user id is required. Send Authorization: Bearer <token> from POST /auth/login or /auth/register (JWT includes userId).",
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

    const sessionIdRaw = getTrimmedField(record, "sessionId");
    if (sessionIdRaw) {
      if (!SESSION_UUID_RE.test(sessionIdRaw)) {
        res.status(400).json({
          success: false,
          error:
            "sessionId must be a valid UUID (RFC 4122) when provided, to group chat turns.",
        });
        return;
      }
      sessionId = sessionIdRaw;
    } else {
      sessionId = randomUUID();
    }

    await chatHistoryService.append({
      userId: userIdRaw,
      sessionId,
      role: "user",
      message: query,
    });

    let result: Awaited<ReturnType<typeof agentService.runAgent>>;
    try {
      result = await agentService.runAgent({
        userId: userIdRaw,
        query,
        ...(payslipFile ? { payslipFile } : {}),
      });
    } catch (agentErr) {
      const msg =
        agentErr instanceof Error ? agentErr.message : String(agentErr);
      await chatHistoryService.append({
        userId: userIdRaw,
        sessionId,
        role: "assistant",
        message: `Summary:\nThe agent failed before completing.\n\nBreakdown:\n${msg}\n\nRecommendation:\nRetry or check server logs.`,
      });
      res.status(500).json({
        success: false,
        error: msg,
        sessionId,
      });
      return;
    }

    await chatHistoryService.append({
      userId: userIdRaw,
      sessionId,
      role: "assistant",
      message: result.response,
    });

    const status = result.success ? 200 : 502;
    res.status(status).json({
      success: result.success,
      response: result.response,
      sessionId,
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
      ...(sessionId ? { sessionId } : {}),
    });
  }
}

export async function postChatFeedback(req: Request, res: Response): Promise<void> {
  try {
    const raw = req.body;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      res.status(400).json({
        success: false,
        error: "Expected JSON body with query and response",
      });
      return;
    }

    const b = raw as Record<string, unknown>;
    const query =
      typeof b.query === "string" ? b.query.trim() : "";
    const responseText =
      typeof b.response === "string" ? b.response.trim() : "";

    if (!query) {
      res.status(400).json({ success: false, error: "query is required" });
      return;
    }
    if (!responseText) {
      res.status(400).json({ success: false, error: "response is required" });
      return;
    }

    const userId = getAuthUserId(req) ?? null;

    let rating: number | null = null;
    if (b.rating !== undefined && b.rating !== null) {
      if (typeof b.rating !== "number" || !Number.isInteger(b.rating)) {
        res.status(400).json({
          success: false,
          error: "rating must be an integer between 1 and 5 when provided",
        });
        return;
      }
      if (b.rating < 0 || b.rating > 5) {
        res.status(400).json({
          success: false,
          error: "rating must be between 0 and 5",
        });
        return;
      }
      rating = b.rating;
    }

    let comment: string | null = null;
    if (typeof b.comment === "string" && b.comment.trim()) {
      const c = b.comment.trim();
      if (c.length > FEEDBACK_COMMENT_MAX) {
        res.status(400).json({
          success: false,
          error: `comment must be at most ${FEEDBACK_COMMENT_MAX} characters`,
        });
        return;
      }
      comment = c;
    }

    const id = await insertFeedbackRow({
      query,
      response: responseText,
      rating,
      userId,
      comment,
    });

    res.status(201).json({ success: true, id, ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ success: false, error: message });
  }
}

function isPgUndefinedColumn(err: unknown): boolean {
  const e = err as { code?: string; message?: string };
  if (e.code === "42703") return true;
  return /column .* does not exist/i.test(e.message ?? "");
}

/** Prefer extended row; fall back if DB was never migrated (no `user_id` / `comment`). */
async function insertFeedbackRow(args: {
  query: string;
  response: string;
  rating: number | null;
  userId: string | null;
  comment: string | null;
}): Promise<number> {
  const pool = getPool();
  try {
    const { rows } = await pool.query(
      `INSERT INTO "Feedback" (query, response, rating, user_id, comment)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id`,
      [
        args.query,
        args.response,
        args.rating,
        args.userId,
        args.comment,
      ],
    );
    return rows[0]?.id as number;
  } catch (err) {
    if (!isPgUndefinedColumn(err)) {
      throw err;
    }
    const rating =
      args.rating ??
      3;
    const { rows } = await pool.query(
      `INSERT INTO "Feedback" (query, response, rating) VALUES ($1, $2, $3) RETURNING id`,
      [args.query, args.response, rating],
    );
    return rows[0]?.id as number;
  }
}

