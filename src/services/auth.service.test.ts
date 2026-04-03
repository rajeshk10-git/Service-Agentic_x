jest.mock("../db/pool", () => ({
  getPool: jest.fn(),
}));

jest.mock("../config/env", () => ({
  env: {
    BCRYPT_ROUNDS: 4,
    JWT_SECRET: "test-secret",
    JWT_EXPIRES_DAYS: 7,
    DATABASE_URL: "postgresql://test:test@localhost:5432/test",
    APP_PORT: 3000,
    LLM_PROVIDER: "openai",
    OPENAI_API_KEY: "test-key",
    OPENAI_MODEL: "gpt-4o-mini",
    NODE_ENV: "test",
    LOG_FORMAT_JSON: false,
  },
}));

import { registerUser, loginUser } from "./auth.service";
import { getPool } from "../db/pool";

const mockQuery = jest.fn();
(getPool as jest.Mock).mockReturnValue({ query: mockQuery });

describe("registerUser", () => {
  beforeEach(() => {
    mockQuery.mockReset();
  });

  it("rejects empty name", async () => {
    const result = await registerUser({ name: "", email: "a@b.com", password: "12345678" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("validation_error");
      expect(result.message).toContain("Name");
    }
  });

  it("rejects name longer than 200 chars", async () => {
    const longName = "A".repeat(201);
    const result = await registerUser({ name: longName, email: "a@b.com", password: "12345678" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain("too long");
    }
  });

  it("rejects empty email", async () => {
    const result = await registerUser({ name: "John", email: "", password: "12345678" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain("Email");
    }
  });

  it("rejects invalid email format", async () => {
    const result = await registerUser({ name: "John", email: "not-an-email", password: "12345678" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain("Invalid email");
    }
  });

  it("rejects password shorter than 8 chars", async () => {
    const result = await registerUser({ name: "John", email: "a@b.com", password: "short" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain("at least 8");
    }
  });

  it("rejects password longer than 128 chars", async () => {
    const longPwd = "A".repeat(129);
    const result = await registerUser({ name: "John", email: "a@b.com", password: longPwd });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain("too long");
    }
  });

  it("returns email_taken when duplicate email exists", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: "existing-id" }] });
    const result = await registerUser({ name: "John", email: "taken@test.com", password: "12345678" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("email_taken");
    }
  });

  it("registers successfully with valid input", async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [{ id: "new-id", name: "John", email: "john@test.com" }],
      });

    const result = await registerUser({ name: "John", email: "john@test.com", password: "12345678" });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.user.email).toBe("john@test.com");
      expect(result.user.name).toBe("John");
      expect(result.token).toBeDefined();
    }
  });

  it("normalizes email to lowercase and trims", async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [{ id: "new-id", name: "Jane", email: "jane@test.com" }],
      });

    await registerUser({ name: "Jane", email: "  Jane@TEST.com  ", password: "12345678" });
    expect(mockQuery.mock.calls[0][1]).toEqual(["jane@test.com"]);
  });
});

describe("loginUser", () => {
  beforeEach(() => {
    mockQuery.mockReset();
  });

  it("rejects empty email", async () => {
    const result = await loginUser({ email: "", password: "12345678" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain("Email");
    }
  });

  it("rejects empty password", async () => {
    const result = await loginUser({ email: "a@b.com", password: "" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain("Password");
    }
  });

  it("returns invalid_credentials when user not found", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const result = await loginUser({ email: "missing@test.com", password: "12345678" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("invalid_credentials");
    }
  });
});
