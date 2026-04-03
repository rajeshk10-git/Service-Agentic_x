import { Storage } from "@google-cloud/storage";
import { env } from "../config/env";
import { logger } from "../utils/logger";

let storage: Storage | null = null;

function getStorage(): Storage | null {
  if (!env.GCS_PAYSLIP_BUCKET) return null;
  if (!storage) storage = new Storage();
  return storage;
}

export interface SignedUploadResult {
  bucket: string;
  objectPath: string;
  uploadUrl: string;
  gcsUri: string;
  expiresInMinutes: number;
}

/**
 * Client-upload flow: browser PUTs file to returned URL, then agent references gcsUri in parse_salary_slip.
 */
export async function createSignedUploadUrl(
  userId: string,
  filename: string,
  contentType: string,
): Promise<SignedUploadResult | { error: string }> {
  const client = getStorage();
  if (!client) {
    return { error: "GCS_PAYSLIP_BUCKET is not configured" };
  }

  const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, "_");
  const objectPath = `${env.GCS_PAYSLIP_PREFIX}/${userId}/${Date.now()}-${safeName}`;

  const bucket = client.bucket(env.GCS_PAYSLIP_BUCKET);
  const file = bucket.file(objectPath);

  const [uploadUrl] = await file.getSignedUrl({
    version: "v4",
    action: "write",
    expires: Date.now() + env.GCS_SIGNED_URL_TTL_MIN * 60 * 1000,
    contentType,
  });

  const gcsUri = `gs://${env.GCS_PAYSLIP_BUCKET}/${objectPath}`;

  logger.info("Signed upload URL issued", {
    userId,
    objectPath,
    contentType,
  });

  return {
    bucket: env.GCS_PAYSLIP_BUCKET,
    objectPath,
    uploadUrl,
    gcsUri,
    expiresInMinutes: env.GCS_SIGNED_URL_TTL_MIN,
  };
}

export async function downloadObjectText(gcsUri: string): Promise<Buffer> {
  const m = gcsUri.match(/^gs:\/\/([^/]+)\/(.+)$/);
  if (!m) {
    throw new Error(`Invalid gcs URI: ${gcsUri}`);
  }
  const [, bucketName, objectPath] = m;
  const client = getStorage();
  if (!client) {
    throw new Error("Storage client not configured");
  }
  const [buf] = await client.bucket(bucketName).file(objectPath).download();
  return buf;
}
