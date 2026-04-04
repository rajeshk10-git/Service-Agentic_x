/**
 * Row shape for Postgres `salaries`.
 * Amount fields are `number | null`: null means unknown or not used for that org (distinct from 0).
 */
export type SalaryRow = {
  id: number;
  userId: string;
  year: number;
  calendarMonth: number;
  /** YYYY-MM, derived from year + calendarMonth */
  month: string;

  effectiveWorkDays: number | null;
  daysInMonth: number | null;
  lop: number | null;

  basic: number | null;
  hra: number | null;
  specialAllowance: number | null;
  statutoryBonus: number | null;
  mobileAllowance: number | null;
  wellnessAllowance: number | null;

  pf: number | null;
  totalDeductions: number | null;
  tax: number | null;

  totalEarnings: number | null;
  netPay: number | null;

  medicalReimbursement: number | null;
  petrolReimbursement: number | null;
  internetReimbursement: number | null;
  mealVoucherReversal: number | null;
  mealReimbursement: number | null;
  totalReimbursements: number | null;

  createdAt: string | null;
};

/** Alias used across services (legacy name). */
export type Salary = SalaryRow;
