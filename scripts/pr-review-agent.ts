/**
 * Gemini-powered PR Review Agent.
 *
 * Uses the Gemini REST API directly (no SDK dependency).
 * Runs in GitHub Actions on pull requests targeting main.
 */

import { execSync } from "child_process";
import { existsSync, readFileSync } from "fs";
import https from "https";

const GEMINI_API_KEY = process.env.GEMINI_API_KEY ?? "";
const GITHUB_TOKEN = process.env.GITHUB_TOKEN ?? "";
const PR_NUMBER = process.env.PR_NUMBER ?? "";
const BASE_SHA = process.env.BASE_SHA ?? "";
const HEAD_SHA = process.env.HEAD_SHA ?? "";
const REPO = process.env.REPO ?? "";

if (!GEMINI_API_KEY || !GITHUB_TOKEN || !PR_NUMBER || !REPO) {
  console.error(
    "Missing required env vars: GEMINI_API_KEY, GITHUB_TOKEN, PR_NUMBER, REPO",
  );
  process.exit(1);
}

const GEMINI_URL =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent";
const GH_API = `https://api.github.com/repos/${REPO}`;

// ─── Types for Gemini REST API ─────────────────────────────────────

interface GeminiPart {
  text?: string;
  functionCall?: { name: string; args: Record<string, string> };
  functionResponse?: { name: string; response: Record<string, unknown> };
}

interface GeminiContent {
  role: string;
  parts: GeminiPart[];
}

interface GeminiResponse {
  candidates?: Array<{
    content?: { parts?: GeminiPart[] };
    finishReason?: string;
  }>;
  error?: { message?: string };
}

// ─── Strict rules & system prompt ──────────────────────────────────

const STRICT_RULES = `
STRICT CODE REVIEW RULES — flag violations as CRITICAL:
1. No \`any\` type usage in TypeScript (use proper types or \`unknown\`)
2. All async functions must have proper try/catch with logging via the project logger (\`utils/logger.ts\`)
3. No \`console.log\` / \`console.error\` — must use the project \`logger\` utility (import from \`../utils/logger\`)
4. No hardcoded credentials, secrets, API keys, or connection strings
5. SQL queries must use parameterized queries ($1, $2…) — no string concatenation
6. All controller endpoints must validate inputs before processing
7. Test files (.test.ts) required for all new/modified service and utility files
8. No unused imports or variables
`;

const SYSTEM_PROMPT = `You are a senior Node.js/TypeScript engineer acting as an autonomous PR review agent on GitHub.

This project is a TypeScript Express backend (Financial Wellness AI Agent).
Test framework: Jest + ts-jest + supertest.
Test files follow: src/path/file.ts → src/path/file.test.ts

${STRICT_RULES}

For every pull request, follow these steps IN ORDER using your tools:

1. Call list_changed_files to see what changed.
2. For each changed .ts file inside src/ (skip .test.ts files):
   a. Call get_diff to understand what changed.
   b. Call check_test_exists to see if a test file exists for that source file.
   c. If NO test file exists and the file is a service, utility, or controller:
      call read_file on the source file, then call suggest_test_file with a complete Jest test.
3. If a junit.xml test report exists, call read_test_results to get test results.
4. After reviewing ALL files, call post_review_comment ONCE with this structured summary:

## PR Review Summary

**Changed files:**
- <bulleted list of files>

**Code Review:**
- CRITICAL: <strict rule violations with file:line references>
- WARNING: <potential issues — missing null checks, error handling gaps, type safety>
- INFO: <suggestions — naming, structure, performance>

**Test Coverage:**
- Existing tests: X passed, Y failed (from junit.xml if available)
- Missing tests for: <list of src files without .test.ts>
- Generated test suggestions: <count>

**Recommendation:** APPROVE / REQUEST CHANGES

Rules for generated Jest tests:
- Use describe() and it() blocks
- Mock external dependencies (database, GCP services, HTTP calls)
- Use jest.mock() for module mocking
- Test validation logic, error branches, and happy paths
- Import from relative paths matching project structure

When all actions are complete, output exactly: DONE`;

// ─── Tool declarations (Gemini REST format) ────────────────────────

const TOOL_DECLARATIONS = [
  {
    name: "list_changed_files",
    description: "List all files changed in this pull request.",
    parameters: { type: "OBJECT" as const, properties: {} },
  },
  {
    name: "get_diff",
    description: "Get the git diff for a specific changed file.",
    parameters: {
      type: "OBJECT" as const,
      properties: { file_path: { type: "STRING" as const, description: "Path to the file" } },
      required: ["file_path"],
    },
  },
  {
    name: "read_file",
    description: "Read the current full content of a file in the repository.",
    parameters: {
      type: "OBJECT" as const,
      properties: { file_path: { type: "STRING" as const, description: "Path to the file" } },
      required: ["file_path"],
    },
  },
  {
    name: "check_test_exists",
    description: "Check if a .test.ts file exists for a given source file.",
    parameters: {
      type: "OBJECT" as const,
      properties: { file_path: { type: "STRING" as const, description: "Source file path" } },
      required: ["file_path"],
    },
  },
  {
    name: "read_test_results",
    description: "Read JUnit XML test results from the CI test run.",
    parameters: { type: "OBJECT" as const, properties: {} },
  },
  {
    name: "post_review_comment",
    description: "Post a markdown review comment on the GitHub pull request.",
    parameters: {
      type: "OBJECT" as const,
      properties: { body: { type: "STRING" as const, description: "Markdown comment body" } },
      required: ["body"],
    },
  },
  {
    name: "suggest_test_file",
    description: "Post an AI-generated Jest test file suggestion as a PR comment.",
    parameters: {
      type: "OBJECT" as const,
      properties: {
        file_path: { type: "STRING" as const, description: "Source file being tested" },
        content: { type: "STRING" as const, description: "Complete .test.ts file content" },
      },
      required: ["file_path", "content"],
    },
  },
];

// ─── Tool implementations ──────────────────────────────────────────

function listChangedFiles(): string {
  if (BASE_SHA && HEAD_SHA) {
    const result = execSync(`git diff --name-only ${BASE_SHA} ${HEAD_SHA}`, {
      encoding: "utf-8",
    });
    return result.trim() || "No files changed.";
  }
  return "No BASE_SHA/HEAD_SHA available.";
}

function getDiff(filePath: string): string {
  if (!BASE_SHA || !HEAD_SHA) return "No BASE_SHA/HEAD_SHA available.";
  const result = execSync(
    `git diff ${BASE_SHA} ${HEAD_SHA} -- "${filePath}"`,
    { encoding: "utf-8" },
  );
  return result.slice(0, 8000) || "No diff found.";
}

function readFile(filePath: string): string {
  try {
    return readFileSync(filePath, "utf-8").slice(0, 8000);
  } catch {
    return `File not found: ${filePath}`;
  }
}

function checkTestExists(filePath: string): string {
  const testPath = filePath.replace(/\.ts$/, ".test.ts");
  return existsSync(testPath)
    ? `Test file exists: ${testPath}`
    : `No test file found. Expected: ${testPath}`;
}

function readTestResults(): string {
  const junitPath = "reports/junit.xml";
  if (!existsSync(junitPath)) return "No junit.xml test report found.";
  const xml = readFileSync(junitPath, "utf-8");
  const testsMatch = /tests="(\d+)"/.exec(xml);
  const failuresMatch = /failures="(\d+)"/.exec(xml);
  const errorsMatch = /errors="(\d+)"/.exec(xml);
  const tests = testsMatch?.[1] ?? "?";
  const failures = failuresMatch?.[1] ?? "0";
  const errors = errorsMatch?.[1] ?? "0";

  let summary = `Test results: ${tests} tests, ${failures} failures, ${errors} errors.`;
  if (Number(failures) > 0 || Number(errors) > 0) {
    const failedTests =
      xml.match(/<testcase[^>]*>[\s\S]*?<failure[\s\S]*?<\/testcase>/g) ?? [];
    for (const tc of failedTests.slice(0, 5)) {
      const nameMatch = /name="([^"]*)"/.exec(tc);
      const msgMatch = /message="([^"]*)"/.exec(tc);
      summary += `\nFAILED: ${nameMatch?.[1] ?? "unknown"}: ${msgMatch?.[1]?.slice(0, 200) ?? ""}`;
    }
  }
  return summary;
}

// ─── HTTP helpers ──────────────────────────────────────────────────

function httpsPost(
  url: string,
  body: unknown,
  headers: Record<string, string> = {},
): Promise<string> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const payload = JSON.stringify(body);
    const req = https.request(
      {
        hostname: parsed.hostname,
        path: parsed.pathname + parsed.search,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(payload),
          ...headers,
        },
      },
      (res) => {
        let data = "";
        res.on("data", (chunk: Buffer) => (data += chunk.toString()));
        res.on("end", () => {
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
            resolve(data);
          } else {
            reject(
              new Error(`HTTP ${res.statusCode}: ${data.slice(0, 500)}`),
            );
          }
        });
      },
    );
    req.on("error", reject);
    req.write(payload);
    req.end();
  });
}

async function postReviewComment(body: string): Promise<string> {
  try {
    await httpsPost(
      `${GH_API}/issues/${PR_NUMBER}/comments`,
      { body },
      {
        Authorization: `Bearer ${GITHUB_TOKEN}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "pr-review-agent",
      },
    );
    return "Review comment posted successfully.";
  } catch (err) {
    return `Failed to post comment: ${err instanceof Error ? err.message : String(err)}`;
  }
}

async function suggestTestFile(
  filePath: string,
  content: string,
): Promise<string> {
  const testPath = filePath.replace(/\.ts$/, ".test.ts");
  const comment =
    `### AI-Generated Test Suggestion for \`${filePath}\`\n\n` +
    `No test file found. Suggested: \`${testPath}\`\n\n` +
    `\`\`\`typescript\n${content}\n\`\`\`\n\n` +
    `> Generated by PR Review Agent (Gemini). Review and save as \`${testPath}\` before merging.`;
  return postReviewComment(comment);
}

// ─── Tool dispatcher ───────────────────────────────────────────────

type ToolArgs = Record<string, string>;

const TOOL_MAP: Record<string, (args: ToolArgs) => string | Promise<string>> = {
  list_changed_files: () => listChangedFiles(),
  get_diff: (a) => getDiff(a.file_path),
  read_file: (a) => readFile(a.file_path),
  check_test_exists: (a) => checkTestExists(a.file_path),
  read_test_results: () => readTestResults(),
  post_review_comment: (a) => postReviewComment(a.body),
  suggest_test_file: (a) => suggestTestFile(a.file_path, a.content),
};

// ─── Gemini REST API call ──────────────────────────────────────────

async function callGemini(
  contents: GeminiContent[],
): Promise<GeminiResponse> {
  const url = `${GEMINI_URL}?key=${GEMINI_API_KEY}`;
  const body = {
    system_instruction: {
      parts: [{ text: SYSTEM_PROMPT }],
    },
    contents,
    tools: [{ function_declarations: TOOL_DECLARATIONS }],
    tool_config: {
      function_calling_config: { mode: "AUTO" },
    },
    generationConfig: {
      temperature: 0.2,
      maxOutputTokens: 8192,
    },
  };

  const raw = await httpsPost(url, body);
  return JSON.parse(raw) as GeminiResponse;
}

// ─── Agent loop ────────────────────────────────────────────────────

async function runAgent(): Promise<void> {
  const history: GeminiContent[] = [
    {
      role: "user",
      parts: [{ text: "A new pull request is open. Begin your review now." }],
    },
  ];

  let geminiResponse = await callGemini(history);

  for (let step = 0; step < 30; step++) {
    if (geminiResponse.error) {
      console.error("Gemini API error:", geminiResponse.error.message);
      break;
    }

    const candidate = geminiResponse.candidates?.[0];
    const parts = candidate?.content?.parts ?? [];

    if (parts.length === 0) {
      console.log("No parts in response, stopping.");
      break;
    }

    history.push({ role: "model", parts });

    const functionCalls = parts.filter(
      (p): p is GeminiPart & { functionCall: NonNullable<GeminiPart["functionCall"]> } =>
        p.functionCall !== undefined,
    );

    if (functionCalls.length > 0) {
      const responseParts: GeminiPart[] = [];

      for (const fc of functionCalls) {
        const { name, args } = fc.functionCall;
        console.log(
          `[Step ${step + 1}] Tool: ${name}(${Object.keys(args).join(", ")})`,
        );

        const handler = TOOL_MAP[name];
        const result = handler
          ? await handler(args)
          : `Unknown tool: ${name}`;
        console.log(`           Result: ${result.slice(0, 150)}`);

        responseParts.push({
          functionResponse: { name, response: { result } },
        });
      }

      history.push({ role: "function", parts: responseParts });
      geminiResponse = await callGemini(history);
      continue;
    }

    const textParts = parts.filter((p) => typeof p.text === "string");
    if (textParts.length > 0) {
      const text = textParts.map((p) => p.text).join("");
      console.log(`[Step ${step + 1}] Agent: ${text.slice(0, 300)}`);
      if (text.includes("DONE")) {
        console.log("\nAgent completed review.");
        return;
      }
      history.push({
        role: "user",
        parts: [{ text: "Continue." }],
      });
      geminiResponse = await callGemini(history);
      continue;
    }

    break;
  }

  console.log("Agent reached max steps or no actionable response.");
}

runAgent().catch((err) => {
  console.error("Agent failed:", err);
  process.exit(1);
});
