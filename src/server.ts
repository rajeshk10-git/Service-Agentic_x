import "dotenv/config";

async function start(): Promise<void> {
  if (process.env.GCP_SECRET_MANAGER_ENABLED === "true") {
    const { loadSecretsFromManager } = await import("./gcp/secrets.loader");
    await loadSecretsFromManager();
  }

  const [{ env }, { default: app }] = await Promise.all([
    import("./config/env"),
    import("./app"),
  ]);

  const server = app.listen(env.APP_PORT, () => {
    console.log(`Financial Wellness Agent listening on port ${env.APP_PORT}`);
  });

  function shutdown(signal: string): void {
    console.log(`Received ${signal}, shutting down...`);
    server.close(() => process.exit(0));
  }

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

start().catch((err) => {
  console.error("Fatal startup error:", err);
  process.exit(1);
});
