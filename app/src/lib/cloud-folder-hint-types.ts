/** Client-safe cloud folder hint shape (no server imports). */
export type CloudFolderHint = {
  isEmpty: boolean;
  docCount: number;
  totalDocSize: number;
  zeroByteDocs: number;
  dirCount: number;
  fileCount: number;
  pdfCount: number;
  totalPdfSize: number;
  zeroBytePdfs: number;
  recursiveComplete?: boolean;
};
