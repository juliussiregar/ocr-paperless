import {
  startScanWorker,
  startBackgroundTasks,
  shutdown,
} from "./queue.js";
import { getPaperlessHealth } from "./paperless.js";

async function main() {
  console.log("Sync worker starting (per-user Bappenas credentials)...");

  const paperlessOk = await getPaperlessHealth();
  console.log(
    paperlessOk
      ? "Paperless reachable"
      : "Warning: Paperless not reachable yet"
  );

  startScanWorker();
  startBackgroundTasks();

  console.log("Sync worker ready");

  const onSignal = async (signal: string) => {
    console.log(`Received ${signal}, shutting down...`);
    await shutdown();
    process.exit(0);
  };

  process.on("SIGTERM", () => onSignal("SIGTERM"));
  process.on("SIGINT", () => onSignal("SIGINT"));
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
