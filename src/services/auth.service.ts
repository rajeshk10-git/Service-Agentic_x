import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { env } from "../config/env";
import { prisma } from "../db/prisma";

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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

function validateRegister(input: RegisterInput): string | null {
  if (!input.name?.trim()) return "Name is required";
  if (input.name.length > 200) return "Name is too long";
  if (!input.email?.trim()) return "Email is required";
  if (!EMAIL_REGEX.test(input.email.trim().toLowerCase())) {
    return "Invalid email format";
  }
  if (!input.password || input.password.length < 8) {
    return "Password must be at least 8 characters";
  }
  if (input.password.length > 128) return "Password is too long";
  return null;
}

function validateLogin(input: LoginInput): string | null {
  if (!input.email?.trim()) return "Email is required";
  if (!input.password) return "Password is required";
  return null;
}

function signToken(user: PublicUser): string | undefined {
  if (!env.JWT_SECRET.trim()) return undefined;
  return jwt.sign(
    { sub: user.id, email: user.email },
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

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    return {
      ok: false,
      code: "email_taken",
      message: "An account with this email already exists",
    };
  }

  const passwordHash = await bcrypt.hash(input.password, env.BCRYPT_ROUNDS);
  const user = await prisma.user.create({
    data: { name, email, passwordHash },
    select: { id: true, name: true, email: true },
  });

  const publicUser = toPublicUser(user);
  const token = signToken(publicUser);
  return { ok: true, user: publicUser, ...(token ? { token } : {}) };
}

export async function loginUser(input: LoginInput): Promise<AuthResult> {
  const err = validateLogin(input);
  if (err) return { ok: false, code: "validation_error", message: err };

  const email = input.email.trim().toLowerCase();
  const row = await prisma.user.findUnique({
    where: { email },
    select: { id: true, name: true, email: true, passwordHash: true },
  });

  if (!row) {
    return {
      ok: false,
      code: "invalid_credentials",
      message: "Invalid email or password",
    };
  }

  const match = await bcrypt.compare(input.password, row.passwordHash);
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
