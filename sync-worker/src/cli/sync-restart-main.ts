import { restartSyncPipeline } from "../admin-sync-cli.js";

restartSyncPipeline()
  .then(() => {
    console.log("[sync-restart] selesai");
    process.exit(0);
  })
  .catch((err) => {
    console.error("[sync-restart] gagal:", err);
    process.exit(1);
  });
