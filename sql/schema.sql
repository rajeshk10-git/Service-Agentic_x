-- PostgreSQL schema (matches former Prisma models). Run once on a fresh database.

CREATE TABLE IF NOT EXISTS users (
    id TEXT NOT NULL PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS "Salary" (
    id SERIAL NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    month TEXT NOT NULL,
    basic DOUBLE PRECISION NOT NULL,
    hra DOUBLE PRECISION NOT NULL,
    tax DOUBLE PRECISION NOT NULL,
    pf DOUBLE PRECISION NOT NULL
);

CREATE INDEX IF NOT EXISTS "Salary_userId_idx" ON "Salary" ("userId");
CREATE INDEX IF NOT EXISTS "Salary_userId_month_idx" ON "Salary" ("userId", month);

CREATE TABLE IF NOT EXISTS "Feedback" (
    id SERIAL NOT NULL PRIMARY KEY,
    query TEXT NOT NULL,
    response TEXT NOT NULL,
    rating INTEGER NOT NULL
);
