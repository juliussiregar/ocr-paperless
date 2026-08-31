export type FileCategory =
  | "pdf"
  | "word"
  | "excel"
  | "powerpoint"
  | "image"
  | "text"
  | "other";

const EXT_TO_CATEGORY: Record<string, FileCategory> = {
  pdf: "pdf",
  doc: "word",
  docx: "word",
  odt: "word",
  rtf: "word",
  xls: "excel",
  xlsx: "excel",
  ods: "excel",
  csv: "excel",
  ppt: "powerpoint",
  pptx: "powerpoint",
  odp: "powerpoint",
  jpg: "image",
  jpeg: "image",
  png: "image",
  gif: "image",
  webp: "image",
  tiff: "image",
  tif: "image",
  bmp: "image",
  heic: "image",
  heif: "image",
  txt: "text",
  md: "text",
  html: "text",
  htm: "text",
};

const MIME_PREFIX: Array<{ prefix: string; category: FileCategory }> = [
  { prefix: "application/pdf", category: "pdf" },
  { prefix: "image/", category: "image" },
  { prefix: "text/", category: "text" },
];

const MIME_EXACT: Record<string, FileCategory> = {
  "application/msword": "word",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
    "word",
  "application/vnd.oasis.opendocument.text": "word",
  "application/rtf": "word",
  "application/vnd.ms-excel": "excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "excel",
  "application/vnd.oasis.opendocument.spreadsheet": "excel",
  "text/csv": "excel",
  "application/vnd.ms-powerpoint": "powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation":
    "powerpoint",
  "application/vnd.oasis.opendocument.presentation": "powerpoint",
};

export const FILE_CATEGORY_LABELS: Record<FileCategory, string> = {
  pdf: "PDF",
  word: "Word",
  excel: "Excel",
  powerpoint: "PowerPoint",
  image: "Gambar",
  text: "Teks",
  other: "Lainnya",
};

function extensionFromName(name: string): string {
  const base = name.trim().toLowerCase();
  const dot = base.lastIndexOf(".");
  if (dot <= 0 || dot === base.length - 1) return "";
  return base.slice(dot + 1);
}

export function fileCategoryFromExtension(ext: string): FileCategory {
  const e = ext.trim().toLowerCase();
  if (e && EXT_TO_CATEGORY[e]) return EXT_TO_CATEGORY[e];
  return "other";
}

export function fileCategoryFromName(
  name: string,
  mimeType?: string | null
): FileCategory {
  const ext = extensionFromName(name);
  if (ext && EXT_TO_CATEGORY[ext]) return EXT_TO_CATEGORY[ext];

  const mime = (mimeType ?? "").trim().toLowerCase();
  if (mime) {
    if (MIME_EXACT[mime]) return MIME_EXACT[mime];
    for (const { prefix, category } of MIME_PREFIX) {
      if (mime.startsWith(prefix)) return category;
    }
  }

  return "other";
}

export function isIngestibleFileName(
  name: string,
  mimeType?: string | null
): boolean {
  const ext = extensionFromName(name);
  if (ext && EXT_TO_CATEGORY[ext]) return true;

  const mime = (mimeType ?? "").trim().toLowerCase();
  if (!mime) return false;
  if (MIME_EXACT[mime]) return true;
  for (const { prefix } of MIME_PREFIX) {
    if (mime.startsWith(prefix)) return true;
  }
  return false;
}

export function isPdfFileName(name: string, mimeType?: string | null): boolean {
  return fileCategoryFromName(name, mimeType) === "pdf";
}

export function emptyTypeCounts(): Record<FileCategory, number> {
  return {
    pdf: 0,
    word: 0,
    excel: 0,
    powerpoint: 0,
    image: 0,
    text: 0,
    other: 0,
  };
}

export function bumpTypeCount(
  counts: Record<FileCategory, number>,
  name: string,
  mimeType?: string | null
): void {
  const cat = fileCategoryFromName(name, mimeType);
  counts[cat] += 1;
}
