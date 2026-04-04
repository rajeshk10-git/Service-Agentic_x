import { SECTION_80C_CAP_INR, taxService } from "./tax.service";

describe("TaxService.simulateSection80CSavings", () => {
  it("old regime: savings non-negative when modeling 80C vs zero", () => {
    const other = { standardDeduction: 50_000 };
    const r = taxService.simulateSection80CSavings(1_200_000, "old", other, {
      maximize80C: true,
    });
    expect(r.kind).toBe("old_regime_80c");
    if (r.kind === "old_regime_80c") {
      expect(r.section_80c_modeled).toBe(SECTION_80C_CAP_INR);
      expect(r.total_tax_savings).toBeGreaterThanOrEqual(0);
      expect(r.baseline_zero_80c.totalTax).toBeGreaterThanOrEqual(
        r.with_section_80c.totalTax,
      );
    }
  });

  it("new regime: returns explanation without 80C comparison", () => {
    const r = taxService.simulateSection80CSavings(800_000, "new", {}, {
      maximize80C: true,
    });
    expect(r.kind).toBe("new_regime_no_80c");
    if (r.kind === "new_regime_no_80c") {
      expect(r.tax_estimate.regime).toBe("new");
      expect(r.message.length).toBeGreaterThan(20);
    }
  });
});

describe("TaxService.compareRegimes", () => {
  it("returns old, new, and a lower_tax_regime", () => {
    const r = taxService.compareRegimes(
      1_200_000,
      {
        standardDeduction: 50_000,
        section80C: 150_000,
        hra: 100_000,
      },
      50_000,
    );
    expect(r.old_regime.regime).toBe("old");
    expect(r.new_regime.regime).toBe("new");
    expect(["old", "new", "tie"]).toContain(r.lower_tax_regime);
    expect(r.annual_tax_savings_inr_if_choose_lower).toBeGreaterThanOrEqual(0);
  });
});
