-- PostgreSQL schema. Run once on a fresh database.

CREATE TABLE IF NOT EXISTS users (
    id TEXT NOT NULL PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Monthly salary: org-specific fields may be NULL when that component does not apply or is unknown.
-- Only keys are required; amounts are optional (NULL ≠ 0).
CREATE TABLE IF NOT EXISTS salaries (
    salary_id SERIAL PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    year INTEGER NOT NULL,
    month INTEGER NOT NULL CHECK (month BETWEEN 1 AND 12),

    effective_work_days INTEGER,
    days_in_month INTEGER,
    lop INTEGER,

    basic NUMERIC(12, 2),
    hra NUMERIC(12, 2),
    special_allowance NUMERIC(12, 2),
    statutory_bonus NUMERIC(12, 2),
    mobile_allowance NUMERIC(12, 2),
    wellness_allowance NUMERIC(12, 2),

    employee_pf NUMERIC(12, 2),
    total_deductions NUMERIC(12, 2),
    income_tax_tds NUMERIC(12, 2),

    total_earnings NUMERIC(12, 2),
    net_pay NUMERIC(12, 2),

    medical_reimbursement NUMERIC(12, 2),
    petrol_reimbursement NUMERIC(12, 2),
    internet_reimbursement NUMERIC(12, 2),
    meal_voucher_reversal NUMERIC(12, 2),
    meal_reimbursement NUMERIC(12, 2),

    total_reimbursements NUMERIC(12, 2),

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    UNIQUE (user_id, year, month)
);

CREATE INDEX IF NOT EXISTS salaries_user_id_idx ON salaries (user_id);
CREATE INDEX IF NOT EXISTS salaries_user_year_month_idx ON salaries (user_id, year, month);

CREATE TABLE IF NOT EXISTS "Feedback" (
    id SERIAL NOT NULL PRIMARY KEY,
    query TEXT NOT NULL,
    response TEXT NOT NULL,
    rating INTEGER,
    user_id TEXT,
    comment TEXT
);

-- Append-only chat log per user session (UUID groups turns in one conversation).
CREATE TABLE IF NOT EXISTS chat_history (
    chat_id SERIAL PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    session_id UUID NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
    message TEXT NOT NULL,
    created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS chat_history_user_session_idx
    ON chat_history (user_id, session_id, created_at);
