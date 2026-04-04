import { getPool } from "../db/pool";
import type { Salary, SalaryRow } from "../db/types";
import type { DocumentAiPayslipExtracted } from "../gcp/documentai.extract";

export interface SalaryComparison {
  month_a: string;
  month_b: string;
  month_a_record: Salary;
  month_b_record: Salary;
  deltas: {
    basic: number | null;
    hra: number | null;
    tax: number | null;
    pf: number | null;
    gross: number | null;
    net_estimate: number | null;
  };
}

const SALARY_SELECT = `
  SELECT
    salary_id AS id,
    user_id,
    year,
    month AS calendar_month,
    (year::text || '-' || lpad(month::text, 2, '0')) AS month,
    effective_work_days,
    days_in_month,
    lop,
    basic,
    hra,
    special_allowance,
    statutory_bonus,
    mobile_allowance,
    wellness_allowance,
    employee_pf AS pf,
    total_deductions,
    income_tax_tds AS tax,
    total_earnings,
    net_pay,
    medical_reimbursement,
    petrol_reimbursement,
    internet_reimbursement,
    meal_voucher_reversal,
    meal_reimbursement,
    total_reimbursements,
    created_at
  FROM salaries
`;

function n(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "string" && v.trim() === "") return null;
  const x = Number(v);
  return Number.isFinite(x) ? x : null;
}

function ni(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const x = Number(v);
  return Number.isFinite(x) ? x : null;
}

function mapSalary(r: Record<string, unknown>): SalaryRow {
  return {
    id: Number(r.id),
    userId: String(r.user_id),
    year: Number(r.year),
    calendarMonth: Number(r.calendar_month),
    month: String(r.month),
    effectiveWorkDays: ni(r.effective_work_days),
    daysInMonth: ni(r.days_in_month),
    lop: ni(r.lop),
    basic: n(r.basic),
    hra: n(r.hra),
    specialAllowance: n(r.special_allowance),
    statutoryBonus: n(r.statutory_bonus),
    mobileAllowance: n(r.mobile_allowance),
    wellnessAllowance: n(r.wellness_allowance),
    pf: n(r.pf),
    totalDeductions: n(r.total_deductions),
    tax: n(r.tax),
    totalEarnings: n(r.total_earnings),
    netPay: n(r.net_pay),
    medicalReimbursement: n(r.medical_reimbursement),
    petrolReimbursement: n(r.petrol_reimbursement),
    internetReimbursement: n(r.internet_reimbursement),
    mealVoucherReversal: n(r.meal_voucher_reversal),
    mealReimbursement: n(r.meal_reimbursement),
    totalReimbursements: n(r.total_reimbursements),
    createdAt:
      r.created_at instanceof Date
        ? r.created_at.toISOString()
        : r.created_at != null
          ? String(r.created_at)
          : null,
  };
}

function parseMonthKey(key: string): { y: number; m: number } | null {
  const t = key.trim();
  const m = /^(\d{4})-(\d{1,2})$/.exec(t);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  if (mo < 1 || mo > 12) return null;
  return { y, m: mo };
}

function deltaNullable(a: number | null, b: number | null): number | null {
  if (a == null || b == null) return null;
  return b - a;
}

/** Gross: prefers total_earnings; else sums known earning components (null parts treated as 0 only when at least one earning exists). */
export function salaryGross(s: Salary): number | null {
  if (s.totalEarnings != null) return s.totalEarnings;
  const parts = [
    s.basic,
    s.hra,
    s.specialAllowance,
    s.statutoryBonus,
    s.mobileAllowance,
    s.wellnessAllowance,
  ];
  if (parts.every((x) => x == null)) return null;
  let sum = 0;
  for (const x of parts) sum += x ?? 0;
  return sum;
}

/** Net: prefers net_pay; else gross minus deductions when enough is known. */
export function salaryNetEstimate(s: Salary): number | null {
  if (s.netPay != null) return s.netPay;
  const g = salaryGross(s);
  if (g == null) return null;
  if (s.totalDeductions != null) return Math.max(g - s.totalDeductions, 0);
  if (s.tax == null && s.pf == null) return null;
  return Math.max(g - (s.tax ?? 0) - (s.pf ?? 0), 0);
}

function grossNet(s: Salary): {
  gross: number | null;
  net_estimate: number | null;
} {
  return { gross: salaryGross(s), net_estimate: salaryNetEstimate(s) };
}

export class PayrollService {
  async getSalaryByUserId(userId: string): Promise<Salary[]> {
    const pool = getPool();
    const { rows } = await pool.query(
      `${SALARY_SELECT}
       WHERE user_id = $1
       ORDER BY year ASC, month ASC`,
      [userId],
    );
    return rows.map((r) => mapSalary(r as Record<string, unknown>));
  }

  async getSalaryByMonth(
    userId: string,
    monthKey: string,
  ): Promise<Salary | null> {
    const parsed = parseMonthKey(monthKey);
    if (!parsed) return null;
    const pool = getPool();
    const { rows } = await pool.query(
      `${SALARY_SELECT}
       WHERE user_id = $1 AND year = $2 AND month = $3
       LIMIT 1`,
      [userId, parsed.y, parsed.m],
    );
    return rows[0] ? mapSalary(rows[0] as Record<string, unknown>) : null;
  }

  /**
   * Upsert from payslip extraction. Unknown fields stay NULL; existing row values are kept on conflict when new value is NULL.
   */
  async upsertSalaryFromExtract(
    userId: string,
    extracted: DocumentAiPayslipExtracted,
  ): Promise<{ saved: boolean; salary?: Salary }> {
    const monthKey = extracted.month;
    const basic = extracted.basic;
    if (!monthKey || basic == null || Number.isNaN(basic)) {
      return { saved: false };
    }
    const parsed = parseMonthKey(monthKey);
    if (!parsed) return { saved: false };

    const hra = extracted.hra ?? null;
    const tax = extracted.tax ?? null;
    const pf = extracted.pf ?? null;
    const totalEarnings = extracted.grossEarnings ?? null;
    const netPay = extracted.netPay ?? null;
    const totalDeductions =
      tax != null && pf != null ? tax + pf : null;

    const pool = getPool();
    const { rows } = await pool.query(
      `INSERT INTO salaries (
        user_id, year, month,
        basic, hra, employee_pf, income_tax_tds,
        total_earnings, net_pay, total_deductions
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      ON CONFLICT (user_id, year, month) DO UPDATE SET
        basic = COALESCE(EXCLUDED.basic, salaries.basic),
        hra = COALESCE(EXCLUDED.hra, salaries.hra),
        employee_pf = COALESCE(EXCLUDED.employee_pf, salaries.employee_pf),
        income_tax_tds = COALESCE(EXCLUDED.income_tax_tds, salaries.income_tax_tds),
        total_earnings = COALESCE(EXCLUDED.total_earnings, salaries.total_earnings),
        net_pay = COALESCE(EXCLUDED.net_pay, salaries.net_pay),
        total_deductions = COALESCE(EXCLUDED.total_deductions, salaries.total_deductions)
      RETURNING
        salary_id AS id,
        user_id,
        year,
        month AS calendar_month,
        (year::text || '-' || lpad(month::text, 2, '0')) AS month,
        effective_work_days,
        days_in_month,
        lop,
        basic,
        hra,
        special_allowance,
        statutory_bonus,
        mobile_allowance,
        wellness_allowance,
        employee_pf AS pf,
        total_deductions,
        income_tax_tds AS tax,
        total_earnings,
        net_pay,
        medical_reimbursement,
        petrol_reimbursement,
        internet_reimbursement,
        meal_voucher_reversal,
        meal_reimbursement,
        total_reimbursements,
        created_at`,
      [
        userId,
        parsed.y,
        parsed.m,
        basic,
        hra,
        pf,
        tax,
        totalEarnings,
        netPay,
        totalDeductions,
      ],
    );
    return { saved: true, salary: mapSalary(rows[0] as Record<string, unknown>) };
  }

  async compareTwoMonths(
    userId: string,
    monthA: string,
    monthB: string,
  ): Promise<SalaryComparison> {
    const [a, b] = await Promise.all([
      this.getSalaryByMonth(userId, monthA),
      this.getSalaryByMonth(userId, monthB),
    ]);

    if (!a) {
      throw new Error(`No salary record for month ${monthA}`);
    }
    if (!b) {
      throw new Error(`No salary record for month ${monthB}`);
    }

    const ga = grossNet(a);
    const gb = grossNet(b);

    return {
      month_a: monthA,
      month_b: monthB,
      month_a_record: a,
      month_b_record: b,
      deltas: {
        basic: deltaNullable(a.basic, b.basic),
        hra: deltaNullable(a.hra, b.hra),
        tax: deltaNullable(a.tax, b.tax),
        pf: deltaNullable(a.pf, b.pf),
        gross: deltaNullable(ga.gross, gb.gross),
        net_estimate: deltaNullable(ga.net_estimate, gb.net_estimate),
      },
    };
  }
}

export const payrollService = new PayrollService();
