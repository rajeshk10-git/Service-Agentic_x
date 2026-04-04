import bcrypt from "bcrypt";
import { randomUUID } from "crypto";
import jwt from "jsonwebtoken";
import { env } from "../config/env";
import { getPool } from "../db/pool";

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Aligned with frontend `strongPasswordValidator`. */
const STRONG_PASSWORD_MIN_LENGTH = 8;
const STRONG_PASSWORD_MAX_LENGTH = 15;
const STRONG_PASSWORD_SPECIAL_RE =
  /[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?`~]/;

export interface RegisterInput {
  name: string;
  email: string;
  password: string;
}

export interface LoginInput {
  email: string;
  password: string;
}

export interface PublicUser {
  id: string;
  name: string;
  email: string;
}

export type AuthResult =
  | { ok: true; user: PublicUser; token?: string }
  | { ok: false; code: string; message: string };

function validateStrongPassword(password: string): string | null {
  const v = password;
  const issues: string[] = [];
  if (v.length < STRONG_PASSWORD_MIN_LENGTH) {
    issues.push(`at least ${STRONG_PASSWORD_MIN_LENGTH} characters`);
  }
  if (v.length > STRONG_PASSWORD_MAX_LENGTH) {
    issues.push(`at most ${STRONG_PASSWORD_MAX_LENGTH} characters`);
  }
  if (!/[a-z]/.test(v)) issues.push("one lowercase letter");
  if (!/[A-Z]/.test(v)) issues.push("one uppercase letter");
  if (!/\d/.test(v)) issues.push("one digit");
  if (!STRONG_PASSWORD_SPECIAL_RE.test(v)) {
    issues.push(
      "one special character (!@#$%^&*()_+-=[]{}|;':\",./<>?`~ etc.)",
    );
  }
  if (issues.length === 0) return null;
  return `Password must include ${issues.join(", ")}.`;
}

function validateRegister(input: RegisterInput): string | null {
  const nameTrimmed = input.name?.trim() ?? "";
  if (!nameTrimmed) return "Name is required";
  if (nameTrimmed.length < 2) return "Name must be at least 2 characters";
  if (nameTrimmed.length > 200) return "Name is too long";

  if (!input.email?.trim()) return "Email is required";
  if (!EMAIL_REGEX.test(input.email.trim().toLowerCase())) {
    return "Invalid email format";
  }

  if (input.password == null || input.password === "") {
    return "Password is required";
  }
  const pwdErr = validateStrongPassword(input.password);
  if (pwdErr) return pwdErr;

  return null;
}

function validateLogin(input: LoginInput): string | null {
  if (!input.email?.trim()) return "Email is required";
  if (!EMAIL_REGEX.test(input.email.trim().toLowerCase())) {
    return "Invalid email format";
  }
  if (input.password == null || input.password === "") {
    return "Password is required";
  }
  return null;
}

function signToken(user: PublicUser): string | undefined {
  if (!env.JWT_SECRET.trim()) return undefined;
  return jwt.sign(
    {
      sub: user.id,
      userId: user.id,
      email: user.email,
    },
    env.JWT_SECRET,
    { expiresIn: `${env.JWT_EXPIRES_DAYS}d` },
  );
}

function toPublicUser(row: {
  id: string;
  name: string;
  email: string;
}): PublicUser {
  return { id: row.id, name: row.name, email: row.email };
}

export async function registerUser(input: RegisterInput): Promise<AuthResult> {
  const err = validateRegister(input);
  if (err) return { ok: false, code: "validation_error", message: err };

  const email = input.email.trim().toLowerCase();
  const name = input.name.trim();
  const pool = getPool();

  const dup = await pool.query(`SELECT id FROM users WHERE email = $1 LIMIT 1`, [
    email,
  ]);
  if (dup.rows[0]) {
    return {
      ok: false,
      code: "email_taken",
      message: "An account with this email already exists",
    };
  }

  const passwordHash = await bcrypt.hash(input.password, env.BCRYPT_ROUNDS);
  const id = randomUUID();
  const { rows } = await pool.query(
    `INSERT INTO users (id, name, email, password_hash, created_at, updated_at)
     VALUES ($1, $2, $3, $4, NOW(), NOW())
     RETURNING id, name, email`,
    [id, name, email, passwordHash],
  );
  const user = rows[0] as { id: string; name: string; email: string };

  const publicUser = toPublicUser(user);
  const token = signToken(publicUser);
  return { ok: true, user: publicUser, ...(token ? { token } : {}) };
}

export async function loginUser(input: LoginInput): Promise<AuthResult> {
  const err = validateLogin(input);
  if (err) return { ok: false, code: "validation_error", message: err };

  const email = input.email.trim().toLowerCase();
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT id, name, email, password_hash FROM users WHERE email = $1 LIMIT 1`,
    [email],
  );
  const row = rows[0] as
    | { id: string; name: string; email: string; password_hash: string }
    | undefined;

  if (!row) {
    return {
      ok: false,
      code: "invalid_credentials",
      message: "Invalid email or password",
    };
  }

  const match = await bcrypt.compare(input.password, row.password_hash);
  if (!match) {
    return {
      ok: false,
      code: "invalid_credentials",
      message: "Invalid email or password",
    };
  }

  const publicUser = toPublicUser(row);
  const token = signToken(publicUser);
  return { ok: true, user: publicUser, ...(token ? { token } : {}) };
}
