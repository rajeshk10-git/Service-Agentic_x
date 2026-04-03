import type {
  ChatCompletionMessage,
  ChatCompletionMessageParam,
} from "openai/resources/chat/completions";
import { AGENT_SYSTEM_PROMPT } from "../utils/prompt";
import { createChatCompletion } from "../utils/llm";
import { payrollService } from "./payroll.service";
import { ragService } from "./rag.service";
import { parseToolName, toolService } from "./tool.service";

const MAX_AGENT_STEPS = 12;

export interface RunAgentPayslipFile {
  buffer: Buffer;
  mimeType: string;
}

export interface RunAgentInput {
  userId: string;
  query: string;
  /** If set, Document AI runs before the LLM and payroll/RAG are refreshed. */
  payslipFile?: RunAgentPayslipFile;
}

export interface RunAgentResult {
  success: boolean;
  response: string;
  toolsUsed: string[];
  error?: string;
  /** Present when a payslip file was processed this request (structured parse summary). */
  payslipParse?: Record<string, unknown>;
}

function toAssistantParam(
  message: ChatCompletionMessage,
): ChatCompletionMessageParam {
  if (message.tool_calls?.length) {
    return {
      role: "assistant",
      content: message.content,
      tool_calls: message.tool_calls,
    };
  }
  return {
    role: "assistant",
    content: message.content ?? "",
  };
}

function summarizePayslipParseForContext(
  da: Record<string, unknown>,
): Record<string, unknown> {
  if (da.error) {
    return {
      error: true,
      message: da.message,
    };
  }
  return {
    source: da.source,
    extracted: da.extracted,
    salarySaved: da.salarySaved,
    salaryId: da.salaryId,
    pageCount: da.pageCount,
    entityCount: Array.isArray(da.entities) ? da.entities.length : 0,
  };
}

function buildContextBlock(
  recordsJson: string,
  ragSnippets: string[],
): string {
  const rag =
    ragSnippets.length > 0
      ? ragSnippets.join("\n---\n")
      : "(No RAG matches — use get_salary_data or parse_salary_slip if needed.)";
  return `## Payroll records (authoritative PostgreSQL snapshot)\n${recordsJson}\n\n## Retrieved context (keyword match over salary rows from that snapshot)\n${rag}`;
}

export class AgentService {
  async runAgent(input: RunAgentInput): Promise<RunAgentResult> {
    const { userId, query, payslipFile } = input;
    const toolsUsed: string[] = [];
    let payslipParse: Record<string, unknown> | undefined;

    try {
      if (payslipFile?.buffer?.length) {
        console.log('Processing payslip file with Document AI....');
        const da = await toolService.processUploadedPayslipWithDocumentAi(
          userId,
          payslipFile.buffer,
          payslipFile.mimeType,
        );
        payslipParse = summarizePayslipParseForContext(da);
      }

      const records = await payrollService.getSalaryByUserId(userId);
      await ragService.indexFromSalaryRecords(userId, records);
      const ragHits = await ragService.search(userId, query, 5);
      const ragSnippets = ragHits.map((h) => h.text);

      const recordsJson =
        records.length === 0
          ? "[] — no rows found for this userId."
          : JSON.stringify(
              records.map((r) => ({
                month: r.month,
                basic: r.basic,
                hra: r.hra,
                tax: r.tax,
                pf: r.pf,
                gross_basic_hra: r.basic + r.hra,
                net_estimate: r.basic + r.hra - r.tax - r.pf,
              })),
              null,
              2,
            );

      const contextBlock = buildContextBlock(recordsJson, ragSnippets);

      const payslipBlock =
        payslipParse !== undefined
          ? `\n\n## Payslip file (processed with Document AI before this turn)\n${JSON.stringify(payslipParse, null, 2)}\n`
          : "";

      const messages: ChatCompletionMessageParam[] = [
        { role: "system", content: AGENT_SYSTEM_PROMPT },
        {
          role: "user",
          content: `${contextBlock}${payslipBlock}\n\nUser question:\n${query}`,
        },
      ];

      let lastText = "";
      for (let step = 0; step < MAX_AGENT_STEPS; step++) {
        const { message } = await createChatCompletion(messages);

        if (message.tool_calls?.length) {
          messages.push(toAssistantParam(message));

          for (const tc of message.tool_calls) {
            const fn = tc.function;
            const name = fn.name;
            let parsedArgs: unknown = {};
            try {
              parsedArgs = fn.arguments ? JSON.parse(fn.arguments) : {};
            } catch {
              parsedArgs = { parse_error: true, raw: fn.arguments };
            }

            const toolName = parseToolName(name);
            const output =
              toolName === null
                ? {
                    error: true,
                    message: `Unsupported tool "${name}".`,
                  }
                : await toolService.executeTool(toolName, parsedArgs, userId);

            if (toolName !== null) {
              toolsUsed.push(toolName);
            }

            messages.push({
              role: "tool",
              tool_call_id: tc.id,
              content:
                typeof output === "string"
                  ? output
                  : JSON.stringify(output),
            });
          }
          continue;
        }

        messages.push(toAssistantParam(message));
        lastText = message.content?.trim() ?? "";

        if (!lastText) {
          lastText =
            "Summary:\nI could not produce a textual answer for this request.\n\nBreakdown:\n—\n\nRecommendation:\nTry rephrasing or provide a payslip month (YYYY-MM).";
        }

        return {
          success: true,
          response: lastText,
          toolsUsed: [...new Set(toolsUsed)],
          ...(payslipParse !== undefined ? { payslipParse } : {}),
        };
      }

      return {
        success: false,
        response: "",
        toolsUsed: [...new Set(toolsUsed)],
        error: "Agent stopped after maximum reasoning steps.",
        ...(payslipParse !== undefined ? { payslipParse } : {}),
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        success: false,
        response: `Summary:\nThe agent encountered an error.\n\nBreakdown:\n${message}\n\nRecommendation:\nRetry shortly or verify configuration (LLM provider, database, GCP).`,
        toolsUsed: [...new Set(toolsUsed)],
        error: message,
        ...(payslipParse !== undefined ? { payslipParse } : {}),
      };
    }
  }
}

export const agentService = new AgentService();
