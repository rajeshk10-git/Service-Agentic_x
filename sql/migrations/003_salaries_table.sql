-- Migrate legacy quoted "Salary" (userId + month YYYY-MM + basic/hra/tax/pf) → salaries.
-- Safe to run once; skips if salaries already has rows or "Salary" is missing.

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

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'Salary'
  ) AND NOT EXISTS (SELECT 1 FROM salaries LIMIT 1) THEN
    INSERT INTO salaries (
      user_id,
      year,
      month,
      basic,
      hra,
      employee_pf,
      income_tax_tds,
      total_earnings,
      net_pay,
      total_deductions
    )
    SELECT
      s."userId",
      split_part(s.month, '-', 1)::integer,
      split_part(s.month, '-', 2)::integer,
      s.basic::numeric,
      s.hra::numeric,
      s.pf::numeric,
      s.tax::numeric,
      GREATEST(s.basic + s.hra, 0)::numeric,
      GREATEST(s.basic + s.hra - s.tax - s.pf, 0)::numeric,
      GREATEST(s.tax + s.pf, 0)::numeric
    FROM "Salary" s
    WHERE s.month ~ '^\d{4}-\d{1,2}$'
      AND split_part(s.month, '-', 1) <> ''
      AND split_part(s.month, '-', 2) <> '';

    DROP TABLE "Salary";
  END IF;
END $$;
