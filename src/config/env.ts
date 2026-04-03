import "dotenv/config";

function required(name: string): string {
  const v = process.env[name];
  if (!v || v.trim() === "") {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return v;
}

export type LlmProvider = "openai" | "vertex" | "google-ai";

function googleAiApiKey(): string {
  return (
    process.env.GOOGLE_AI_API_KEY?.trim() ||
    process.env.GEMINI_API_KEY?.trim() ||
    ""
  );
}

/**
 * - `gemini` / `google-ai` → Gemini Developer API (API key), same as
 *   generativelanguage.googleapis.com/v1beta/.../models/...:generateContent?key=
 * - `vertex` → Vertex AI with Application Default Credentials
 * - Unset: prefer GOOGLE_AI_API_KEY → google-ai, else OPENAI_API_KEY → openai, else vertex
 */
function resolveLlmProvider(): LlmProvider {
  const raw = process.env.LLM_PROVIDER?.trim();
  if (!raw) {
    if (googleAiApiKey()) return "google-ai";
    if (process.env.OPENAI_API_KEY?.trim()) return "openai";
    return "vertex";
  }
  const p = raw.toLowerCase().replace(/_/g, "-");
  if (p === "vertex") return "vertex";
  if (p === "google-ai" || p === "googleai" || p === "gemini") {
    return "google-ai";
  }
  return "openai";
}

const llmProvider = resolveLlmProvider();

if (llmProvider === "openai" && !process.env.OPENAI_API_KEY?.trim()) {
  throw new Error(
    "OPENAI_API_KEY is required when LLM_PROVIDER=openai.",
  );
}

if (llmProvider === "vertex") {
  if (!process.env.GCP_PROJECT_ID?.trim()) {
    throw new Error(
      "GCP_PROJECT_ID is required when LLM_PROVIDER=vertex (Vertex AI + ADC).",
    );
  }
  if (!process.env.GCP_LOCATION?.trim()) {
    throw new Error(
      "GCP_LOCATION is required when LLM_PROVIDER=vertex.",
    );
  }
}

if (llmProvider === "google-ai") {
  if (!googleAiApiKey()) {
    throw new Error(
      "Set GOOGLE_AI_API_KEY or GEMINI_API_KEY for gemini / google-ai (key from https://aistudio.google.com/apikey — same as generateContent?key=).",
    );
  }
}

export const env = {
  NODE_ENV: process.env.NODE_ENV ?? "development",
  /**
   * Server listen port. Prefer APP_PORT; falls back to PORT (Cloud Run sets PORT).
   */
  APP_PORT:
    Number(process.env.APP_PORT ?? process.env.PORT) || 3000,
  DATABASE_URL: required("DATABASE_URL"),
  LLM_PROVIDER: llmProvider,
  OPENAI_API_KEY: process.env.OPENAI_API_KEY ?? "",
  OPENAI_MODEL: process.env.OPENAI_MODEL ?? "gpt-4o-mini",
  PYTHON_TAX_SERVICE_URL:
    process.env.PYTHON_TAX_SERVICE_URL ?? "http://localhost:8001",
  PYTHON_PARSE_SERVICE_URL:
    process.env.PYTHON_PARSE_SERVICE_URL ?? "http://localhost:8000",

  /** JSON logs for Cloud Logging on Cloud Run (also if LOG_FORMAT=json). */
  LOG_FORMAT_JSON:
    process.env.LOG_FORMAT === "json" || Boolean(process.env.K_SERVICE),

  /** Optional: load secrets into process.env before app modules initialize (see server.ts). */
  GCP_SECRET_MANAGER_ENABLED:
    process.env.GCP_SECRET_MANAGER_ENABLED === "true",
  GCP_PROJECT_ID: process.env.GCP_PROJECT_ID ?? "",
  GCP_LOCATION: process.env.GCP_LOCATION ?? "us-central1",

  /** Cloud Storage payslip bucket (optional). */
  GCS_PAYSLIP_BUCKET: process.env.GCS_PAYSLIP_BUCKET ?? "",
  GCS_PAYSLIP_PREFIX: process.env.GCS_PAYSLIP_PREFIX ?? "payslips",

  /** Document AI processor resource id (Projects/.../processors/XXX) or short id with location in GCP_LOCATION. */
  DOCUMENT_AI_PROCESSOR_ID: process.env.DOCUMENT_AI_PROCESSOR_ID ?? "",
  DOCUMENT_AI_LOCATION:
    process.env.DOCUMENT_AI_LOCATION ?? process.env.GCP_LOCATION ?? "",

  /** Gemini on Vertex AI (chat). */
  VERTEX_GEMINI_MODEL:
    process.env.VERTEX_GEMINI_MODEL ?? "gemini-1.5-flash",

  /**
   * Google AI Studio / Gemini API (API key). Same REST shape as
   * generativelanguage.googleapis.com/v1beta/models/{model}:generateContent
   */
  GOOGLE_AI_API_KEY: googleAiApiKey(),
  GOOGLE_AI_MODEL: process.env.GOOGLE_AI_MODEL ?? "gemini-2.5-flash",

  /** Cloud Tasks — async payslip parse. */
  CLOUD_TASKS_ENABLED: process.env.CLOUD_TASKS_ENABLED === "true",
  CLOUD_TASKS_LOCATION: process.env.CLOUD_TASKS_LOCATION ?? "",
  CLOUD_TASKS_QUEUE: process.env.CLOUD_TASKS_QUEUE ?? "",
  CLOUD_TASKS_TARGET_URL: process.env.CLOUD_TASKS_TARGET_URL ?? "",
  CLOUD_TASKS_SERVICE_ACCOUNT_EMAIL:
    process.env.CLOUD_TASKS_SERVICE_ACCOUNT_EMAIL ?? "",
  INTERNAL_TASKS_SECRET: process.env.INTERNAL_TASKS_SECRET ?? "",

  /** Signed URL TTL (minutes). */
  GCS_SIGNED_URL_TTL_MIN: Number(process.env.GCS_SIGNED_URL_TTL_MIN) || 15,

  /** If set, register/login responses include a JWT (HS256, 7d). */
  JWT_SECRET: process.env.JWT_SECRET ?? "",
  JWT_EXPIRES_DAYS: Number(process.env.JWT_EXPIRES_DAYS) || 7,

  /**
   * bcrypt cost factor for password hashing (higher = slower & stronger).
   * Default 10 balances UX and security; use 12+ in high-assurance environments.
   */
  BCRYPT_ROUNDS: Math.min(
    14,
    Math.max(4, Number(process.env.BCRYPT_ROUNDS) || 10),
  ),
} as const;
