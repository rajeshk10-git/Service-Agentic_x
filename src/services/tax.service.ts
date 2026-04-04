// Indian Income Tax Calculation Service (FY 2025-26)
// Supports Old and New regimes, deductions, and rebate 87A

export type TaxRegime = "old" | "new";

export interface Deductions {
  standardDeduction?: number;
  section80C?: number;
  section80D?: number;
  hra?: number;
  lta?: number;
  housingLoanInterest?: number;
  other?: number;
}

export interface TaxResult {
  taxableIncome: number;
  regime: TaxRegime;
  taxBeforeRebate: number;
  rebate87A: number;
  taxAfterRebate: number;
  cess: number;
  totalTax: number;
  breakdown: { slab: string; amount: number }[];
}

/** Statutory cap for Section 80C (combined specified instruments) — FY-agnostic for MVP. */
export const SECTION_80C_CAP_INR = 150_000;

export type DeductionsWithout80C = Omit<Deductions, "section80C">;

/** What-if: tax with ₹0 under 80C vs with a capped 80C amount (old regime only). */
export interface Section80CSimulationOldRegime {
  kind: "old_regime_80c";
  annual_gross: number;
  section_80c_cap_inr: number;
  section_80c_modeled: number;
  baseline_zero_80c: TaxResult;
  with_section_80c: TaxResult;
  total_tax_savings: number;
}

/** New regime does not allow 80C in this model — return tax estimate + explanation. */
export interface Section80CSimulationNewRegime {
  kind: "new_regime_no_80c";
  message: string;
  tax_estimate: TaxResult;
}

/** Side-by-side old vs new regime (same gross; old uses full Chapter VI-A style deductions in this model). */
export interface RegimeComparisonResult {
  annual_gross: number;
  old_regime: TaxResult;
  new_regime: TaxResult;
  /** Regime with lower total tax (incl. cess), or tie. */
  lower_tax_regime: "old" | "new" | "tie";
  /** How much less tax per year if you pick the cheaper regime (0 if tie). */
  annual_tax_savings_inr_if_choose_lower: number;
  /** old.totalTax - new.totalTax (positive ⇒ new regime has lower total tax). */
  old_minus_new_total_tax: number;
}

export class TaxService {
  private readonly newRegimeSlabs = [
    { upTo: 300_000, rate: 0 },
    { upTo: 700_000, rate: 0.05 },
    { upTo: 1_000_000, rate: 0.1 },
    { upTo: 1_200_000, rate: 0.15 },
    { upTo: 1_500_000, rate: 0.2 },
    { upTo: Infinity, rate: 0.3 },
  ];

  private readonly oldRegimeSlabs = [
    { upTo: 250_000, rate: 0 },
    { upTo: 500_000, rate: 0.05 },
    { upTo: 1_000_000, rate: 0.2 },
    { upTo: Infinity, rate: 0.3 },
  ];

  calculateTax(
    income: number,
    deductions: Deductions = {},
    regime: TaxRegime = "new",
  ): TaxResult {
    let taxableIncome = income;
    if (regime === "old") {
      const totalDeductions =
        (deductions.standardDeduction ?? 0) +
        (deductions.section80C ?? 0) +
        (deductions.section80D ?? 0) +
        (deductions.hra ?? 0) +
        (deductions.lta ?? 0) +
        (deductions.housingLoanInterest ?? 0) +
        (deductions.other ?? 0);

      taxableIncome = Math.max(income - totalDeductions, 0);
    } else {
      taxableIncome = Math.max(
        income - (deductions.standardDeduction ?? 0),
        0,
      );
    }

    const slabs = regime === "old" ? this.oldRegimeSlabs : this.newRegimeSlabs;

    let tax = 0;
    let prevLimit = 0;
    const breakdown: { slab: string; amount: number }[] = [];

    for (const slab of slabs) {
      if (taxableIncome > slab.upTo) {
        const slabTax = (slab.upTo - prevLimit) * slab.rate;
        tax += slabTax;
        breakdown.push({
          slab: `${prevLimit + 1} - ${slab.upTo}`,
          amount: slabTax,
        });
        prevLimit = slab.upTo;
      } else {
        const slabTax = (taxableIncome - prevLimit) * slab.rate;
        tax += slabTax;
        breakdown.push({
          slab: `${prevLimit + 1} - ${taxableIncome}`,
          amount: slabTax,
        });
        break;
      }
    }

    let rebate87A = 0;
    if (regime === "new" && taxableIncome <= 700_000) {
      rebate87A = tax;
    } else if (regime === "old" && taxableIncome <= 500_000) {
      rebate87A = Math.min(tax, 12_500);
    }

    const taxAfterRebate = Math.max(tax - rebate87A, 0);

    const cess = taxAfterRebate * 0.04;
    const totalTax = taxAfterRebate + cess;

    return {
      taxableIncome,
      regime,
      taxBeforeRebate: tax,
      rebate87A,
      taxAfterRebate,
      cess,
      totalTax,
      breakdown,
    };
  }

  /**
   * MVP tax simulation: under **old** regime, compare total tax (incl. cess) with Section 80C = 0
   * vs with 80C = min(proposed, cap). Under **new** regime, 80C is not modeled — returns
   * a normal new-regime estimate and an explanatory message.
   */
  simulateSection80CSavings(
    income: number,
    regime: TaxRegime,
    otherDeductions: DeductionsWithout80C,
    opts: {
      /** If true, model full ₹1.5L 80C (within cap). */
      maximize80C: boolean;
      /** Used when maximize80C is false; clamped to [0, cap]. */
      proposed80C?: number;
    },
  ): Section80CSimulationOldRegime | Section80CSimulationNewRegime {
    if (regime === "new") {
      const deductions: Deductions = {
        ...otherDeductions,
      };
      return {
        kind: "new_regime_no_80c",
        message:
          "Section 80C (and most Chapter VI-A deductions) are not available under the new tax regime in this calculator. The estimate below is for the new regime only. To see indicative 80C tax savings, run simulate_tax with regime old.",
        tax_estimate: this.calculateTax(income, deductions, "new"),
      };
    }

    let section80C = SECTION_80C_CAP_INR;
    if (!opts.maximize80C) {
      const p =
        typeof opts.proposed80C === "number" && !Number.isNaN(opts.proposed80C)
          ? opts.proposed80C
          : 0;
      section80C = Math.min(Math.max(0, p), SECTION_80C_CAP_INR);
    }

    const base: Deductions = { ...otherDeductions, section80C: 0 };
    const with80c: Deductions = { ...otherDeductions, section80C };

    const baseline_zero_80c = this.calculateTax(income, base, "old");
    const with_section_80c = this.calculateTax(income, with80c, "old");
    const total_tax_savings =
      baseline_zero_80c.totalTax - with_section_80c.totalTax;

    return {
      kind: "old_regime_80c",
      annual_gross: income,
      section_80c_cap_inr: SECTION_80C_CAP_INR,
      section_80c_modeled: section80C,
      baseline_zero_80c,
      with_section_80c,
      total_tax_savings: Math.max(0, total_tax_savings),
    };
  }

  /**
   * Compare total tax (incl. cess) under old vs new regime for the same gross income.
   * New regime uses only standard deduction in this model; old uses the provided `Deductions`.
   */
  compareRegimes(
    income: number,
    oldDeductions: Deductions,
    newStandardDeduction: number,
  ): RegimeComparisonResult {
    const old_regime = this.calculateTax(income, oldDeductions, "old");
    const new_regime = this.calculateTax(
      income,
      { standardDeduction: newStandardDeduction },
      "new",
    );
    const diff = old_regime.totalTax - new_regime.totalTax;
    const eps = 0.01;
    let lower_tax_regime: "old" | "new" | "tie";
    if (Math.abs(diff) < eps) {
      lower_tax_regime = "tie";
    } else if (diff > 0) {
      lower_tax_regime = "new";
    } else {
      lower_tax_regime = "old";
    }
    const annual_tax_savings_inr_if_choose_lower =
      lower_tax_regime === "tie"
        ? 0
        : Math.abs(diff);

    return {
      annual_gross: income,
      old_regime,
      new_regime,
      lower_tax_regime,
      annual_tax_savings_inr_if_choose_lower,
      old_minus_new_total_tax: diff,
    };
  }
}

export const taxService = new TaxService();
