import { AdminSyncPanel } from "@/components/AdminSyncPanel";
import { getAutoScanSettings } from "@/lib/app-settings";

export default async function AdminSyncPage() {
  const settings = await getAutoScanSettings();

  return <AdminSyncPanel initialSettings={settings} />;
}
