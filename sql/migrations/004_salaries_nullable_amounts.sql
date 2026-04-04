-- Relax salary amount columns to NULL when an org does not use that component (already nullable on new installs).
-- Run after 003 if your salaries table was created with NOT NULL ... DEFAULT 0.

ALTER TABLE salaries ALTER COLUMN basic DROP NOT NULL;
ALTER TABLE salaries ALTER COLUMN hra DROP NOT NULL;
ALTER TABLE salaries ALTER COLUMN special_allowance DROP NOT NULL;
ALTER TABLE salaries ALTER COLUMN statutory_bonus DROP NOT NULL;
ALTER TABLE salaries ALTER COLUMN mobile_allowance DROP NOT NULL;
ALTER TABLE salaries ALTER COLUMN wellness_allowance DROP NOT NULL;

ALTER TABLE salaries ALTER COLUMN employee_pf DROP NOT NULL;
ALTER TABLE salaries ALTER COLUMN total_deductions DROP NOT NULL;
ALTER TABLE salaries ALTER COLUMN income_tax_tds DROP NOT NULL;

ALTER TABLE salaries ALTER COLUMN total_earnings DROP NOT NULL;
ALTER TABLE salaries ALTER COLUMN net_pay DROP NOT NULL;

ALTER TABLE salaries ALTER COLUMN medical_reimbursement DROP NOT NULL;
ALTER TABLE salaries ALTER COLUMN petrol_reimbursement DROP NOT NULL;
ALTER TABLE salaries ALTER COLUMN internet_reimbursement DROP NOT NULL;
ALTER TABLE salaries ALTER COLUMN meal_voucher_reversal DROP NOT NULL;
ALTER TABLE salaries ALTER COLUMN meal_reimbursement DROP NOT NULL;

ALTER TABLE salaries ALTER COLUMN total_reimbursements DROP NOT NULL;
