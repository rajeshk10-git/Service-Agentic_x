import { CloudTasksClient } from "@google-cloud/tasks";
import { env } from "../config/env";
import { logger } from "../utils/logger";

let client: CloudTasksClient | null = null;

export function isCloudTasksConfigured(): boolean {
  return (
    env.CLOUD_TASKS_ENABLED &&
    Boolean(env.GCP_PROJECT_ID) &&
    Boolean(env.CLOUD_TASKS_LOCATION) &&
    Boolean(env.CLOUD_TASKS_QUEUE) &&
    Boolean(env.CLOUD_TASKS_TARGET_URL)
  );
}

/**
 * Enqueue async payslip parse; worker should POST to CLOUD_TASKS_TARGET_URL with shared secret header.
 */
export async function enqueueParseJob(payload: {
  userId: string;
  gcsUri?: string;
  documentText?: string;
  contentType?: string;
}): Promise<{ name: string } | { error: string }> {
  if (!isCloudTasksConfigured()) {
    return { error: "Cloud Tasks is not fully configured" };
  }

  if (!client) client = new CloudTasksClient();

  const project = env.GCP_PROJECT_ID;
  const location = env.CLOUD_TASKS_LOCATION;
  const queue = env.CLOUD_TASKS_QUEUE;
  const parent = client.queuePath(project, location, queue);

  const bodyPayload = {
    userId: payload.userId,
    gcs_uri: payload.gcsUri,
    document_text: payload.documentText,
    content_type: payload.contentType,
  };

  const httpRequest: {
    httpMethod: "POST";
    url: string;
    headers: Record<string, string>;
    body: string;
    oidcToken?: { serviceAccountEmail: string; audience: string };
  } = {
    httpMethod: "POST",
    url: env.CLOUD_TASKS_TARGET_URL,
    headers: {
      "Content-Type": "application/json",
      ...(env.INTERNAL_TASKS_SECRET
        ? { "X-Internal-Tasks-Secret": env.INTERNAL_TASKS_SECRET }
        : {}),
    },
    body: Buffer.from(JSON.stringify(bodyPayload)).toString("base64"),
  };

  if (env.CLOUD_TASKS_SERVICE_ACCOUNT_EMAIL) {
    httpRequest.oidcToken = {
      serviceAccountEmail: env.CLOUD_TASKS_SERVICE_ACCOUNT_EMAIL,
      audience: new URL(env.CLOUD_TASKS_TARGET_URL).origin,
    };
  }

  const [response] = await client.createTask({
    parent,
    task: { httpRequest },
  });

  const name = response.name ?? "unknown";
  logger.info("Cloud Tasks parse job created", { name });
  return { name };
}
