#!/usr/bin/env python3
"""
Generate DocSearch AI documentation PDF (A4).
Covers: AI concept, current RAG pipeline, Search vs Ask AI, models, limits,
development roadmap, recommended future RAG techniques, and likely user questions.
"""

from __future__ import annotations

import sys
from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_JUSTIFY
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import cm
from reportlab.platypus import PageBreak, Paragraph, SimpleDocTemplate, Spacer

# Reuse PDF helpers from the main docs generator
HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

from generate_docs_pdf import (  # noqa: E402
    ArrowDown,
    FlowBox,
    HFlow,
    bullets,
    callout,
    simple_table,
    styles,
    vflow,
)

OUT = HERE
PDF_PATH = OUT / "DocSearch-Dokumentasi-AI.pdf"

TEAL = colors.HexColor("#0B6E63")
TEAL_DARK = colors.HexColor("#064E48")
TEAL_MID = colors.HexColor("#A7D6CE")
MUTED = colors.HexColor("#64748B")
SKY = colors.HexColor("#0369A1")
AMBER = colors.HexColor("#B45309")
WHITE = colors.white


def ai_header_footer(canvas, doc):
    canvas.saveState()
    page = canvas.getPageNumber()
    if page > 1:
        canvas.setStrokeColor(TEAL_MID)
        canvas.setLineWidth(0.6)
        canvas.line(2 * cm, A4[1] - 1.4 * cm, A4[0] - 2 * cm, A4[1] - 1.4 * cm)
        canvas.setFont("Helvetica", 8)
        canvas.setFillColor(TEAL)
        canvas.drawString(2 * cm, A4[1] - 1.2 * cm, "DocSearch · Dokumentasi AI")
        canvas.setFillColor(MUTED)
        canvas.drawRightString(A4[0] - 2 * cm, A4[1] - 1.2 * cm, f"Halaman {page}")
        canvas.line(2 * cm, 1.4 * cm, A4[0] - 2 * cm, 1.4 * cm)
    canvas.restoreState()


def build():
    s = styles()
    story: list = []

    # ========== COVER ==========
    story.append(Spacer(1, 3.2 * cm))
    story.append(
        Paragraph(
            "DocSearch",
            ParagraphStyle(
                "cover_title",
                fontSize=28,
                textColor=TEAL_DARK,
                alignment=TA_CENTER,
                spaceAfter=10,
                leading=34,
                fontName="Helvetica-Bold",
            ),
        )
    )
    story.append(
        Paragraph(
            "Dokumentasi AI: Konsep, RAG, Model,<br/>dan Arah Pengembangan",
            ParagraphStyle(
                "cover_sub",
                fontSize=12,
                textColor=MUTED,
                alignment=TA_CENTER,
                spaceAfter=6,
                leading=16,
            ),
        )
    )
    story.append(Spacer(1, 0.5 * cm))
    story.append(
        callout(
            "<b>Dokumen ini fokus pada kecerdasan buatan di DocSearch:</b> bagaimana OCR "
            "menjadi konteks untuk AI, perbedaan Search dan Ask AI, komponen RAG yang "
            "sudah ada, batasan saat ini, model OpenAI yang dipakai, kemungkinan pertanyaan "
            "untuk demo dan pelatihan, serta rekomendasi pengembangan yang tidak bergantung "
            "pada kasus per kasus.",
            "info",
        )
    )
    story.append(Spacer(1, 1 * cm))
    story.append(
        Paragraph(
            "Bahasa: Indonesia · Format: dokumentasi teknis (A4)",
            ParagraphStyle(
                "cover_sub",
                fontSize=11,
                textColor=MUTED,
                alignment=TA_CENTER,
                leading=16,
            ),
        )
    )
    story.append(
        Paragraph(
            "Versi dokumen: Agustus 2026",
            ParagraphStyle(
                "cover_sub",
                fontSize=11,
                textColor=MUTED,
                alignment=TA_CENTER,
                leading=16,
            ),
        )
    )
    story.append(
        Paragraph(
            "Output: DocSearch-Dokumentasi-AI.pdf",
            ParagraphStyle(
                "cover_sub",
                fontSize=11,
                textColor=MUTED,
                alignment=TA_CENTER,
                leading=16,
            ),
        )
    )
    story.append(PageBreak())

    # ========== TOC ==========
    story.append(Paragraph("Daftar Isi", s["h1"]))
    toc = [
        ("1.", "Ringkasan: AI di DocSearch"),
        ("2.", "Konsep sederhana (untuk non-teknis)"),
        ("3.", "Search vs Ask AI"),
        ("4.", "Arsitektur RAG saat ini"),
        ("5.", "Komponen RAG: apa saja yang ada"),
        ("6.", "Alur teknis Ask AI (langkah demi langkah)"),
        ("7.", "Mode intent & batas konteks"),
        ("8.", "Scope, pin dokumen, dan isolasi user"),
        ("9.", "Batasan & risiko jawaban AI saat ini"),
        ("10.", "Arah pengembangan (umum, bukan kasus per kasus)"),
        ("11.", "RAG ke depan: teknik yang cocok ditambahkan"),
        ("12.", "Model AI sekarang vs rekomendasi ke depan"),
        ("13.", "Biaya, audit, dan operasional"),
        ("14.", "Kemungkinan pertanyaan (materi demo & pelatihan)"),
        ("15.", "FAQ AI"),
    ]
    for num, title in toc:
        story.append(Paragraph(f"{num} {title}", s["toc"]))
    story.append(PageBreak())

    # ========== 1. RINGKASAN ==========
    story.append(Paragraph("1. Ringkasan: AI di DocSearch", s["h1"]))
    story.append(
        Paragraph(
            "DocSearch tidak menggantikan arsip PDF dengan AI generatif bebas. "
            "AI dipakai sebagai lapisan <b>pemahaman dan jawaban</b> di atas teks yang "
            "sudah diekstraksi lewat OCR (Paperless-ngx). Tanpa OCR, AI tidak punya "
            "bahan bacaan yang andal.",
            s["body"],
        )
    )
    story.extend(
        bullets(
            [
                "<b>Sumber kebenaran:</b> teks OCR di Paperless + metadata sync (path, ukuran, status).",
                "<b>Dua jalur utama:</b> <b>Search</b> (pencarian dokumen + snippet) dan "
                "<b>Ask AI</b> (tanya jawab berbasis konteks dokumen, RAG).",
                "<b>RAG (Retrieval-Augmented Generation):</b> ambil cuplikan relevan dulu, "
                "baru minta model chat menjawab dari cuplikan itu.",
                "<b>Isolasi per user:</b> AI hanya melihat dokumen yang sudah di-ingest "
                "untuk akun tersebut (OCR_DONE / SKIPPED).",
                "<b>Embedding opsional:</b> vektor semantic disimpan di tabel "
                "<i>document_chunks</i> untuk retrieval lebih dalam di Ask AI.",
            ],
            s,
        )
    )
    story.append(
        callout(
            "<b>Inti produk:</b> dokumen cloud Bappenas diambil, di-OCR, lalu bisa "
            "dicari dan ditanyakan. AI membantu <i>menjelaskan</i> dan <i>menyusun</i> "
            "jawaban, bukan mengarang dari luar arsip.",
            "sky",
        )
    )

    # ========== 2. KONSEP SEDERHANA ==========
    story.append(Paragraph("2. Konsep sederhana (untuk non-teknis)", s["h1"]))
    story.append(
        Paragraph(
            "Analogi singkat: perpustakaan digital dengan pustakawan AI.",
            s["body"],
        )
    )
    vflow(
        story,
        [
            ("1. PDF di cloud diambil ke sistem", TEAL),
            ("2. Paperless membaca/OCR teks dari PDF", TEAL),
            ("3. Teks dibagi jadi potongan (chunk) + embedding (vektor)", TEAL),
            ("4. User bertanya: sistem cari potongan relevan", TEAL),
            ("5. Model AI menjawab HANYA dari potongan itu + kutip sumber", TEAL),
        ],
        s,
        "Alur dari file PDF hingga jawaban Ask AI",
    )
    story.append(Paragraph("Yang perlu dipahami stakeholder:", s["h2"]))
    story.extend(
        bullets(
            [
                "AI <b>tidak</b> membaca PDF mentah setiap kali; ia membaca teks OCR yang sudah disimpan.",
                "Kualitas jawaban bergantung pada kualitas OCR (scan buruk, PDF gambar tanpa teks).",
                "Ask AI bisa toleran sedikit pada variasi kata (semantic), tetapi tetap terikat konteks.",
                "Search lebih ketat pada kata kunci (full-text Whoosh), tanpa generasi jawaban panjang.",
            ],
            s,
        )
    )

    # ========== 3. SEARCH VS ASK AI ==========
    story.append(PageBreak())
    story.append(Paragraph("3. Search vs Ask AI", s["h1"]))
    story.append(
        simple_table(
            ["Aspek", "Search (/search)", "Ask AI (/ask)"],
            [
                [
                    "Tujuan",
                    "Menemukan dokumen yang cocok dengan kata kunci",
                    "Menjawab pertanyaan natural language dari isi dokumen",
                ],
                [
                    "Teknologi retrieval",
                    "Paperless Whoosh full-text (+ filter user, folder, tanggal)",
                    "Hybrid: Whoosh multi-query + ranking nama/isian + cosine embedding chunk",
                ],
                [
                    "Generasi AI",
                    "Tidak (hanya snippet OCR ~320 karakter per dokumen)",
                    "Ya: OpenAI chat model (default gpt-4o-mini)",
                ],
                [
                    "Output",
                    "Daftar dokumen, snippet, ringkasan folder/tanggal",
                    "Jawaban prose + daftar sumber (citations)",
                ],
                [
                    "Riwayat",
                    "Tidak ada percakapan",
                    "Conversation + hingga 10 turn history",
                ],
                [
                    "Pin / fokus",
                    "Filter folder",
                    "@ pin dokumen di Ask AI (focusDocIds, max 5)",
                ],
                [
                    "Kapan dipakai",
                    "Cari file, cek ada/tidak, browsing cepat",
                    "Ringkas, jelaskan, bandingkan, daftar tematik",
                ],
            ],
            col_widths=[4.2 * cm, 6.2 * cm, 6.5 * cm],
        )
    )
    story.append(Spacer(1, 0.3 * cm))
    story.append(
        callout(
            "<b>Search</b> = mesin temu dokumen. <b>Ask AI</b> = asisten yang membaca "
            "cuplikan lalu menjawab. Keduanya memakai isolasi user yang sama, tetapi "
            "bukan duplikat fungsi.",
            "info",
        )
    )

    # ========== 4. ARSITEKTUR RAG ==========
    story.append(Paragraph("4. Arsitektur RAG saat ini", s["h1"]))
    story.append(
        Paragraph(
            "DocSearch memakai <b>hybrid retrieval</b>: kombinasi pencarian kata kunci "
            "(Paperless) dan similarity vektor (embedding chunk), lalu <b>single-shot generation</b> "
            "dengan prompt terstruktur.",
            s["body"],
        )
    )
    story.append(HFlow(
        ["Cloud PDF", "Sync Worker", "Paperless OCR", "Chunk + Embed", "PostgreSQL"],
        fills=[TEAL, TEAL, TEAL, SKY, TEAL_DARK],
        width=16.5 * cm,
        box_h=34,
    ))
    story.append(Paragraph("Saat user bertanya di Ask AI:", s["caption"]))
    story.append(HFlow(
        ["Pertanyaan", "Retrieve docs", "Rank chunks", "Build context", "gpt-4o-mini"],
        fills=[AMBER, TEAL, SKY, SKY, TEAL_DARK],
        width=16.5 * cm,
        box_h=34,
    ))
    story.append(Spacer(1, 0.2 * cm))
    story.append(
        Paragraph(
            "File inti implementasi: <i>app/src/lib/openai.ts</i> (retrieve + generate), "
            "<i>app/src/lib/embeddings.ts</i> (chunk + embed query), "
            "<i>sync-worker/src/embeddings.ts</i> (indexing saat OCR selesai / backfill), "
            "<i>app/src/app/api/chat/route.ts</i> (API Ask AI).",
            s["body"],
        )
    )

    # ========== 5. KOMPONEN RAG ==========
    story.append(PageBreak())
    story.append(Paragraph("5. Komponen RAG: apa saja yang ada", s["h1"]))
    story.append(
        simple_table(
            ["Komponen", "Implementasi sekarang", "Catatan"],
            [
                [
                    "Sumber dokumen",
                    "Teks OCR Paperless (content field)",
                    "Diambil setelah sync OCR_DONE; dedup hash antar user",
                ],
                [
                    "Chunking",
                    "~1000 karakter, overlap 150",
                    "Sliding window; normalisasi spasi",
                ],
                [
                    "Embedding model",
                    "text-embedding-3-small (default)",
                    "Env: OPENAI_EMBEDDING_MODEL",
                ],
                [
                    "Penyimpanan vektor",
                    "JSON float[] di document_chunks.embedding",
                    "Per userId + paperlessDocumentId + chunkIndex",
                ],
                [
                    "Indexing",
                    "sync-worker indexDocumentChunks + backfill batch",
                    "Clone chunk peer jika dokumen sama sudah di-embed user lain",
                ],
                [
                    "Retrieval keyword",
                    "Paperless searchDocuments (Whoosh)",
                    "Multi-query expand, title + full-text, favorite folder boost",
                ],
                [
                    "Retrieval semantic",
                    "Cosine similarity query vs chunk embeddings",
                    "Top chunks global, max ~12-20 chunk masuk konteks",
                ],
                [
                    "Retrieval heuristik",
                    "bestContentWindow, nameOverlap, contentOverlap",
                    "Fallback jika embedding tidak ada",
                ],
                [
                    "Generator",
                    "gpt-4o-mini (default)",
                    "temperature 0.2; max_tokens bervariasi per intent",
                ],
                [
                    "Prompt / guardrails",
                    "SYSTEM_PROMPT + mode hint (list/detail/compare)",
                    "Jawab hanya dari konteks; format daftar/detail",
                ],
                [
                    "Citations",
                    "filterCitationsUsedInAnswer",
                    "Sumber yang benar-benar dirujuk di jawaban",
                ],
            ],
            col_widths=[3.5 * cm, 5.5 * cm, 6.5 * cm],
        )
    )

    # ========== 6. ALUR TEKNIS ==========
    story.append(Paragraph("6. Alur teknis Ask AI (langkah demi langkah)", s["h1"]))
    vflow(
        story,
        [
            ("User kirim pertanyaan (+ scope / pin @ dokumen)", TEAL),
            ("resolveScopedDocIds: batas dokumen user", TEAL),
            ("resolveDocs: Paperless multi-search + ranking", TEAL),
            ("detectIntent: list | detail | compare | default", SKY),
            ("buildContext: chunk embedding atau window teks", SKY),
            ("buildMessages: system + konteks + history 10 turn", SKY),
            ("OpenAI chat completion (stream)", TEAL_DARK),
            ("Simpan jawaban + audit usage + citations", TEAL),
        ],
        s,
        "Pipeline askDocuments / askDocumentsStream",
    )
    story.append(Paragraph("Detail retrieval dokumen (resolveDocs):", s["h2"]))
    story.extend(
        bullets(
            [
                "Ekspansi query: beberapa varian frasa dari pertanyaan (expandSearchQueries).",
                "Parallel search: full-text + title-only untuk setiap varian.",
                "Boost folder favorit user jika path/file cocok kata kunci.",
                "Ranking: overlap nama file + overlap isi + boost favorit.",
                "Pin (@): hanya dokumen focusDocIds (max 5), skip broad search.",
                "Limit kandidat: default ~25 dokumen, list mode hingga 8 masuk konteks.",
            ],
            s,
        )
    )
    story.append(Paragraph("Detail buildContext:", s["h2"]))
    story.extend(
        bullets(
            [
                "<b>Mode list:</b> tidak pakai embedding; cuplikan kaya per dokumen (~1400 char).",
                "<b>Mode detail/compare:</b> max 3 dokumen, chunk lebih dalam (~4500 char / 6 chunk/doc).",
                "<b>Mode default:</b> hybrid embedding: ambil top 12 chunk, max 3 chunk per dokumen.",
                "Fallback: bestContentWindow jika dokumen belum punya chunk embedding.",
                "Batas DB read: take 1200 chunk rows dari kandidat doc IDs.",
            ],
            s,
        )
    )

    # ========== 7. INTENT & LIMITS ==========
    story.append(PageBreak())
    story.append(Paragraph("7. Mode intent & batas konteks", s["h1"]))
    story.append(
        Paragraph(
            "Sistem mendeteksi intent dari kata kunci pertanyaan (bukan hardcode topik). "
            "Ini mengatur kedalaman bacaan vs cakupan dokumen.",
            s["body"],
        )
    )
    story.append(
        simple_table(
            ["Intent", "Trigger contoh", "Perilaku"],
            [
                [
                    "list",
                    "cari, sebutkan, apa saja, dokumen tentang",
                    "Semua dokumen di konteks (max 8) dengan ringkasan per item",
                ],
                [
                    "detail",
                    "jelaskan, analisis, poin penting, apa isi",
                    "Gali 1-3 dokumen paling relevan, chunk lebih banyak",
                ],
                [
                    "compare",
                    "bandingkan, persamaan, perbedaan",
                    "Hanya dokumen pin/compare; struktur banding",
                ],
                [
                    "default",
                    "pertanyaan umum",
                    "Hybrid retrieval standar",
                ],
            ],
            col_widths=[2.5 * cm, 5.5 * cm, 8.5 * cm],
        )
    )
    story.append(Spacer(1, 0.3 * cm))
    story.append(Paragraph("Konstanta batas (openai.ts):", s["h2"]))
    story.append(
        simple_table(
            ["Parameter", "Nilai", "Fungsi"],
            [
                ["MAX_CONTEXT_DOCS", "8", "Dokumen masuk prompt"],
                ["MAX_CANDIDATE_DOCS", "25", "Kandidat dari Paperless"],
                ["MAX_DOCS_DETAIL", "3", "Dokumen untuk mode detail"],
                ["MAX_CHUNKS_IN_CONTEXT", "12", "Chunk embedding (default)"],
                ["MAX_CHUNKS_DETAIL", "20", "Chunk embedding (detail)"],
                ["CHUNK_SIZE / overlap", "1000 / 150", "Saat indexing"],
                ["CONTENT_CHARS_PER_DOC", "2800", "Fallback teks per dokumen"],
                ["CONTENT_CHARS_LIST", "1400", "Mode daftar"],
                ["CONTENT_CHARS_DETAIL", "4500", "Mode detail"],
                ["max_tokens jawaban", "1400-2400", "Tergantung intent"],
                ["Chat history", "10 turn", "Percakapan lanjutan"],
                ["Rate limit Ask AI", "30/jam/user", "API /api/chat"],
            ],
            col_widths=[4.5 * cm, 3 * cm, 9 * cm],
        )
    )

    # ========== 8. SCOPE & ISOLASI ==========
    story.append(Paragraph("8. Scope, pin dokumen, dan isolasi user", s["h1"]))
    story.append(
        simple_table(
            ["Scope mode", "Arti", "Dokumen yang boleh di-AI"],
            [
                ["all", "Default", "Semua OCR_DONE/SKIPPED user"],
                ["folder", "Folder tertentu", "SyncFile di path prefix folder"],
                ["docs", "Daftar ID", "Hanya docIds yang dipilih"],
            ],
            col_widths=[3 * cm, 4 * cm, 9.5 * cm],
        )
    )
    story.extend(
        bullets(
            [
                "<b>Pin @:</b> focusDocIds (max 5) memaksa analisis hanya pada dokumen itu.",
                "<b>Embedding per user:</b> document_chunks.userId, meski Paperless doc sama bisa di-clone.",
                "<b>Search:</b> filter paperlessDocumentId ke set allowed user sebelum tampil.",
                "Tidak ada cross-user retrieval: allowedDocIds selalu dari sync_files user.",
            ],
            s,
        )
    )

    # ========== 9. BATASAN ==========
    story.append(PageBreak())
    story.append(Paragraph("9. Batasan & risiko jawaban AI saat ini", s["h1"]))
    story.append(
        callout(
            "<b>Penting:</b> AI bisa menjawab dengan nada yakin meski bukti kurang, "
            "terutama jika pertanyaan dan dokumen <i>topik mirip</i> tetapi <i>jenis berbeda</i> "
            "(contoh: ditanya kejadian bencana, dokumen hanya rencana preventif). "
            "Ini bukan bug satu kasus, melainkan risiko RAG generik.",
            "warn",
        )
    )
    story.extend(
        bullets(
            [
                "<b>Konteks terbatas:</b> tidak seluruh dokumen dibaca setiap turn; hanya top-N chunk.",
                "<b>Single-shot:</b> tidak ada langkah verifikasi bukti sebelum jawab final.",
                "<b>OCR error:</b> typo OCR, layout rusak, tabel hilang mengurangi akurasi.",
                "<b>Search vs semantic:</b> Search tidak fuzzy; Ask AI toleran semantic tapi tetap bisa salah jika retrieval salah.",
                "<b>PDF gambar:</b> bergantung OCR Paperless (OCR_MODE=auto); scan buruk = teks buruk.",
                "<b>Standalone PNG/JPG:</b> tidak di-ingest sebagai dokumen teks.",
                "<b>Tidak ada world knowledge guard:</b> model bisa mengisi celah jika prompt kurang ketat.",
                "<b>Biaya & latency:</b> detail mode + banyak chunk = token lebih besar.",
            ],
            s,
        )
    )

    # ========== 10. PENGEMBANGAN ==========
    story.append(Paragraph("10. Arah pengembangan (umum, bukan kasus per kasus)", s["h1"]))
    story.append(
        Paragraph(
            "Prinsip: aturan umum yang menutup banyak edge case tanpa daftar skenario panjang.",
            s["body"],
        )
    )
    story.append(Paragraph("10.1 Tiga filter epistemik (wajib di prompt / pipeline)", s["h2"]))
    story.extend(
        bullets(
            [
                "<b>Apa yang ditanya?</b> kejadian, rencana, perbandingan, daftar, angka, opini.",
                "<b>Apa bukti di OCR?</b> kutipan fakta yang mendukung klaim.",
                "<b>Jika bukti kurang:</b> jawab jujur, sebut ketidaksesuaian pertanyaan vs isi dokumen.",
            ],
            s,
        )
    )
    story.append(Paragraph("10.2 Rekomendasi implementasi bertahap", s["h2"]))
    story.append(
        simple_table(
            ["Prioritas", "Usulan", "Manfaat"],
            [
                [
                    "P1",
                    "Perkuat SYSTEM_PROMPT: grounded + mismatch handling",
                    "Cepat, impact besar; kurangi jawaban 'nyambung tapi salah'",
                ],
                [
                    "P2",
                    "Kerangka jawaban analisis standar (bukti / gap / interpretasi)",
                    "Struktur konsisten untuk semua topik",
                ],
                [
                    "P3",
                    "Mode analisis: konteks lebih besar + pin dokumen",
                    "Kedalaman tanpa hardcode kasus",
                ],
                [
                    "P4",
                    "Multi-step: retrieve → cek kecocokan bukti → jawab final",
                    "Model 'berpikir' tanpa rule per topik",
                ],
                [
                    "P5",
                    "Model lebih kuat hanya untuk mode analisis",
                    "Kualitas reasoning, biaya terkendali",
                ],
            ],
            col_widths=[1.8 * cm, 6.5 * cm, 8.2 * cm],
        )
    )
    story.append(
        callout(
            "<b>Tidak perlu:</b> rule 'kalau bencana maka ...'. "
            "<b>Cukup:</b> bukti dulu, bedakan jenis klaim, akui jika tidak ada.",
            "info",
        )
    )

    # ========== 11. RAG KE DEPAN ==========
    story.append(PageBreak())
    story.append(Paragraph("11. RAG ke depan: teknik yang cocok ditambahkan", s["h1"]))
    story.append(
        Paragraph(
            "Tabel berikut memetakan teknik RAG: yang sudah ada vs yang layak ditambahkan "
            "untuk DocSearch (arsip dokumen pemerintah, Bahasa Indonesia, skala 10k-100k dokumen).",
            s["body"],
        )
    )
    story.append(
        simple_table(
            ["Teknik RAG", "Status sekarang", "Cocok ditambahkan?", "Catatan untuk DocSearch"],
            [
                [
                    "Full-text keyword (BM25/Whoosh)",
                    "Ya (Paperless)",
                    "Pertahankan",
                    "Bagus untuk nama file, nomor surat, istilah resmi",
                ],
                [
                    "Semantic chunk retrieval",
                    "Ya (cosine di Postgres)",
                    "Tingkatkan",
                    "Naikkan recall dengan reranker; index vector DB jika >100k chunk",
                ],
                [
                    "Hybrid fusion (RRF)",
                    "Parsial (manual ranking)",
                    "Ya",
                    "Gabung skor Whoosh + embedding secara eksplisit",
                ],
                [
                    "Query expansion",
                    "Ya (multi-query heuristik)",
                    "Ya",
                    "Bisa tambah LLM query rewrite ringan",
                ],
                [
                    "Reranking (cross-encoder / Cohere)",
                    "Tidak",
                    "Ya (prioritas tinggi)",
                    "Top 50 chunk → rerank → top 12; akurasi retrieval naik signifikan",
                ],
                [
                    "Metadata filtering",
                    "Parsial (folder, tanggal Search)",
                    "Ya",
                    "Filter jenis dokumen, tahun, path, status di Ask AI",
                ],
                [
                    "Parent-child chunking",
                    "Tidak",
                    "Ya",
                    "Chunk kecil untuk search, parent section untuk konteks jawaban",
                ],
                [
                    "Multi-step / agentic RAG",
                    "Tidak",
                    "Ya (mode analisis)",
                    "Retrieve → verify evidence → synthesize",
                ],
                [
                    "Citation grounding / quote-only",
                    "Parsial",
                    "Ya",
                    "Wajib kutip span OCR sebelum klaim fakta",
                ],
                [
                    "Self-RAG / reflection",
                    "Tidak",
                    "Opsional",
                    "Model cek 'apakah jawaban didukung konteks?' sebelum kirim",
                ],
                [
                    "Graph RAG",
                    "Tidak",
                    "Opsional jangka panjang",
                    "Jika relasi antar dokumen (rujukan silang) jadi penting",
                ],
                [
                    "Fine-tuning model",
                    "Tidak",
                    "Biasanya tidak perlu",
                    "RAG + prompt biasanya cukup untuk arsip institusi",
                ],
            ],
            col_widths=[3.2 * cm, 2.8 * cm, 2.5 * cm, 6 * cm],
        )
    )

    # ========== 12. MODEL ==========
    story.append(PageBreak())
    story.append(Paragraph("12. Model AI sekarang vs rekomendasi ke depan", s["h1"]))
    story.append(Paragraph("12.1 Model yang dipakai saat ini", s["h2"]))
    story.append(
        simple_table(
            ["Fungsi", "Env var", "Default", "Kapan dipanggil"],
            [
                [
                    "Chat / jawaban Ask AI",
                    "OPENAI_MODEL",
                    "gpt-4o-mini",
                    "Setiap pertanyaan Ask AI (stream)",
                ],
                [
                    "Embedding chunk + query",
                    "OPENAI_EMBEDDING_MODEL",
                    "text-embedding-3-small",
                    "Indexing sync-worker; embedQuery saat Ask AI",
                ],
            ],
            col_widths=[3.5 * cm, 4 * cm, 3.5 * cm, 5.5 * cm],
        )
    )
    story.append(Paragraph("12.2 Karakteristik model sekarang", s["h2"]))
    story.extend(
        bullets(
            [
                "<b>gpt-4o-mini:</b> murah, cepat, cukup untuk ringkasan dan daftar; reasoning dalam untuk analisis kompleks.",
                "<b>text-embedding-3-small:</b> murah, dimensi efisien, cocok untuk semantic search Bahasa Indonesia campuran.",
                "Pricing estimasi di admin audit: default ~$0.15/$0.60 per 1M token chat, ~$0.02 per 1M embed.",
            ],
            s,
        )
    )
    story.append(Paragraph("12.3 Rekomensi model ke depan (bertahap)", s["h2"]))
    story.append(
        simple_table(
            ["Use case", "Model usulan", "Alasan"],
            [
                [
                    "Default Ask AI (tetap)",
                    "gpt-4o-mini",
                    "Biaya rendah, latency baik untuk 80% pertanyaan",
                ],
                [
                    "Mode analisis / multi-doc reasoning",
                    "gpt-4o atau gpt-4.1-mini",
                    "Lebih patuh instruksi epistemik, reasoning lebih kuat",
                ],
                [
                    "Query rewrite ringan",
                    "gpt-4o-mini",
                    "1 call murah sebelum retrieval",
                ],
                [
                    "Embedding (tetap / upgrade)",
                    "text-embedding-3-small → large",
                    "Large jika recall semantic masih kurang setelah rerank",
                ],
                [
                    "Reranker",
                    "Cohere rerank / bge-reranker lokal",
                    "Tidak generatif; fokus ranking chunk",
                ],
                [
                    "OCR (bukan OpenAI)",
                    "Paperless Tesseract",
                    "OCR tetap di Paperless; OpenAI tidak menggantikan OCR",
                ],
            ],
            col_widths=[4.5 * cm, 4.5 * cm, 7 * cm],
        )
    )
    story.append(
        callout(
            "<b>Strategi biaya:</b> model kuat hanya untuk mode analisis atau user role tertentu; "
            "embedding di-backfill batch (EMBED_BACKFILL_BATCH); audit OpenAI di Admin.",
            "sky",
        )
    )

    # ========== 13. BIAYA & OPS ==========
    story.append(Paragraph("13. Biaya, audit, dan operasional", s["h1"]))
    story.extend(
        bullets(
            [
                "Setiap Ask AI mencatat promptTokens, completionTokens, embeddingTokens ke audit.",
                "Admin → Audit: agregasi biaya estimasi USD (openai-pricing.ts).",
                "Rate limit: 30 pertanyaan/jam/user pada /api/chat.",
                "Embedding backfill: sync-worker batch default 5 dokumen per siklus.",
                "Tanpa OPENAI_API_KEY: Ask AI error; Search tetap jalan (tanpa generasi).",
                "Health check: /api/health melaporkan openai: true/false.",
            ],
            s,
        )
    )
    story.append(Paragraph("Env terkait AI (.env.example):", s["h2"]))
    story.append(
        Paragraph(
            "OPENAI_API_KEY, OPENAI_MODEL, OPENAI_EMBEDDING_MODEL, "
            "OPENAI_PRICE_CHAT_INPUT_PER_MTok, OPENAI_PRICE_CHAT_OUTPUT_PER_MTok, "
            "OPENAI_PRICE_EMBED_PER_MTok, EMBED_BACKFILL_BATCH",
            ParagraphStyle(
                "mono",
                fontSize=8,
                fontName="Courier",
                textColor=colors.HexColor("#1E293B"),
                leading=11,
            ),
        )
    )

    # ========== 14. KEMUNGKINAN PERTANYAAN ==========
    story.append(PageBreak())
    story.append(Paragraph("14. Kemungkinan pertanyaan (materi demo & pelatihan)", s["h1"]))
    story.append(
        Paragraph(
            "Bab ini mengumpulkan pola pertanyaan yang <b>kemungkinan besar</b> muncul saat "
            "penggunaan nyata, demo ke stakeholder, atau uji coba pelatihan. "
            "Gunakan sebagai skenario latihan: cek apakah jawaban terikat dokumen, "
            "sumber tercantum, dan AI mengakui jika bukti tidak ada.",
            s["body"],
        )
    )
    story.append(
        callout(
            "<b>Tips demo:</b> mulai dari Search (temukan file), lalu Ask AI (ringkas isi). "
            "Untuk analisis mendalam, pin 1-2 dokumen dengan @ sebelum bertanya detail.",
            "sky",
        )
    )

    story.append(Paragraph("14.1 Pola intent yang sistem mendeteksi", s["h2"]))
    story.append(
        simple_table(
            ["Intent", "Kata kunci umum", "Contoh singkat", "Harapan jawaban"],
            [
                [
                    "list",
                    "cari, sebutkan, apa saja, dokumen tentang",
                    "Ada dokumen tentang RPJMN?",
                    "Daftar semua dokumen relevan di konteks + ringkasan per item",
                ],
                [
                    "detail",
                    "jelaskan, uraikan, poin penting, apa isi",
                    "Jelaskan isi undangan rapat itu",
                    "Jawaban langsung + poin fakta dari OCR",
                ],
                [
                    "compare",
                    "bandingkan, persamaan, perbedaan",
                    "Bandingkan dua draft laporan ini",
                    "Hanya dokumen pin; persamaan, beda, kesimpulan",
                ],
                [
                    "default",
                    "pertanyaan umum",
                    "Apa topik utama dokumen terkait anggaran?",
                    "Hybrid retrieval standar",
                ],
            ],
            col_widths=[2.2 * cm, 3.8 * cm, 4.5 * cm, 4 * cm],
        )
    )

    story.append(Paragraph("14.2 Ask AI: pencarian & daftar dokumen", s["h2"]))
    story.extend(
        bullets(
            [
                "Ada dokumen apa saja tentang perencanaan pembangunan?",
                "Cari file terkait reformasi birokrasi di arsip saya.",
                "Sebutkan 5 dokumen terbaru tentang infrastruktur.",
                "Apa saja undangan rapat yang membahas evaluasi program?",
                "Lihat dokumen yang relevan dengan kebijakan fiskal.",
                "Berapa dokumen tentang mitigasi bencana yang sudah di-scan?",
                "Temukan laporan progress yang terkait Sumatera.",
                "Daftar berkas PDF tentang kerja sama internasional.",
            ],
            s,
        )
    )
    story.append(
        Paragraph(
            "<i>Modul terbaik:</i> Ask AI (mode list) atau Search jika user hanya ingin daftar file cepat.",
            s["caption"],
        )
    )

    story.append(Paragraph("14.3 Ask AI: ringkas & detail isi", s["h2"]))
    story.extend(
        bullets(
            [
                "Ringkas isi dokumen ini dalam 5 poin utama.",
                "Jelaskan agenda rapat yang tercantum di undangan.",
                "Apa keputusan atau kesimpulan dalam nota dinas ini?",
                "Sebutkan tanggal, nomor surat, dan pihak yang terlibat.",
                "Uraikan rekomendasi teknis yang disampaikan di laporan.",
                "Apa isi pokok bahasan dalam memo internal?",
                "Poin penting dari draft kebijakan ini apa saja?",
                "Siapa peserta atau undangan yang disebutkan di dokumen?",
                "Ada target atau indikator kinerja yang disebut? Sebutkan.",
            ],
            s,
        )
    )
    story.append(
        Paragraph(
            "<i>Tips:</i> pin dokumen (@) lalu tanya detail agar konteks tidak tersebar ke file lain.",
            s["caption"],
        )
    )

    story.append(Paragraph("14.4 Ask AI: perbandingan & multi-dokumen", s["h2"]))
    story.extend(
        bullets(
            [
                "Bandingkan versi draft A dan draft B: apa yang berubah?",
                "Apa persamaan dan perbedaan dua laporan evaluasi ini?",
                "Dokumen mana lebih lengkap membahas aspek anggaran?",
                "Bedakan fokus laporan tahun ini vs laporan tahun lalu.",
                "Apakah rekomendasi di nota 1 sama dengan nota 2?",
            ],
            s,
        )
    )
    story.append(
        Paragraph(
            "<i>Syarat:</i> pin 2-5 dokumen (@) sebelum bertanya; mode compare aktif otomatis.",
            s["caption"],
        )
    )

    story.append(PageBreak())
    story.append(Paragraph("14.5 Pertanyaan lanjutan (multi-turn)", s["h2"]))
    story.append(
        Paragraph(
            "Ask AI menyimpan hingga 10 turn riwayat. Contoh alur percakapan yang realistis:",
            s["body"],
        )
    )
    story.append(
        simple_table(
            ["Turn", "Pertanyaan user", "Tujuan uji"],
            [
                ["1", "Ada dokumen tentang rapat koordinasi program?", "Retrieval awal, mode list"],
                ["2", "Yang terbaru saja", "Recency + filter implisit"],
                ["3", "Jelaskan isi nomor 2", "Detail pada item daftar sebelumnya"],
                ["4", "Siapa yang diundang?", "Follow-up fakta spesifik"],
                ["5", "Ada tanggal pelaksanaan?", "Cek bukti OCR vs mengarang"],
                ["6", "Kalau tidak ada, katakan tidak ditemukan", "Uji kejujuran AI"],
            ],
            col_widths=[1.5 * cm, 7.5 * cm, 7.5 * cm],
        )
    )
    story.extend(
        bullets(
            [
                "Dari poin 3, elaborasi lebih dalam tentang risiko yang disebut.",
                "Buat ringkasan eksekutif 3 paragraf untuk atasan.",
                "Ubah ke format bullet untuk presentasi.",
                "Apa yang belum dijelaskan di dokumen ini?",
            ],
            s,
        )
    )

    story.append(Paragraph("14.6 Search: pertanyaan kata kunci (bukan generatif)", s["h2"]))
    story.extend(
        bullets(
            [
                "RPJMN 2025",
                "undangan rapat direktur",
                "nota dinas anggaran",
                "evaluasi program 2024",
                "draft laporan akhir",
                "surat edaran internal",
                "rencana aksi mitigasi",
                "TOR konsultan",
            ],
            s,
        )
    )
    story.append(
        Paragraph(
            "<i>Perbedaan:</i> Search cocok untuk exact/partial keyword dan browsing cepat; "
            "tidak menghasilkan jawaban naratif panjang.",
            s["caption"],
        )
    )

    story.append(Paragraph("14.7 Pertanyaan stakeholder (non-teknis)", s["h2"]))
    faq_stakeholder = [
        (
            "Apakah AI menggantikan pegawai yang membaca dokumen?",
            "Tidak. AI mempercepat penemuan dan ringkasan; pegawai tetap memvalidasi sumber dan keputusan.",
        ),
        (
            "Apakah jawaban AI selalu benar?",
            "Tidak. Jawaban terikat cuplikan OCR yang diambil; bisa kurang lengkap atau salah jika retrieval/topik mirip.",
        ),
        (
            "Bisa dipakai untuk dokumen sensitif?",
            "Isolasi per user; data cuplikan dikirim ke OpenAI jika Ask AI aktif. Kebijakan institusi tentang cloud AI harus dipatuhi.",
        ),
        (
            "Berapa biaya per pertanyaan?",
            "Tergantung panjang konteks; estimasi di Admin Audit. Default model murah (gpt-4o-mini).",
        ),
        (
            "Apakah semua PDF di cloud langsung bisa ditanya?",
            "Hanya PDF yang sudah di-ingest dan OCR selesai (status OCR_DONE/SKIPPED).",
        ),
        (
            "Beda dengan ChatGPT umum?",
            "DocSearch jawab dari arsip Anda yang sudah di-OCR, dengan scope user dan citations dokumen.",
        ),
    ]
    for q, a in faq_stakeholder:
        story.append(Paragraph(f"<b>{q}</b>", s["h3"]))
        story.append(Paragraph(a, s["body"]))

    story.append(Paragraph("14.8 Pertanyaan teknis & operasional", s["h2"]))
    story.extend(
        bullets(
            [
                "Kenapa Ask AI bilang tidak ada dokumen? (belum ingest / scope folder / query terlalu umum)",
                "Kenapa Search ada hasil tapi Ask AI jawab generik? (retrieval berbeda; cek citations)",
                "Kenapa embedding belum jalan? (OPENAI_API_KEY, backfill worker, dokumen baru)",
                "Berapa lama OCR sebelum bisa ditanya? (tergantung antrian Paperless)",
                "Bisa batasi AI hanya ke satu folder? (scope folder di conversation)",
                "Apakah ada rate limit? (30 pertanyaan/jam/user)",
                "Log aktivitas AI ada di mana? (Admin Audit)",
            ],
            s,
        )
    )

    story.append(Paragraph("14.9 Pertanyaan berisiko atau sering menantang", s["h2"]))
    story.append(
        callout(
            "<b>Latihan penting:</b> pertanyaan di bawah sering menguji apakah AI menjawab "
            "dari bukti atau mengarang. Idealnya AI membedakan jenis klaim dan mengakui gap.",
            "warn",
        )
    )
    story.append(
        simple_table(
            ["Pertanyaan contoh", "Risiko", "Respons ideal"],
            [
                [
                    "Apa bencana yang terjadi tahun ini?",
                    "Dokumen hanya rencana preventif, bukan laporan kejadian",
                    "Jelaskan dokumen membahas mitigasi/rencana, bukan daftar kejadian",
                ],
                [
                    "Berapa total anggaran program X?",
                    "Angka tersebar / tidak ada di OCR",
                    "Sebut angka hanya jika ada kutipan; otherwise tidak ditemukan",
                ],
                [
                    "Siapa yang bersalah / siapa paling bertanggung jawab?",
                    "Pertanyaan normatif di luar teks",
                    "Hanya fakta yang tertulis; tidak menilai",
                ],
                [
                    "Prediksi dampak ke depan?",
                    "Generatif tanpa bukti",
                    "Batasi pada proyeksi yang eksplisit di dokumen",
                ],
                [
                    "Ringkas semua dokumen di cloud",
                    "Scope terlalu luas, konteks terbatas",
                    "Minta spesifik topik/folder atau pin dokumen",
                ],
                [
                    "Apa isi dokumen yang belum di-scan?",
                    "Tidak ada teks OCR",
                    "Jelaskan perlu ingest/OCR dulu",
                ],
                [
                    "Terjemahkan ke Inggris seluruh isi",
                    "Token besar, hilang struktur",
                    "Pin satu dokumen; ringkas per bagian",
                ],
            ],
            col_widths=[4.5 * cm, 4.5 * cm, 5.5 * cm],
        )
    )

    story.append(Paragraph("14.10 Matriks cepat: pertanyaan → modul → tips", s["h2"]))
    story.append(
        simple_table(
            ["Kebutuhan user", "Modul", "Contoh pertanyaan", "Tips sukses"],
            [
                [
                    "Cari file cepat",
                    "Search",
                    "nota dinas reformasi",
                    "Gunakan kata kunci unik; filter folder/tanggal",
                ],
                [
                    "Daftar tematik",
                    "Ask AI",
                    "Apa saja dokumen tentang ...?",
                    "Scope folder jika topik besar",
                ],
                [
                    "Ringkasan eksekutif",
                    "Ask AI + pin",
                    "@laporan.pdf ringkas 5 poin",
                    "Pin 1 dokumen; mode detail",
                ],
                [
                    "Banding versi",
                    "Ask AI + pin 2",
                    "Bandingkan @draft1 @draft2",
                    "Max 5 pin; pertanyaan eksplisit compare",
                ],
                [
                    "Eksplorasi bebas",
                    "Ask AI",
                    "Apa yang terkait dengan ...?",
                    "Cek citations; lanjutkan dengan pertanyaan spesifik",
                ],
                [
                    "Audit penggunaan",
                    "Admin",
                    "(bukan pertanyaan AI)",
                    "Panel Audit: token & estimasi biaya",
                ],
            ],
            col_widths=[3.2 * cm, 2.5 * cm, 4.8 * cm, 4 * cm],
        )
    )

    story.append(Paragraph("14.11 Checklist sesi demo (15 menit)", s["h2"]))
    story.extend(
        bullets(
            [
                "1. Login user demo dengan kredensial cloud valid.",
                "2. Library: tunjukkan folder sudah OCR (ikon status).",
                "3. Search: kata kunci spesifik, tunjuk snippet OCR.",
                "4. Ask AI list: 'Sebutkan dokumen tentang [topik yang ada di arsip demo]'.",
                "5. Pin 1 dokumen (@): 'Jelaskan poin penting'.",
                "6. Follow-up: 'Siapa pihak yang disebut?' (uji multi-turn).",
                "7. Pertanyaan sulit: topik mirip tapi jenis berbeda (uji kejujuran).",
                "8. Tunjuk citations / sumber di jawaban.",
                "9. Admin (jika audiens teknis): cuplikan audit OpenAI.",
                "10. Tutup: batasan OCR, isolasi user, tidak menggantikan validasi manusia.",
            ],
            s,
        )
    )

    # ========== 15. FAQ ==========
    story.append(PageBreak())
    story.append(Paragraph("15. FAQ AI", s["h1"]))
    faq = [
        (
            "Apakah AI membaca semua dokumen saya setiap kali?",
            "Tidak. Sistem memilih kandidat via Paperless search + ranking, lalu memasukkan "
            "sebagian cuplikan (chunk/teks) ke prompt. Batas eksplisit: ~8 dokumen, ~12-20 chunk.",
        ),
        (
            "Kenapa jawaban bisa 'nyambung' tapi tidak tepat?",
            "Retrieval menemukan dokumen topik mirip, model mengisi celah tanpa bukti kuat. "
            "Solusi: prompt epistemik + multi-step verify + pin dokumen untuk analisis mendalam.",
        ),
        (
            "Search tidak menemukan, tapi Ask AI menjawab?",
            "Ask AI bisa semantic; Search strict keyword. Bisa juga Ask AI mengambil dokumen "
            "kurang relevan lalu menjawab generik. Selalu cek citations.",
        ),
        (
            "Apakah typo di dokumen ditangani?",
            "Tidak ada spell-check. OCR typo mengurangi match Search; Ask AI sedikit toleran via semantic.",
        ),
        (
            "Bisa tanya dokumen gambar / scan buruk?",
            "Hanya jika OCR Paperless menghasilkan teks. Kualitas scan menentukan hasil.",
        ),
        (
            "Data dikirim ke OpenAI?",
            "Ya: cuplikan teks OCR (chunk) dan pertanyaan user dikirim ke API OpenAI saat Ask AI / embedding.",
        ),
        (
            "Skala 10.000-100.000 dokumen?",
            "Arsitektur single-node masih masuk akal dengan batch embedding + Whoosh Paperless. "
            "Di skala besar, pertimbangkan vector DB + reranker + worker embedding terpisah.",
        ),
        (
            "Langkah pertama pengembangan AI?",
            "Perkuat grounded prompt + kerangka jawaban (bukti/gap), lalu mode analisis dengan konteks lebih besar.",
        ),
    ]
    for q, a in faq:
        story.append(Paragraph(f"<b>{q}</b>", s["h3"]))
        story.append(Paragraph(a, s["body"]))

    story.append(Spacer(1, 0.5 * cm))
    story.append(
        callout(
            "<b>Penutup.</b> AI di DocSearch adalah lapisan RAG di atas OCR yang sudah ada. "
            "Kekuatan utama: jawaban terikat arsip dan isolasi user. Prioritas pengembangan: "
            "retrieval lebih akurat, jawaban lebih jujur saat bukti kurang, dan mode analisis "
            "yang dalam tanpa hardcode setiap skenario bisnis.",
            "info",
        )
    )

    doc = SimpleDocTemplate(
        str(PDF_PATH),
        pagesize=A4,
        leftMargin=2 * cm,
        rightMargin=2 * cm,
        topMargin=2 * cm,
        bottomMargin=1.8 * cm,
        title="DocSearch - Dokumentasi AI",
        author="DocSearch",
    )
    doc.build(story, onFirstPage=ai_header_footer, onLaterPages=ai_header_footer)
    print(f"Created: {PDF_PATH}")
    print(f"Size: {PDF_PATH.stat().st_size / 1024:.1f} KB")


if __name__ == "__main__":
    build()
