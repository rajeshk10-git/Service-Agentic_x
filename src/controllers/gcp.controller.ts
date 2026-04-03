import type { Request, Response } from "express";
import { createSignedUploadUrl } from "../gcp/storage.service";

interface SignedBody {
  userId?: string;
  filename?: string;
  contentType?: string;
}

export async function postSignedPayslipUpload(
  req: Request<object, unknown, SignedBody>,
  res: Response,
): Promise<void> {
  try {
    const { userId, filename, contentType } = req.body ?? {};
    if (!userId || typeof userId !== "string") {
      res.status(400).json({ error: "userId is required" });
      return;
    }
    if (!filename || typeof filename !== "string") {
      res.status(400).json({ error: "filename is required" });
      return;
    }
    if (!contentType || typeof contentType !== "string") {
      res.status(400).json({ error: "contentType is required" });
      return;
    }

    const result = await createSignedUploadUrl(
      userId.trim(),
      filename.trim(),
      contentType.trim(),
    );

    if ("error" in result) {
      res.status(503).json({ error: result.error });
      return;
    }

    res.status(200).json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
}
