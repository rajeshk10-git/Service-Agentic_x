jest.mock("../config/env", () => ({
  env: {
    DATABASE_URL: "postgresql://test:test@localhost:5432/test",
    APP_PORT: 3000,
    LLM_PROVIDER: "openai",
    OPENAI_API_KEY: "test-key",
    OPENAI_MODEL: "gpt-4o-mini",
    NODE_ENV: "test",
    LOG_FORMAT_JSON: false,
    BCRYPT_ROUNDS: 4,
    JWT_SECRET: "",
    JWT_EXPIRES_DAYS: 7,
    GCP_PROJECT_ID: "",
    GCP_LOCATION: "us-central1",
    GCS_PAYSLIP_BUCKET: "",
    GCS_PAYSLIP_PREFIX: "payslips",
    DOCUMENT_AI_PROCESSOR_ID: "",
    DOCUMENT_AI_LOCATION: "",
    VERTEX_GEMINI_MODEL: "gemini-1.5-flash",
    GOOGLE_AI_API_KEY: "",
    GOOGLE_AI_MODEL: "gemini-2.5-flash",
    CLOUD_TASKS_ENABLED: false,
    CLOUD_TASKS_LOCATION: "",
    CLOUD_TASKS_QUEUE: "",
    CLOUD_TASKS_TARGET_URL: "",
    CLOUD_TASKS_SERVICE_ACCOUNT_EMAIL: "",
    INTERNAL_TASKS_SECRET: "",
    GCS_SIGNED_URL_TTL_MIN: 15,
    PYTHON_TAX_SERVICE_URL: "http://localhost:8001",
    PYTHON_PARSE_SERVICE_URL: "http://localhost:8000",
    GCP_SECRET_MANAGER_ENABLED: false,
  },
}));

jest.mock("../db/pool", () => ({
  getPool: jest.fn().mockReturnValue({
    query: jest.fn().mockResolvedValue({ rows: [{ id: 1, chat_id: 1 }] }),
  }),
}));

jest.mock("../services/agent.service", () => ({
  agentService: {
    runAgent: jest.fn().mockResolvedValue({
      success: true,
      response: "Test response",
      toolsUsed: [],
    }),
  },
}));

jest.mock("../services/chat-history.service", () => ({
  chatHistoryService: {
    append: jest.fn().mockResolvedValue(1),
  },
}));

import request from "supertest";
import express from "express";
import { postAgentQuery, postChatFeedback } from "./agent.controller";

const app = express();
app.use(express.json());
app.post("/agent/query", postAgentQuery);
app.post("/agent/feedback", postChatFeedback);

describe("POST /agent/query", () => {
  it("returns 400 when body is an array instead of object", async () => {
    const res = await request(app)
      .post("/agent/query")
      .send([1, 2, 3]);
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it("returns 400 when userId is missing", async () => {
    const res = await request(app)
      .post("/agent/query")
      .send({ query: "hello" });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("userId");
  });

  it("returns 400 when userId is empty string", async () => {
    const res = await request(app)
      .post("/agent/query")
      .send({ userId: "   ", query: "hello" });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("userId");
  });

  it("returns 400 when query is missing and no payslip", async () => {
    const res = await request(app)
      .post("/agent/query")
      .send({ userId: "user-1" });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("query is required");
  });

  it("returns 400 when payslipBase64 decodes to empty buffer", async () => {
    const res = await request(app)
      .post("/agent/query")
      .send({ userId: "user-1", payslipBase64: "" , query: ""});
    expect(res.status).toBe(400);
  });

  it("returns 200 with valid userId and query", async () => {
    const res = await request(app)
      .post("/agent/query")
      .send({ userId: "user-1", query: "What is my salary?" });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.response).toBe("Test response");
  });

  it("returns 200 with valid payslipBase64 and no explicit query", async () => {
    const fakeBase64 = Buffer.from("fake pdf content").toString("base64");
    const res = await request(app)
      .post("/agent/query")
      .send({
        userId: "user-1",
        payslipBase64: fakeBase64,
        payslipMimeType: "application/pdf",
      });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});

describe("POST /agent/feedback", () => {
  it("returns 400 when query is missing", async () => {
    const res = await request(app)
      .post("/agent/feedback")
      .send({ response: "resp", rating: 5 });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("query");
  });

  it("returns 400 when response is missing", async () => {
    const res = await request(app)
      .post("/agent/feedback")
      .send({ query: "q", rating: 5 });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("response");
  });

  it("returns 400 when rating is not an integer", async () => {
    const res = await request(app)
      .post("/agent/feedback")
      .send({ query: "q", response: "r", rating: 4.5 });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("rating");
  });

  it("returns 201 when rating is omitted", async () => {
    const res = await request(app)
      .post("/agent/feedback")
      .send({ query: "q", response: "r" });
    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
  });
});
