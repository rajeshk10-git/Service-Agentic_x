import express from "express";
import cors from "cors";
import { postChatFeedback } from "./controllers/agent.controller";
import { requireJwtUserId } from "./middleware/auth.middleware";
import agentRoutes from "./routes/agent.routes";
import authRoutes from "./routes/auth.routes";
import internalRoutes from "./routes/internal.routes";
import { requestLogger } from "./middleware/requestLogger";

const app = express();

app.use(cors());
/** Large limit: JSON payslipBase64 is ~4/3 of file size (align with multer 15MB file cap). */
app.use(express.json({ limit: "32mb" }));
app.use(requestLogger);

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

/** UI connectivity: 200 + `{ "ok": true }` means API is reachable (use with fetch + no-store). */
app.get("/ping", (_req, res) => {
  res.set("Cache-Control", "no-store, no-cache, must-revalidate");
  res.json({ ok: true });
});

app.get("/ping-pong", (_req, res) => {
  console.log("ping-pong hit");
  const timestamp: any = new Date().toISOString();
  res.json({ pong: true, timestamp });
});

app.use("/internal", internalRoutes);
app.use("/auth", authRoutes);
/** Same handler as POST `/agent/feedback` — chat response feedback for the UI. */
app.post("/feedback", requireJwtUserId, postChatFeedback);
app.use("/agent", agentRoutes);

app.use(
  (
    err: Error,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction,
  ) => {
    console.error("Unhandled error:", err);
    res.status(500).json({
      success: false,
      error: err.message || "Internal Server Error",
    });
  },
);

export default app;
