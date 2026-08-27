import { AdminPanel } from "@/components/AdminPanel";
import { getAutoScanSettings } from "@/lib/app-settings";

export default async function AdminPage() {
  const settings = await getAutoScanSettings();

  return <AdminPanel initialSettings={settings} />;
}
