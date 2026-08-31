import { SyncStatus } from "@prisma/client";
import type { RemoteFile } from "./webdav.js";

export const DONE_SYNC_STATUSES: SyncStatus[] = [
  SyncStatus.OCR_DONE,
  SyncStatus.SKIPPED,
];

export type RemoteMeta = Pick<
  RemoteFile,
  "path" | "etag" | "lastModified" | "size" | "fileId" | "basename" | "mimeType"
>;

export function isDoneSyncStatus(status: SyncStatus): boolean {
  return DONE_SYNC_STATUSES.includes(status);
}

export function hasRemoteMetadataChanged(
  existing: {
    etag: string | null;
    lastModified: Date | null;
    fileSize: bigint | null;
  },
  remote: {
    etag: string | null;
    lastModified: Date | null;
    size: number | null;
  }
): boolean {
  if (existing.etag && remote.etag && existing.etag !== remote.etag) {
    return true;
  }
  if (
    existing.lastModified &&
    remote.lastModified &&
    existing.lastModified.getTime() !== remote.lastModified.getTime()
  ) {
    return true;
  }
  if (
    existing.fileSize !== null &&
    remote.size != null &&
    BigInt(remote.size) !== existing.fileSize
  ) {
    return true;
  }
  return false;
}

export function remoteMetaFromFile(file: RemoteFile): RemoteMeta {
  return {
    path: file.path,
    etag: file.etag,
    lastModified: file.lastModified,
    size: file.size,
    fileId: file.fileId,
    basename: file.basename,
    mimeType: file.mimeType,
  };
}

export function metadataPatchFromRemote(
  remote: RemoteMeta,
  lastSeenAt: Date
): {
  etag: string | null;
  lastModified: Date | null;
  fileSize: bigint | null;
  mimeType: string | null;
  fileName: string;
  remoteFileId?: string;
  lastSeenAt: Date;
} {
  const patch: {
    etag: string | null;
    lastModified: Date | null;
    fileSize: bigint | null;
    mimeType: string | null;
    fileName: string;
    remoteFileId?: string;
    lastSeenAt: Date;
  } = {
    etag: remote.etag,
    lastModified: remote.lastModified,
    fileSize: remote.size != null ? BigInt(remote.size) : null,
    mimeType: remote.mimeType,
    fileName: remote.basename,
    lastSeenAt,
  };
  if (remote.fileId) {
    patch.remoteFileId = remote.fileId;
  }
  return patch;
}
