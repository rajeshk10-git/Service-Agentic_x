import express from "express";
import cors from "cors";
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

app.use("/internal", internalRoutes);
app.use("/auth", authRoutes);
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
