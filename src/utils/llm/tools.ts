import type { ChatCompletionTool } from "openai/resources/chat/completions";
import { compareToolDefinition } from "../../tools/compare.tool";
import { parseToolDefinition } from "../../tools/parse.tool";
import { salaryToolDefinition } from "../../tools/salary.tool";
import { simulateTaxToolDefinition, taxToolDefinition } from "../../tools/tax.tool";

export function getAgentTools(): ChatCompletionTool[] {
  return [
    taxToolDefinition,
    simulateTaxToolDefinition,
    compareToolDefinition,
    salaryToolDefinition,
    parseToolDefinition,
  ];
}
