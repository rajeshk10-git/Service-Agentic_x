import axios from "axios";
import { DocumentProcessorServiceClient } from "@google-cloud/documentai";
import { env } from "../config/env";
import { logger } from "../utils/logger";
import {
  extractPayslipFromDocumentAi,
  payslipExtractedFromGeminiJson,
} from "./documentai.extract";
import type { protos } from "@google-cloud/documentai";

const GEMINI_GENERATE_BASE =
  "https://generativelanguage.googleapis.com/v1beta/models";

const PAYSLIP_GEMINI_PROMPT = `You are reading an attached payslip (PDF or image). Extract payroll fields and respond with ONE JSON object only (no markdown fences, no commentary). Use null for unknown fields. Numbers are monthly amounts as plain numbers (no currency symbols). month must be YYYY-MM if you can infer it.

Required JSON shape:
{"month":string|null,"basic":number|null,"hra":number|null,"tax":number|null,"pf":number|null,"grossEarnings":number|null,"netPay":number|null,"payDate":string|null,"payPeriodLabel":string|null,"employeeName":string|null,"employerName":string|null}`;

function extractFirstJsonObject(modelText: string): unknown {
  const trimmed = modelText.trim();
  const fence = /^```(?:json)?\s*([\s\S]*?)```/m.exec(trimmed);
  const candidate = (fence ? fence[1] : trimmed).trim();
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start < 0 || end <= start) {
    throw new Error("Model did not return a JSON object");
  }
  return JSON.parse(candidate.slice(start, end + 1)) as unknown;
}

function mapGeminiHttpError(err: unknown): Record<string, unknown> {
  if (axios.isAxiosError(err)) {
    const status = err.response?.status;
    const payload = err.response?.data as Record<string, unknown> | undefined;
    const apiMsg = (payload?.error as { message?: string } | undefined)
      ?.message;
    return {
      error: true,
      message:
        apiMsg ??
        err.message ??
        `Gemini generateContent failed${status != null ? ` (${status})` : ""}`,
    };
  }
  return {
    error: true,
    message: err instanceof Error ? err.message : String(err),
  };
}

function buildDocumentAiResult(
  doc: protos.google.cloud.documentai.v1.IDocument | null | undefined,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  const text = doc?.text ?? "";
  const entities =
    doc?.entities?.map((e) => ({
      type: e.type,
      mentionText: e.mentionText,
      confidence: e.confidence,
    })) ?? [];

  return {
    source: "document_ai",
    text,
    entities,
    pageCount: doc?.pages?.length ?? 0,
    extracted: extractPayslipFromDocumentAi(doc),
    ...extra,
  };
}

let client: DocumentProcessorServiceClient | null = null;

function documentAiAuthHelp(): string {
  return (
    "Document AI needs Google Cloud credentials (the Gemini API key is not used here). " +
    "On your machine: run `gcloud auth application-default login`. " +
    "Or set env GOOGLE_APPLICATION_CREDENTIALS to the path of a service account JSON key " +
    "(roles: Document AI API User, and Storage if you use GCS). " +
    "https://cloud.google.com/docs/authentication/getting-started"
  );
}

function mapDocumentAiCallError(err: unknown): Record<string, unknown> {
  const detail = err instanceof Error ? err.message : String(err);
  if (
    /default credentials|Could not load the default credentials|ENOENT.*application_default_credentials|GOOGLE_APPLICATION_CREDENTIALS/i.test(
      detail,
    )
  ) {
    return { error: true, message: documentAiAuthHelp(), authError: true, detail };
  }
  return { error: true, message: detail };
}

function getClient(): DocumentProcessorServiceClient | null {
  if (!env.DOCUMENT_AI_PROCESSOR_ID) return null;
  if (!client) {
    const loc = env.DOCUMENT_AI_LOCATION || env.GCP_LOCATION;
    client = new DocumentProcessorServiceClient({
      apiEndpoint: `${loc}-documentai.googleapis.com`,
    });
  }
  return client;
}

function processorName(): string {
  const id = env.DOCUMENT_AI_PROCESSOR_ID.trim();
  if (id.startsWith("projects/")) return id;
  const loc = env.DOCUMENT_AI_LOCATION || env.GCP_LOCATION;
  return `projects/${env.GCP_PROJECT_ID}/locations/${loc}/processors/${id}`;
}

export function isDocumentAiConfigured(): boolean {
  return Boolean(env.DOCUMENT_AI_PROCESSOR_ID && env.GCP_PROJECT_ID);
}

/** Inline payslip bytes are parsed with Gemini API (`generateContent` + API key). */
export function canProcessPayslipFromBytes(): boolean {
  return Boolean(env.GOOGLE_AI_API_KEY?.trim());
}

function mimeFromGcsUri(uri: string): string {
  const lower = uri.toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".gif")) return "image/gif";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".tiff") || lower.endsWith(".tif")) return "image/tiff";
  return "application/pdf";
}

/**
 * Process a payslip PDF (or image) stored in GCS.
 */
export async function processDocumentFromGcs(
  gcsUri: string,
  mimeType?: string,
): Promise<Record<string, unknown>> {
  const c = getClient();
  if (!c) {
    return { error: true, message: "Document AI is not configured" };
  }

  const name = processorName();
  let result: protos.google.cloud.documentai.v1.IProcessResponse;
  try {
    [result] = await c.processDocument({
      name,
      gcsDocument: {
        gcsUri,
        mimeType: mimeType ?? mimeFromGcsUri(gcsUri),
      },
      skipHumanReview: true,
    });
  } catch (err) {
    return mapDocumentAiCallError(err);
  }

  const doc = result.document;
  const text = doc?.text ?? "";
  const entities =
    doc?.entities?.map((e) => ({
      type: e.type,
      mentionText: e.mentionText,
      confidence: e.confidence,
    })) ?? [];

  logger.info("Document AI processed", {
    gcsUri,
    textLength: text.length,
    entityCount: entities.length,
  });

  return buildDocumentAiResult(doc, { gcsUri });
}

/**
 * Process inline PDF/image bytes via Gemini `generateContent` (axios), same API as:
 * POST generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key=...
 */
export async function processDocumentFromBytes(
  content: Buffer,
  mimeType: string,
): Promise<Record<string, unknown>> {
  const apiKey = env.GOOGLE_AI_API_KEY?.trim();
  if (!apiKey) {
    return {
      error: true,
      message:
        "Set GOOGLE_AI_API_KEY or GEMINI_API_KEY to parse inline payslip files (Gemini generateContent).",
    };
  }

  const model = env.GOOGLE_AI_MODEL.replace(/^models\//, "");
  const url = `${GEMINI_GENERATE_BASE}/${encodeURIComponent(model)}:generateContent`;
  const body = {
    contents: [
      {
        role: "user" as const,
        parts: [
          {
            inline_data: {
              mime_type: mimeType || "application/pdf",
              data: content.toString("base64"),
            },
          },
          { text: PAYSLIP_GEMINI_PROMPT },
        ],
      },
    ],
    generationConfig: {
      temperature: 0.1,
      maxOutputTokens: 2048,
    },
  };

  let data: Record<string, unknown>;
  try {
    const res = await axios.post<Record<string, unknown>>(url, body, {
      params: { key: apiKey },
      headers: { "Content-Type": "application/json" },
      maxBodyLength: Infinity,
      maxContentLength: Infinity,
    });
    data = res.data;
  } catch (err) {
    return mapGeminiHttpError(err);
  }

  const apiErr = data.error as { message?: string } | undefined;
  if (apiErr?.message) {
    return { error: true, message: apiErr.message };
  }

  const candidates = data.candidates as Record<string, unknown>[] | undefined;
  const parts = (
    candidates?.[0]?.content as { parts?: { text?: string }[] } | undefined
  )?.parts;
  const text =
    parts?.map((p) => (typeof p.text === "string" ? p.text : "")).join("") ??
    "";

  let parsed: unknown;
  try {
    parsed = extractFirstJsonObject(text);
  } catch (e) {
    return {
      error: true,
      message: e instanceof Error ? e.message : String(e),
      rawModelText: text.slice(0, 2000),
    };
  }

  const extracted = payslipExtractedFromGeminiJson(parsed);

  logger.info("Gemini inline payslip generateContent", {
    mimeType,
    byteLength: content.length,
    responseTextLength: text.length,
  });

  return {
    source: "gemini_api",
    text,
    entities: [],
    pageCount: 0,
    extracted,
  };
}
