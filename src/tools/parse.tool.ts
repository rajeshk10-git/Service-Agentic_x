import type { ChatCompletionTool } from "openai/resources/chat/completions";

export const parseToolDefinition: ChatCompletionTool = {
  type: "function",
  function: {
    name: "parse_salary_slip",
    description:
      "Extract payslip data. Use gcs_uri with a gs:// object (upload via signed URL) for Document AI PDF/image processing, or document_text for plaintext / Python parser. Set async=true to queue a long-running parse via Cloud Tasks when configured.",
    parameters: {
      type: "object",
      properties: {
        document_text: {
          type: "string",
          description:
            "Plaintext payslip content (use when no gcs_uri). Optional if gcs_uri is set.",
        },
        gcs_uri: {
          type: "string",
          description:
            'Google Cloud Storage URI, e.g. "gs://bucket/path/file.pdf", for Document AI',
        },
        content_type: {
          type: "string",
          enum: ["text", "json"],
          description: "How document_text should be interpreted",
        },
        async: {
          type: "boolean",
          description:
            "If true and Cloud Tasks is configured, enqueue parse and return immediately",
        },
      },
    },
  },
};

export interface ParseSalarySlipArgs {
  document_text?: string;
  gcs_uri?: string;
  content_type?: "text" | "json";
  async?: boolean;
}
