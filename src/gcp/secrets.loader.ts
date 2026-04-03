import { SecretManagerServiceClient } from "@google-cloud/secret-manager";

/**
 * Pull secrets from Secret Manager into process.env before the rest of the app loads.
 * Configure which secrets map to which env keys via:
 * GCP_SM_DATABASE_URL = projects/.../secrets/.../versions/latest
 * GCP_SM_OPENAI_API_KEY = ...
 */
export async function loadSecretsFromManager(): Promise<void> {
  const project = process.env.GCP_PROJECT_ID;
  if (!project) {
    throw new Error("GCP_PROJECT_ID is required for Secret Manager bootstrap");
  }

  const client = new SecretManagerServiceClient();
  const pairs: { envKey: string; secretRef?: string }[] = [
    { envKey: "DATABASE_URL", secretRef: process.env.GCP_SM_DATABASE_URL },
    { envKey: "OPENAI_API_KEY", secretRef: process.env.GCP_SM_OPENAI_API_KEY },
  ];

  for (const { envKey, secretRef } of pairs) {
    if (!secretRef?.trim()) continue;
    const name = secretRef.includes("/versions/")
      ? secretRef
      : `${secretRef}/versions/latest`;
    const [version] = await client.accessSecretVersion({ name });
    const payload = version.payload?.data;
    if (payload != null && payload !== "") {
      process.env[envKey] =
        typeof payload === "string"
          ? payload
          : Buffer.from(payload as Uint8Array).toString("utf8");
    }
  }
}
