/** Human labels for audit action codes (admin UI). */

export type AuditCategory =
  | "ai"
  | "scan"
  | "cloud"
  | "document"
  | "user"
  | "admin"
  | "error"
  | "other";

const LABELS: Record<
  string,
  { title: string; category: AuditCategory; description?: string }
> = {
  "chat.ask": {
    title: "Tanya Arsip",
    category: "ai",
    description: "Mengajukan pertanyaan ke pencarian arsip",
  },
  "embed.index": {
    title: "Embedding dokumen",
    category: "ai",
    description: "Index embedding untuk Tanya Arsip (biaya pencarian)",
  },
  "chat.feedback": {
    title: "Feedback Tanya Arsip",
    category: "ai",
    description: "Menilai jawaban pencarian arsip",
  },
  "error.chat": {
    title: "Error Tanya Arsip",
    category: "error",
    description: "Gagal memproses pertanyaan arsip",
  },
  "error.search": {
    title: "Error Search",
    category: "error",
  },
  "error.scan": {
    title: "Error Scan",
    category: "error",
  },
  "error.generic": {
    title: "Error sistem",
    category: "error",
  },
  "search.query": {
    title: "Pencarian",
    category: "document",
    description: "Mencari dokumen di arsip OCR",
  },
  "scan.start": {
    title: "Mulai scan",
    category: "scan",
  },
  "scan.pause": {
    title: "Jeda scan",
    category: "scan",
  },
  "scan.resume": {
    title: "Lanjut scan",
    category: "scan",
  },
  "scan.cancel": {
    title: "Stop scan",
    category: "scan",
  },
  "cloud.ingest": {
    title: "Ambil dokumen Cloud",
    category: "cloud",
  },
  "cloud.retry": {
    title: "Coba OCR lagi",
    category: "cloud",
  },
  "cloud.raw_download": {
    title: "Unduh file Cloud",
    category: "cloud",
  },
  "document.preview": {
    title: "Preview dokumen",
    category: "document",
  },
  "document.download": {
    title: "Unduh dokumen",
    category: "document",
  },
  "user.register": {
    title: "Registrasi",
    category: "user",
  },
  "user.profile.update": {
    title: "Update profil",
    category: "user",
  },
  "user.create": {
    title: "Buat user (admin)",
    category: "admin",
  },
  "settings.auto_scan": {
    title: "Pengaturan auto scan",
    category: "admin",
  },
  "admin.scan.trigger_all": {
    title: "Sync semua user",
    category: "admin",
    description: "Discover, download, dan scan untuk semua user dengan kredensial Bappenas",
  },
  "admin.scan.trigger": {
    title: "Trigger delta sync",
    category: "admin",
  },
  "admin.scan.release_lock": {
    title: "Release scan lock",
    category: "admin",
  },
  "admin.scan.cancel_all": {
    title: "Batalkan semua job sync",
    category: "admin",
    description: "Sync otomatis dimatikan dari Admin",
  },
};

export function describeAuditAction(action: string): {
  title: string;
  category: AuditCategory;
  description?: string;
} {
  if (LABELS[action]) return LABELS[action]!;
  if (action.startsWith("error.")) {
    return {
      title: action.replace(/^error\./, "Error "),
      category: "error",
    };
  }
  return {
    title: action,
    category: "other",
  };
}

export function isErrorAction(action: string): boolean {
  return action.startsWith("error.") || action.includes(".fail");
}
