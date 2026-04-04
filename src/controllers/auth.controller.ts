import type { Request, Response } from "express";
import { loginUser, registerUser } from "../services/auth.service";

interface RegisterBody {
  name?: string;
  email?: string;
  password?: string;
  /** Must equal `password` (same as Angular `passwordsMatch`). */
  confirm?: string;
}

interface LoginBody {
  email?: string;
  password?: string;
}

export async function postRegister(
  req: Request<object, unknown, RegisterBody>,
  res: Response,
): Promise<void> {
  const { name, email, password, confirm } = req.body ?? {};
  const result = await registerUser({
    name: typeof name === "string" ? name : "",
    email: typeof email === "string" ? email : "",
    password: typeof password === "string" ? password : "",
    confirm: typeof confirm === "string" ? confirm : "",
  });

  if (!result.ok) {
    const status =
      result.code === "email_taken"
        ? 409
        : result.code === "validation_error"
          ? 400
          : 400;
    res.status(status).json({
      success: false,
      code: result.code,
      error: result.message,
    });
    return;
  }

  res.status(201).json({
    success: true,
    user: result.user,
    ...(result.token ? { token: result.token } : {}),
  });
}

export async function postLogin(
  req: Request<object, unknown, LoginBody>,
  res: Response,
): Promise<void> {
  const { email, password } = req.body ?? {};
  const result = await loginUser({
    email: typeof email === "string" ? email : "",
    password: typeof password === "string" ? password : "",
  });

  if (!result.ok) {
    const status =
      result.code === "invalid_credentials"
        ? 401
        : result.code === "validation_error"
          ? 400
          : 400;
    res.status(status).json({
      success: false,
      code: result.code,
      error: result.message,
    });
    return;
  }

  res.status(200).json({
    success: true,
    user: result.user,
    ...(result.token ? { token: result.token } : {}),
  });
}
