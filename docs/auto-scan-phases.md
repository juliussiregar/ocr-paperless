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

Lihat checklist lengkap: [deploy.md](./deploy.md)

1. Deploy code (`./scripts/server-up.sh`, schema via `db push` otomatis di app)
2. Uji manual: Admin → Backlog OCR → **Delta** per user, atau `POST /api/admin/scan`
3. Admin → **Siap deploy** = ON
4. Set interval, batch, root path (default `/`)
5. **Jadwal auto scan** = ON
6. Opsional: auto retry FAILED, subtree JSON
7. Opsional env: `AUTO_SCAN_ENABLED=true` (tetap butuh **Siap deploy**)

## Pengaturan DB (`app_settings`)

| Key | Default | Deskripsi |
|-----|---------|-----------|
| `auto_scan_ready` | `false` | Gate: code siap production |
| `auto_scan_enabled` | `false` | Toggle jadwal delta_sync |
| `auto_scan_interval_minutes` | `60` | Interval tick |
| `auto_scan_batch_size` | `50` | Max file ingest per job |
| `auto_scan_root_path` | `/` | Root WebDAV listing |
| `auto_scan_subtrees` | `` | JSON array path untuk rotasi subtree |
| `auto_scan_subtree_index` | `0` | Index rotasi (internal) |
| `auto_retry_enabled` | `false` | Scheduler retry FAILED |
| `auto_retry_interval_minutes` | `120` | Interval retry |
| `auto_retry_batch_size` | `30` | Max file per retry tick |

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
