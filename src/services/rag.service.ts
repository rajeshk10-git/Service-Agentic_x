import type { Salary } from "../db/types";

export interface RagHit {
  id: string;
  text: string;
  score: number;
  source: "keyword";
}

interface StoredDoc {
  id: string;
  text: string;
}

/**
 * In-memory keyword retrieval over salary rows mirrored from Postgres.
 * Authoritative data remains in the database; this only ranks snippets for the LLM context.
 */
export class RagService {
  private readonly store = new Map<string, StoredDoc[]>();

  async indexFromSalaryRecords(
    userId: string,
    records: Salary[],
  ): Promise<void> {
    const salaryDocs: StoredDoc[] = records.map((r, i) => ({
      id: `salary-${r.month}-${i}`,
      text: `Payslip context ${r.month}: Basic INR ${r.basic}, HRA INR ${r.hra}, TDS/Tax INR ${r.tax}, PF INR ${r.pf}. Gross (basic+hra) INR ${r.basic + r.hra}. Estimated net after tax and PF INR ${r.basic + r.hra - r.tax - r.pf}.`,
    }));
    this.store.set(userId, salaryDocs);
  }

  async search(userId: string, query: string, topK = 5): Promise<RagHit[]> {
    const docs = this.store.get(userId) ?? [];
    const merged = new Map<string, RagHit>();

    const qTokens = tokenize(query);
    for (const d of docs) {
      let score = 0;
      if (qTokens.length > 0) {
        const docTokens = tokenize(d.text);
        const docSet = new Set(docTokens);
        for (const t of qTokens) {
          if (docSet.has(t)) score += 1;
        }
      } else {
        score = 0.01;
      }
      if (score > 0) {
        merged.set(d.id, {
          id: d.id,
          text: d.text,
          score,
          source: "keyword",
        });
      }
    }

    const ranked = [...merged.values()]
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);

    if (ranked.length === 0 && docs.length > 0) {
      return docs.slice(0, topK).map((d, idx) => ({
        id: d.id,
        text: d.text,
        score: 1 / (idx + 1),
        source: "keyword" as const,
      }));
    }

    return ranked;
  }

  clearUser(userId: string): void {
    this.store.delete(userId);
  }
}

function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .split(/[^a-z0-9%]+/u)
    .filter((t) => t.length > 1);
}

export const ragService = new RagService();
