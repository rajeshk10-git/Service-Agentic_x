import { RagService } from "./rag.service";
import type { Salary } from "../db/types";

function makeSalary(month: string, basic: number, hra: number, tax: number, pf: number): Salary {
  return { id: 0, userId: "u1", month, basic, hra, tax, pf };
}

describe("RagService", () => {
  let rag: RagService;

  beforeEach(() => {
    rag = new RagService();
  });

  describe("indexFromSalaryRecords + search", () => {
    it("returns matching docs when query tokens overlap document tokens", async () => {
      await rag.indexFromSalaryRecords("u1", [
        makeSalary("2025-01", 50000, 20000, 5000, 1800),
        makeSalary("2025-02", 52000, 21000, 5200, 1900),
      ]);

      const hits = await rag.search("u1", "basic tax january");
      expect(hits.length).toBeGreaterThan(0);
      expect(hits[0].source).toBe("keyword");
      expect(hits[0].score).toBeGreaterThan(0);
    });

    it("returns fallback docs for empty query", async () => {
      await rag.indexFromSalaryRecords("u1", [
        makeSalary("2025-01", 50000, 20000, 5000, 1800),
      ]);

      const hits = await rag.search("u1", "");
      expect(hits.length).toBeGreaterThan(0);
      expect(hits[0].score).toBe(0.01);
    });

    it("returns fallback listing when no tokens match", async () => {
      await rag.indexFromSalaryRecords("u1", [
        makeSalary("2025-01", 50000, 20000, 5000, 1800),
      ]);

      const hits = await rag.search("u1", "xyzzynoexist abcnotfound");
      expect(hits.length).toBe(1);
      expect(hits[0].score).toBe(1);
    });

    it("returns empty array for unknown user", async () => {
      const hits = await rag.search("unknown-user", "basic");
      expect(hits).toEqual([]);
    });

    it("respects topK limit", async () => {
      const records = Array.from({ length: 10 }, (_, i) =>
        makeSalary(`2025-${String(i + 1).padStart(2, "0")}`, 50000 + i * 1000, 20000, 5000, 1800),
      );
      await rag.indexFromSalaryRecords("u1", records);

      const hits = await rag.search("u1", "basic", 3);
      expect(hits).toHaveLength(3);
    });

    it("ranks documents with more matching tokens higher", async () => {
      await rag.indexFromSalaryRecords("u1", [
        makeSalary("2025-01", 50000, 20000, 5000, 1800),
        makeSalary("2025-02", 52000, 21000, 5200, 1900),
      ]);

      const hits = await rag.search("u1", "payslip basic hra tax pf inr estimated net");
      expect(hits.length).toBe(2);
      expect(hits[0].score).toBeGreaterThanOrEqual(hits[1].score);
    });
  });

  describe("clearUser", () => {
    it("removes stored docs for user", async () => {
      await rag.indexFromSalaryRecords("u1", [
        makeSalary("2025-01", 50000, 20000, 5000, 1800),
      ]);
      rag.clearUser("u1");
      const hits = await rag.search("u1", "basic");
      expect(hits).toEqual([]);
    });

    it("does not throw for unknown user", () => {
      expect(() => rag.clearUser("nonexistent")).not.toThrow();
    });
  });
});
