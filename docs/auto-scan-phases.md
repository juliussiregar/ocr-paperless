# Auto scan: roadmap dan status

Dokumen ini mencatat semua fase pengembangan auto download/OCR dari Nextcloud Bappenas.

**Status saat ini:** Fase 1-4 diimplementasi di code. Auto download **belum aktif** sampai admin menandai **Siap deploy** dan mengaktifkan jadwal.

---

## Fase 1: Stabilkan ingest (selesai)

- Pre-download skip: etag / size / mtime tidak berubah → tidak download lagi
- Dedup hash setelah download (DB + Paperless checksum)
- Shared ingest batch (`ingest-batch.ts`) dengan metadata cloud
- Admin: interval, batch size, root path, flag **Siap deploy**
- Scheduler **tidak jalan** jika `auto_scan_ready != true`

## Fase 2: Delta sync + identitas file (selesai)

- WebDAV `details: true` + `oc:fileid` → `remoteFileId`
- Job `delta_sync`: listing cloud, reconcile, ingest terbatas
- **MOVED:** update `remotePath` tanpa re-OCR jika metadata sama
- **MODIFIED:** re-ingest jika etag/size berubah
- **NEW:** ingest baru
- **MISSING:** status `DELETED` jika tidak ada di listing
- Index `(userId, remoteFileId)` + `lastSeenAt`, `previousRemotePath`
- Auto scan: **delta dari cloud root** (`/`), **tanpa folder favorit**

## Fase 3: Throughput (selesai)

- Split queue BullMQ: `scan-discover` vs `scan-ingest`
- Concurrency: `SCAN_DISCOVER_CONCURRENCY` (default 2), `SCAN_INGEST_CONCURRENCY` (default 2, max 6)
- Per-user Redis lock pada ingest worker (satu download/OCR aktif per user)
- `delta_sync` discover enqueue child job `ingest_paths` (tidak download inline)
- Pre-download dedup lintas path via etag + fileSize (peer sudah OCR_DONE/SKIPPED)
- Auto retry FAILED: scheduler terpisah (`auto_retry_enabled`), enqueue `ingest_paths`
- Manual retry API (`/api/cloud/retry`) memakai `ingest_paths` + ingest queue

## Fase 4: Skala besar (selesai)

- Folder snapshot cache (`CloudFolderSnapshot`): skip subtree jika dir mtime/etag tidak berubah
- Subtree rotation: `auto_scan_subtrees` (JSON array) + rotasi index per tick
- Worker sharding: `SYNC_WORKER_SHARD_COUNT` / `SYNC_WORKER_SHARD_INDEX` (filter user by hash)
- Reconcile mingguan: job `reconcile_only` (listing + reconcile, limit ingest 0)
- Admin backlog dashboard + `POST /api/admin/scan` trigger delta/reconcile per user

---

## Mengaktifkan auto download (setelah uji)

1. Deploy code
2. Admin → **Sync cloud** → **Sync semua user** (uji manual)
3. Nyalakan **Jadwal otomatis**, set **Interval sync** (menit)
4. Batch, root `/`, retry: otomatis dari env server (`SCAN_MAX_FILES`, dll.)

## Pengaturan DB (`app_settings`)

| Key | Default | Deskripsi |
|-----|---------|-----------|
| `auto_scan_enabled` | `false` | Toggle jadwal (Admin UI) |
| `auto_scan_interval_minutes` | `60` | Interval tick (Admin UI) |
| `auto_scan_batch_size` | dari env | Internal, tidak di UI |
| `auto_scan_root_path` | `/` | Internal |
| `auto_retry_enabled` | `true` | Internal, default on |

## Env worker

| Variabel | Default (8GB) | Deskripsi |
|----------|---------------|-----------|
| `AUTO_SCAN_ENABLED` | `false` | Force scheduler on (still needs ready) |
| `SCAN_MAX_FILES` | `50` | Cap fallback batch |
| `SCAN_DISCOVER_CONCURRENCY` | `4` | Parallel discover jobs (max 8) |
| `SCAN_INGEST_CONCURRENCY` | `4` | Parallel ingest jobs (max 12) |
| `WEBDAV_DOWNLOAD_CONCURRENCY` | `4` | Parallel download per ingest (max 10) |
| `POST_SYNC_WARM_ENABLED` | `true` | Warm listing cache setelah sync |
| `POST_SYNC_WARM_MAX_DIRS` | `16` | Max folder di-warm (root + 1 level) |
| `WEBDAV_DISCOVERY_CONCURRENCY` | `24` | Parallel folder listing |
| `INGEST_MAX_RETRY_COUNT` | `5` | Auto-retry cap per FAILED file |
| `SCAN_STUCK_JOB_MINUTES` | `45` | Admin alert threshold for RUNNING jobs |
| `SYNC_WORKER_SHARD_COUNT` | `1` | Jumlah shard worker |
| `SYNC_WORKER_SHARD_INDEX` | `0` | Index shard (0-based) |

---

## Perilaku duplikat

| Skenario | Perilaku |
|----------|----------|
| File sama, path sama, metadata sama | Skip download |
| File dipindah (fileId sama) | Update path, skip OCR |
| File dipindah + isi berubah | Re-ingest |
| File copy (hash sama, path baru) | SKIPPED / OCR_DONE via hash |
| File hilang dari cloud | `DELETED` |
| Peer path lain, etag+size sama | SKIPPED (pre-download meta dedup) |

Changelog: 2026-08-31 Fase 3+4 (queues, retry, folder cache, shard, admin API).
