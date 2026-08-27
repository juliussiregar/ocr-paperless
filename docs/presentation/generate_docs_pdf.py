#!/usr/bin/env python3
"""
Generate DocSearch application documentation as a readable PDF (A4).
Expanded: Paperless deep-dive, DB, technical flows, modules, security,
OpenAI costs, operations, glossary/FAQ/checklist.
"""

from __future__ import annotations

from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_JUSTIFY, TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import cm, mm
from reportlab.platypus import (
    Flowable,
    KeepTogether,
    ListFlowable,
    ListItem,
    PageBreak,
    Paragraph,
    Preformatted,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)

OUT = Path(__file__).resolve().parent
PDF_PATH = OUT / "DocSearch-Dokumentasi-Aplikasi.pdf"

# Colors
TEAL = colors.HexColor("#0B6E63")
TEAL_DARK = colors.HexColor("#064E48")
TEAL_SOFT = colors.HexColor("#E8F5F3")
TEAL_MID = colors.HexColor("#A7D6CE")
INK = colors.HexColor("#1E293B")
MUTED = colors.HexColor("#64748B")
LINE = colors.HexColor("#CBD5E1")
AMBER = colors.HexColor("#B45309")
AMBER_SOFT = colors.HexColor("#FEF3C7")
SKY = colors.HexColor("#0369A1")
SKY_SOFT = colors.HexColor("#E0F2FE")
ROSE = colors.HexColor("#BE123C")
ROSE_SOFT = colors.HexColor("#FFE4E6")
WHITE = colors.white
SLATE = colors.HexColor("#F8FAFC")


class FlowBox(Flowable):
    """A labeled box for flowchart rows. Supports \\n for two lines."""

    def __init__(self, text: str, width: float, fill=TEAL, text_color=WHITE, height=28):
        Flowable.__init__(self)
        self.text = text
        self.box_width = width
        self.fill = fill
        self.text_color = text_color
        self.box_height = height
        self.width = width
        self.height = height

    def draw(self):
        self.canv.setFillColor(self.fill)
        self.canv.setStrokeColor(self.fill)
        self.canv.roundRect(0, 0, self.box_width, self.box_height, 6, fill=1, stroke=0)
        self.canv.setFillColor(self.text_color)
        lines = self.text.split("\n")
        if len(lines) == 1:
            self.canv.setFont("Helvetica-Bold", 9)
            self.canv.drawCentredString(
                self.box_width / 2, self.box_height / 2 - 3, lines[0]
            )
        else:
            self.canv.setFont("Helvetica-Bold", 8.5)
            self.canv.drawCentredString(
                self.box_width / 2, self.box_height / 2 + 4, lines[0]
            )
            self.canv.setFont("Helvetica", 7.5)
            self.canv.drawCentredString(
                self.box_width / 2, self.box_height / 2 - 8, lines[1]
            )


class ArrowDown(Flowable):
    def __init__(self, label: str = ""):
        Flowable.__init__(self)
        self.label = label
        self.width = 400
        self.height = 22 if not label else 34

    def draw(self):
        c = self.canv
        mid = self.width / 2
        c.setStrokeColor(TEAL)
        c.setFillColor(TEAL)
        c.setLineWidth(1.5)
        top = self.height - 2
        bot = 8 if not self.label else 18
        c.line(mid, top, mid, bot)
        c.line(mid, bot, mid - 5, bot + 7)
        c.line(mid, bot, mid + 5, bot + 7)
        if self.label:
            c.setFillColor(MUTED)
            c.setFont("Helvetica", 8)
            c.drawCentredString(mid, 4, self.label)


class HFlow(Flowable):
    """Horizontal flowchart: boxes with arrows between them."""

    def __init__(self, labels: list[str], fills: list | None = None, width=480, box_h=36):
        Flowable.__init__(self)
        self.labels = labels
        self.fills = fills or [TEAL] * len(labels)
        self.width = width
        self.box_h = box_h
        self.height = box_h + 8

    def draw(self):
        n = len(self.labels)
        gap = 18
        usable = self.width - gap * (n - 1)
        bw = usable / n
        y = 4
        c = self.canv
        for i, (label, fill) in enumerate(zip(self.labels, self.fills)):
            x = i * (bw + gap)
            c.setFillColor(fill)
            c.roundRect(x, y, bw, self.box_h, 5, fill=1, stroke=0)
            c.setFillColor(WHITE)
            c.setFont("Helvetica-Bold", 8)
            lines = label.split("\n")
            if len(lines) == 1:
                c.drawCentredString(x + bw / 2, y + self.box_h / 2 - 3, lines[0])
            else:
                c.drawCentredString(x + bw / 2, y + self.box_h / 2 + 4, lines[0])
                c.setFont("Helvetica", 7)
                c.drawCentredString(x + bw / 2, y + self.box_h / 2 - 8, lines[1])
            if i < n - 1:
                ax = x + bw
                c.setStrokeColor(TEAL_MID)
                c.setFillColor(TEAL_MID)
                c.setLineWidth(1.4)
                c.line(ax + 2, y + self.box_h / 2, ax + gap - 4, y + self.box_h / 2)
                midy = y + self.box_h / 2
                c.line(ax + gap - 4, midy, ax + gap - 9, midy + 4)
                c.line(ax + gap - 4, midy, ax + gap - 9, midy - 4)


def styles():
    base = getSampleStyleSheet()
    s = {
        "cover_title": ParagraphStyle(
            "cover_title", parent=base["Title"], fontSize=28, textColor=TEAL_DARK,
            alignment=TA_CENTER, spaceAfter=10, leading=34, fontName="Helvetica-Bold",
        ),
        "cover_sub": ParagraphStyle(
            "cover_sub", parent=base["Normal"], fontSize=12, textColor=MUTED,
            alignment=TA_CENTER, spaceAfter=6, leading=16,
        ),
        "h1": ParagraphStyle(
            "h1", parent=base["Heading1"], fontSize=16, textColor=TEAL_DARK,
            spaceBefore=16, spaceAfter=8, fontName="Helvetica-Bold", borderPadding=3,
        ),
        "h2": ParagraphStyle(
            "h2", parent=base["Heading2"], fontSize=12, textColor=TEAL,
            spaceBefore=12, spaceAfter=6, fontName="Helvetica-Bold",
        ),
        "h3": ParagraphStyle(
            "h3", parent=base["Heading3"], fontSize=10.5, textColor=INK,
            spaceBefore=8, spaceAfter=4, fontName="Helvetica-Bold",
        ),
        "body": ParagraphStyle(
            "body", parent=base["Normal"], fontSize=9.5, textColor=INK,
            alignment=TA_JUSTIFY, leading=14, spaceAfter=6,
        ),
        "bullet": ParagraphStyle(
            "bullet", parent=base["Normal"], fontSize=9.5, textColor=INK,
            leading=13, leftIndent=12, spaceAfter=3,
        ),
        "note": ParagraphStyle(
            "note", parent=base["Normal"], fontSize=9, textColor=AMBER,
            leading=12, spaceAfter=6, leftIndent=4,
        ),
        "caption": ParagraphStyle(
            "caption", parent=base["Normal"], fontSize=8, textColor=MUTED,
            alignment=TA_CENTER, spaceBefore=2, spaceAfter=10,
        ),
        "mono": ParagraphStyle(
            "mono", parent=base["Code"], fontSize=7.5, textColor=INK,
            leading=10, fontName="Courier",
        ),
        "toc": ParagraphStyle(
            "toc", parent=base["Normal"], fontSize=10, textColor=INK,
            leading=16, spaceAfter=2,
        ),
        "toc_sub": ParagraphStyle(
            "toc_sub", parent=base["Normal"], fontSize=9, textColor=MUTED,
            leading=13, leftIndent=14, spaceAfter=1,
        ),
        "footer": ParagraphStyle(
            "footer", parent=base["Normal"], fontSize=8, textColor=MUTED,
        ),
    }
    return s


def header_footer(canvas, doc):
    canvas.saveState()
    page = canvas.getPageNumber()
    if page > 1:
        canvas.setStrokeColor(TEAL_MID)
        canvas.setLineWidth(0.6)
        canvas.line(2 * cm, A4[1] - 1.4 * cm, A4[0] - 2 * cm, A4[1] - 1.4 * cm)
        canvas.setFont("Helvetica", 8)
        canvas.setFillColor(TEAL)
        canvas.drawString(2 * cm, A4[1] - 1.2 * cm, "DocSearch · Dokumentasi Aplikasi")
        canvas.setFillColor(MUTED)
        canvas.drawRightString(A4[0] - 2 * cm, A4[1] - 1.2 * cm, f"Halaman {page}")
        canvas.line(2 * cm, 1.4 * cm, A4[0] - 2 * cm, 1.4 * cm)
    canvas.restoreState()


def callout(text: str, kind: str = "info") -> Table:
    fills = {
        "info": TEAL_SOFT,
        "warn": AMBER_SOFT,
        "crit": ROSE_SOFT,
        "sky": SKY_SOFT,
    }
    borders = {
        "info": TEAL,
        "warn": AMBER,
        "crit": ROSE,
        "sky": SKY,
    }
    fill = fills.get(kind, TEAL_SOFT)
    border = borders.get(kind, TEAL)
    p = Paragraph(text, ParagraphStyle(
        "callout", fontSize=9, textColor=INK, leading=13, fontName="Helvetica",
    ))
    t = Table([[p]], colWidths=[16.5 * cm])
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), fill),
        ("BOX", (0, 0), (-1, -1), 1.2, border),
        ("LEFTPADDING", (0, 0), (-1, -1), 10),
        ("RIGHTPADDING", (0, 0), (-1, -1), 10),
        ("TOPPADDING", (0, 0), (-1, -1), 8),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
    ]))
    return t


def simple_table(headers: list[str], rows: list[list[str]], col_widths=None) -> Table:
    s = styles()
    data = [[Paragraph(f"<b>{h}</b>", s["body"]) for h in headers]]
    for row in rows:
        data.append([Paragraph(str(c), s["body"]) for c in row])
    t = Table(data, colWidths=col_widths, repeatRows=1)
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), TEAL),
        ("TEXTCOLOR", (0, 0), (-1, 0), WHITE),
        ("BACKGROUND", (0, 1), (-1, -1), SLATE),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [WHITE, SLATE]),
        ("GRID", (0, 0), (-1, -1), 0.4, LINE),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 6),
        ("RIGHTPADDING", (0, 0), (-1, -1), 6),
        ("TOPPADDING", (0, 0), (-1, -1), 5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
    ]))
    return t


def bullets(items: list[str], s) -> list:
    out = []
    for it in items:
        out.append(Paragraph(f"• {it}", s["bullet"]))
    return out


def vflow(story, steps: list[tuple[str, object]], s, caption: str):
    """Append a vertical FlowBox + ArrowDown chain."""
    for i, (label, fill) in enumerate(steps):
        story.append(FlowBox(label, 16.5 * cm, fill=fill, height=24))
        if i < len(steps) - 1:
            story.append(ArrowDown())
    story.append(Paragraph(caption, s["caption"]))


def build():
    s = styles()
    story: list = []
    W = 16.5 * cm

    # ========== COVER ==========
    story.append(Spacer(1, 3.2 * cm))
    story.append(Paragraph("DocSearch", s["cover_title"]))
    story.append(Paragraph(
        "Dokumentasi Aplikasi: Portal OCR, Library Cloud,<br/>Pencarian Dokumen, dan Ask AI",
        s["cover_sub"],
    ))
    story.append(Spacer(1, 0.5 * cm))
    story.append(callout(
        "<b>Dokumen ini menjelaskan DocSearch secara menyeluruh:</b> konteks produk, "
        "Paperless-ngx, arsitektur, database, alur teknis (flowchart), modul per halaman, "
        "keamanan multi-user, model OpenAI &amp; biaya, serta operasional dan FAQ.",
        "info",
    ))
    story.append(Spacer(1, 1 * cm))
    story.append(Paragraph(
        "Bahasa: Indonesia · Format: dokumentasi teknis (A4) untuk pembaca non-dev &amp; teknis",
        s["cover_sub"],
    ))
    story.append(Paragraph("Versi dokumen: Agustus 2026", s["cover_sub"]))
    story.append(Paragraph("Output: DocSearch-Dokumentasi-Aplikasi.pdf", s["cover_sub"]))
    story.append(PageBreak())

    # ========== TOC ==========
    story.append(Paragraph("Daftar isi", s["h1"]))
    toc = [
        ("A. Ringkasan &amp; konteks", [
            "1. Ringkasan aplikasi",
            "2. Masalah yang diselesaikan",
        ]),
        ("B. Paperless-ngx mendalam", [
            "3. Paperless-ngx: asal, fungsi, kelebihan, batasan, dan peran di DocSearch",
        ]),
        ("C. Arsitektur &amp; stack", [
            "4. Arsitektur DocSearch",
            "5. Stack teknologi",
        ]),
        ("D. Database lengkap", [
            "6. Database &amp; model data",
        ]),
        ("E. Alur teknis mendalam", [
            "7. Alur teknis (SyncFile, retry, auto-scan, embedding, ingest, Ask AI, Search)",
        ]),
        ("F. Modul per halaman", [
            "8. Modul portal: Ask AI, Search, Library, Admin, Profil",
        ]),
        ("G. Keamanan &amp; multi-user", [
            "9. Keamanan, isolasi data, role, audit, rate limit",
        ]),
        ("H. OpenAI models &amp; biaya", [
            "10. Model OpenAI, kapan dipanggil, dan audit biaya",
        ]),
        ("I. Operasional", [
            "11. Deploy, backup, health, dan tuning 8 GB RAM",
        ]),
        ("J. Lampiran", [
            "12. Glosarium, FAQ, checklist go-live",
        ]),
    ]
    for section, items in toc:
        story.append(Paragraph(section, s["toc"]))
        for it in items:
            story.append(Paragraph(it, s["toc_sub"]))
    story.append(PageBreak())

    # ========== A / 1 SUMMARY ==========
    story.append(Paragraph("A. Ringkasan &amp; konteks", s["h1"]))
    story.append(Paragraph("1. Ringkasan aplikasi", s["h2"]))
    story.append(Paragraph(
        "DocSearch adalah portal web untuk organisasi yang menyimpan banyak PDF di cloud "
        "(contoh: Nextcloud/ownCloud lewat WebDAV). Portal ini membantu pengguna "
        "<b>mengambil dokumen dari cloud, mengubahnya menjadi teks lewat OCR, mencari isi dokumen, "
        "dan bertanya ke AI</b> berdasarkan dokumen yang sudah diproses.",
        s["body"],
    ))
    story.append(Paragraph(
        "Intinya: cloud tetap jadi sumber file asli; DocSearch jadi jembatan pintar "
        "antara file PDF, mesin OCR (Paperless-ngx), database aplikasi, antrean pekerjaan, "
        "dan layanan AI (OpenAI).",
        s["body"],
    ))
    story.append(Paragraph("Komponen utama dalam satu kalimat", s["h3"]))
    story.append(simple_table(
        ["Komponen", "Peran singkat"],
        [
            ["Portal web (Next.js)", "UI login, Library, Search, Ask AI, Admin, Profil"],
            ["sync-worker", "Unduh file dari cloud, antre OCR, reconcile, embedding backfill"],
            ["Paperless-ngx", "Mesin OCR &amp; penyimpanan dokumen terproses"],
            ["PostgreSQL", "Database aplikasi (app) + database Paperless (paperless)"],
            ["Redis", "Antre pekerjaan BullMQ &amp; broker Paperless"],
            ["OpenAI (opsional)", "Embedding RAG + jawaban Ask AI / ringkasan search"],
        ],
        col_widths=[5.5 * cm, 11 * cm],
    ))
    story.append(Spacer(1, 0.3 * cm))
    story.append(Paragraph("Gambaran besar (satu baris)", s["h3"]))
    story.append(HFlow(
        ["Cloud\nWebDAV", "Portal +\nWorker", "Paperless\nOCR", "DB app +\nchunk", "Search /\nAsk AI"],
        [MUTED, TEAL, SKY, TEAL_DARK, AMBER],
        width=W,
    ))
    story.append(Paragraph("Gambar 1. DocSearch sebagai jembatan cloud → OCR → pencarian &amp; AI.", s["caption"]))

    # ========== A / 2 PROBLEM ==========
    story.append(Paragraph("2. Masalah yang diselesaikan", s["h2"]))
    story.append(Paragraph(
        "Di banyak organisasi, dokumen sudah digital (PDF di cloud), tapi belum siap dipakai "
        "sebagai pengetahuan yang bisa dicari dan ditanyakan:",
        s["body"],
    ))
    story.extend(bullets([
        "<b>Sulit dicari isinya</b>: nama file sering tidak mewakili isi. Mencari berarti buka folder dan PDF satu per satu.",
        "<b>OCR tidak terpusat</b>: scan/OCR manual tidak skala untuk ratusan atau ribuan file.",
        "<b>Status tidak jelas</b>: mana yang sudah dibaca mesin, mana yang gagal, mana yang kosong (0 byte).",
        "<b>Belum siap untuk tanya AI</b>: AI butuh teks hasil OCR + indeks; tanpa pipeline, Ask AI tidak andal.",
        "<b>Isolasi per orang</b>: tiap pegawai punya kredensial cloud sendiri; sistem harus menjaga agar dokumen tidak tercampur.",
    ], s))
    story.append(Paragraph("Alur sebelum DocSearch", s["h3"]))
    story.append(HFlow(
        ["PDF di cloud", "Cari manual", "Buka PDF", "Tanya orang", "Lambat"],
        [MUTED, ROSE, ROSE, AMBER, ROSE],
        width=W,
    ))
    story.append(Paragraph("Gambar 2. Alur kerja lama: banyak langkah manual.", s["caption"]))
    story.append(Paragraph("Alur setelah DocSearch", s["h3"]))
    story.append(HFlow(
        ["PDF di cloud", "Ambil &amp;\nOCR", "Indeks +\nembed", "Search /\nAsk AI", "Cepat"],
        [TEAL, TEAL, SKY, AMBER, TEAL_DARK],
        width=W,
    ))
    story.append(Paragraph("Gambar 3. Alur baru: mesin membantu mencari dan menjawab.", s["caption"]))
    story.append(PageBreak())

    # ========== B / 3 PAPERLESS ==========
    story.append(Paragraph("B. Paperless-ngx mendalam", s["h1"]))
    story.append(Paragraph(
        "3. Paperless-ngx: asal, fungsi, kelebihan, batasan, dan peran di DocSearch",
        s["h2"],
    ))

    story.append(Paragraph("3.1 Apa itu Paperless-ngx?", s["h3"]))
    story.append(Paragraph(
        "Paperless-ngx adalah perangkat lunak <b>open source</b> untuk mengelola dokumen digital "
        "dengan OCR (Optical Character Recognition). Proyek ini adalah kelanjutan komunitas dari "
        "proyek sebelumnya yang dikenal sebagai <b>Paperless</b> / Paperless-ng. Tujuannya: "
        "mengubah tumpukan PDF/scan menjadi arsip yang bisa dicari teksnya, diberi tag, dan dikelola "
        "lewat antarmuka web serta API.",
        s["body"],
    ))
    story.append(Paragraph(
        "Nama “paperless” merujuk ide kantor tanpa kertas: dokumen fisik di-scan, lalu hidup sebagai "
        "file digital yang tetap bisa dicari seperti teks biasa.",
        s["body"],
    ))

    story.append(Paragraph("3.2 Asal usul singkat", s["h3"]))
    story.extend(bullets([
        "Awalnya komunitas membangun sistem arsip dokumen pribadi/rumah tangga (invoice, surat, dll.).",
        "Seiring waktu berkembang jadi <b>Paperless-ngx</b>: lebih modern, Docker-friendly, aktif dikembangkan.",
        "Biasanya dijalankan self-hosted (di server sendiri), bukan SaaS berbayar wajib.",
        "Mesin OCR di balik layar umumnya memakai <b>OCRmyPDF / Tesseract</b> (tergantung konfigurasi image).",
    ], s))

    story.append(Paragraph("3.3 Fungsi umum", s["h3"]))
    story.append(simple_table(
        ["Fungsi", "Penjelasan singkat"],
        [
            ["Consume / ingest", "Memantau folder; file baru otomatis diproses"],
            ["OCR", "Mengenali teks di PDF (termasuk scan gambar)"],
            ["Full-text search", "Mencari kata di dalam isi dokumen (di UI Paperless)"],
            ["Metadata &amp; tag", "Judul, tanggal, correspondent, tags, dll."],
            ["Preview &amp; unduh", "Melihat/mengunduh PDF hasil kelola"],
            ["API REST + token", "Integrasi dari aplikasi lain (DocSearch memakai ini)"],
            ["Multi-bahasa OCR", "Bisa set bahasa, mis. English + Indonesia"],
        ],
        col_widths=[4.5 * cm, 12 * cm],
    ))

    story.append(Paragraph("3.4 Kelebihan", s["h3"]))
    story.extend(bullets([
        "<b>Open source &amp; self-hosted</b>: data tetap di infrastruktur organisasi.",
        "<b>OCR matang</b>: sudah ada pipeline consume → OCR → indeks, tidak perlu bangun dari nol.",
        "<b>API lengkap</b>: cocok digabung dengan portal custom seperti DocSearch.",
        "<b>Docker</b>: relatif mudah di-deploy bersama PostgreSQL &amp; Redis.",
        "<b>Bahasa OCR bisa dikonfigurasi</b>: di DocSearch di-set untuk Inggris + Indonesia (eng+ind).",
        "<b>Ekosistem mapan</b>: dokumentasi komunitas, image resmi, praktik operasional sudah banyak.",
    ], s))

    story.append(Paragraph("3.5 Batasan / kritik", s["h3"]))
    story.append(callout(
        "<b>Catatan kritis:</b> Paperless hebat sebagai mesin OCR &amp; arsip, tetapi "
        "<b>bukan portal multi-tenant cloud browser</b>. Tanpa lapisan aplikasi tambahan, "
        "Paperless kurang ideal untuk skenario “tiap pegawai login, browse WebDAV sendiri, "
        "lalu Ask AI dari dokumen miliknya”.",
        "crit",
    ))
    story.extend(bullets([
        "UI Paperless lebih ke arsip dokumen, bukan Library cloud seperti Explorer.",
        "Isolasi per-user cloud credentials bukan fokus utama Paperless; itu tanggung jawab portal DocSearch.",
        "OCR berat di CPU/RAM; di server kecil harus dibatasi worker agar tidak OOM.",
        "Kualitas OCR bergantung kualitas PDF (scan buram / file 0 byte tetap bermasalah).",
        "Fitur AI chat / embedding semantik bukan inti Paperless; DocSearch menambahnya lewat OpenAI.",
    ], s))
    story.append(PageBreak())

    story.append(Paragraph("3.6 Apa yang dipakai Paperless di DocSearch?", s["h3"]))
    story.append(Paragraph(
        "Di DocSearch, Paperless-ngx dipakai sebagai <b>mesin OCR + penyimpanan dokumen terproses</b>, "
        "bukan sebagai satu-satunya UI untuk pengguna akhir. Pengguna sehari-hari memakai portal DocSearch.",
        s["body"],
    ))
    story.append(simple_table(
        ["Aspek", "Konfigurasi / pemakaian di DocSearch"],
        [
            ["Image", "ghcr.io/paperless-ngx/paperless-ngx (Docker Compose)"],
            ["Database", "PostgreSQL, database terpisah bernama <b>paperless</b>"],
            ["Broker / Redis", "Redis untuk antrean tugas internal Paperless"],
            ["OCR language", "eng+ind (Inggris + Indonesia)"],
            ["Consume folder", "Volume bersama yang diisi sync-worker (PDF masuk sini)"],
            ["API token", "PAPERLESS_API_TOKEN / PAPERLESS_TOKEN untuk REST API"],
            ["Akses UI Paperless", "Lokal/internal (bukan pintu utama user portal)"],
            ["Yang dipakai portal", "ID dokumen, preview, unduh, meta/teks untuk chunk"],
        ],
        col_widths=[4.5 * cm, 12 * cm],
    ))

    story.append(Paragraph("3.7 Apa yang terjadi di folder consume?", s["h3"]))
    story.append(Paragraph(
        "Folder consume adalah “kotak masuk” Paperless. Sync-worker menaruh PDF yang sudah diunduh "
        "dari cloud ke folder ini. Paperless memantau folder (polling), lalu memproses file: "
        "OCR, ekstraksi teks, penyimpanan media, dan pembuatan entri dokumen dengan ID unik.",
        s["body"],
    ))
    vflow(story, [
        ("sync-worker unduh PDF dari WebDAV", TEAL),
        ("Validasi (tolak 0 byte, hitung content hash)", AMBER),
        ("Salin / tempatkan PDF ke folder consume", MUTED),
        ("Paperless consumer mendeteksi file baru", SKY),
        ("OCR eng+ind → dokumen punya paperless document ID", TEAL_DARK),
        ("Worker reconcile: SyncFile → OCR_DONE + ID", TEAL),
    ], s, "Gambar 4. Siklus hidup file di folder consume.")

    story.append(Paragraph("3.8 Checksum / Paperless document ID vs SyncFile", s["h3"]))
    story.append(Paragraph(
        "Setiap SyncFile di database app menyimpan jejak file cloud milik satu user. Dua field kunci "
        "menghubungkan dunia app dengan Paperless:",
        s["body"],
    ))
    story.append(simple_table(
        ["Field SyncFile", "Arti"],
        [
            ["content_hash", "Checksum isi file (setelah unduh). Dipakai deteksi duplikat &amp; pencocokan ke Paperless."],
            ["paperless_document_id", "ID dokumen di Paperless setelah OCR sukses (atau diwarisi dari duplikat)."],
            ["remote_path", "Path unik file di cloud untuk user tersebut (unik bersama userId)."],
            ["sync_status", "Posisi file di pipeline (DISCOVERED … OCR_DONE / FAILED / SKIPPED)."],
        ],
        col_widths=[4.5 * cm, 12 * cm],
    ))
    story.append(callout(
        "<b>Reconcile:</b> worker mencari dokumen Paperless berdasarkan checksum. "
        "Jika ketemu, SyncFile di-update ke OCR_DONE dan diisi paperless_document_id. "
        "Jika hash sama dengan file lain yang sudah punya ID, file bisa di-SKIPPED "
        "(duplikat isi) tanpa OCR ulang.",
        "sky",
    ))

    story.append(Paragraph("3.9 API Paperless yang dipakai portal", s["h3"]))
    story.append(simple_table(
        ["Dipakai portal / worker", "Tidak jadi UI utama"],
        [
            [
                "Preview PDF dokumen terproses",
                "UI arsip / tag / correspondent Paperless untuk end-user",
            ],
            [
                "Download / raw dokumen via ID",
                "Full-text search UI bawaan Paperless sebagai muka utama",
            ],
            [
                "Meta dokumen &amp; pencarian by checksum (reconcile)",
                "Manajemen user Paperless untuk pegawai organisasi",
            ],
            [
                "Token API untuk worker &amp; app",
                "Ingest manual lewat UI Paperless (biasanya diganti consume dari worker)",
            ],
        ],
        col_widths=[8.25 * cm, 8.25 * cm],
    ))
    story.append(HFlow(
        ["sync-worker\nkirim PDF", "Folder\nconsume", "Paperless\nOCR", "Dokumen\n+ ID", "Portal\nbaca API"],
        [TEAL, MUTED, SKY, TEAL_DARK, AMBER],
        width=W,
    ))
    story.append(Paragraph(
        "Gambar 5. Paperless sebagai mesin tengah; portal adalah muka pengguna.",
        s["caption"],
    ))
    story.append(PageBreak())

    # ========== C / 4 ARCHITECTURE ==========
    story.append(Paragraph("C. Arsitektur &amp; stack", s["h1"]))
    story.append(Paragraph("4. Arsitektur DocSearch", s["h2"]))
    story.append(Paragraph(
        "DocSearch terdiri dari beberapa layanan yang saling berhubungan. "
        "Pengguna hanya melihat portal web. Di belakang ada worker, OCR, dua database logis, "
        "antrean Redis, sumber cloud, dan (opsional) OpenAI.",
        s["body"],
    ))
    story.append(Paragraph("Lapisan sistem", s["h3"]))
    vflow(story, [
        ("Pengguna · Browser", TEAL_DARK),
        ("Portal DocSearch (Next.js) · Login, Library, Search, Ask AI, Admin", TEAL),
        ("sync-worker · WebDAV, antre scan, reconcile OCR, embedding", TEAL),
        ("Paperless-ngx · OCR  |  PostgreSQL · app+paperless  |  Redis · queue", SKY),
        ("Cloud WebDAV · PDF asli  |  OpenAI · chat &amp; embedding", AMBER),
    ], s, "Gambar 6. Lapisan arsitektur dari pengguna sampai sumber data &amp; AI.")

    story.append(Paragraph("Pembagian tanggung jawab", s["h3"]))
    story.append(simple_table(
        ["Layanan", "Tanggung jawab", "Tidak mengerjakan"],
        [
            ["Portal app", "UI, auth, API, search/chat ke user", "OCR berat di request HTTP"],
            ["sync-worker", "Ambil cloud, antre OCR, update status, embed", "UI pengguna"],
            ["Paperless", "OCR &amp; simpan dokumen terproses", "Browse WebDAV per-user"],
            ["PostgreSQL (app)", "User, SyncFile, chunk, audit, chat", "File biner PDF besar"],
            ["Redis", "Job queue BullMQ + broker Paperless", "Sumber kebenaran bisnis jangka panjang"],
        ],
        col_widths=[3.5 * cm, 6.5 * cm, 6.5 * cm],
    ))
    story.append(PageBreak())

    # ========== C / 5 STACK ==========
    story.append(Paragraph("5. Stack teknologi", s["h2"]))
    story.append(Paragraph(
        "Stack dipilih agar self-hosted, bisa di-Docker-kan, dan cukup ringan untuk server menengah "
        "(rekomendasi praktis: sekitar 8 GB RAM).",
        s["body"],
    ))
    story.append(simple_table(
        ["Lapisan", "Teknologi", "Keterangan"],
        [
            ["Frontend + API", "Next.js 16, React 19, TypeScript", "App Router, API routes"],
            ["Auth", "NextAuth (Auth.js) v5", "Session login, role ADMIN/USER"],
            ["ORM", "Prisma 6", "Schema &amp; migrasi PostgreSQL (DB app)"],
            ["Styling", "Tailwind CSS 4", "UI portal"],
            ["Worker", "Node.js + TypeScript", "Proses background sync"],
            ["Queue", "BullMQ + Redis", "Job scan / ingest"],
            ["Cloud client", "webdav (npm)", "List / download file cloud"],
            ["OCR", "Paperless-ngx", "Consume + OCR eng+ind"],
            ["Database", "PostgreSQL 16", "DB app + DB paperless"],
            ["Cache/broker", "Redis 7", "Queue Paperless &amp; BullMQ"],
            ["AI chat", "OpenAI OPENAI_MODEL", "Default gpt-4o-mini"],
            ["AI embedding", "OPENAI_EMBEDDING_MODEL", "Default text-embedding-3-small"],
            ["Deploy", "Docker Compose + scripts", "server-up / deploy-remote"],
        ],
        col_widths=[3.2 * cm, 5.3 * cm, 8 * cm],
    ))
    story.append(Spacer(1, 0.25 * cm))
    story.append(callout(
        "<b>Mengapa bukan “semua di Paperless saja”?</b> Karena kebutuhan bisnis adalah "
        "browse cloud per-user, status sync, Ask AI, audit biaya AI, dan UX portal. "
        "Paperless di sini adalah fondasi OCR yang kuat; portal + worker menutup celah produk.",
        "sky",
    ))
    story.append(HFlow(
        ["postgres", "redis", "paperless", "sync-worker", "app"],
        [TEAL_DARK, MUTED, SKY, TEAL, AMBER],
        width=W,
    ))
    story.append(Paragraph("Gambar 7. Lima layanan inti Compose. App adalah pintu pengguna.", s["caption"]))
    story.append(PageBreak())

    # ========== D / 6 DATABASE ==========
    story.append(Paragraph("D. Database lengkap", s["h1"]))
    story.append(Paragraph("6. Database &amp; model data", s["h2"]))
    story.append(Paragraph(
        "Secara fisik ada <b>satu server PostgreSQL</b>, tetapi secara logis ada dua database penting:",
        s["body"],
    ))
    story.extend(bullets([
        "<b>Database paperless</b>: dipakai Paperless-ngx untuk dokumen OCR, metadata internal, media references, dsb.",
        "<b>Database app</b>: dipakai portal &amp; sync-worker untuk user, status sync, chat, audit, embedding chunk.",
    ], s))
    story.append(Paragraph(
        "Pemisahan ini menjaga Paperless tetap “standar”, sementara logika bisnis DocSearch tidak "
        "mengotori skema internal Paperless.",
        s["body"],
    ))
    story.append(HFlow(
        ["PostgreSQL\nserver", "DB paperless\n(OCR/arsip)", "DB app\n(DocSearch)", "Portal &\nWorker"],
        [TEAL_DARK, SKY, TEAL, AMBER],
        width=W,
    ))
    story.append(Paragraph("Gambar 8. Satu Postgres, dua database logis.", s["caption"]))

    story.append(Paragraph("6.1 ER sederhana (relasi)", s["h3"]))
    story.append(simple_table(
        ["Dari", "Ke", "Relasi / catatan"],
        [
            ["users", "sync_files", "1 : N (setiap file milik satu user)"],
            ["users", "scan_jobs", "1 : N (job dipicu user / null jika sistem)"],
            ["users", "document_chunks", "1 : N (chunk terisolasi per user)"],
            ["users", "chat_conversations", "1 : N"],
            ["chat_conversations", "chat_messages", "1 : N"],
            ["users", "cloud_favorites", "1 : N (path unik per user)"],
            ["users", "audit_logs", "1 : N (user boleh null untuk aksi sistem)"],
            ["sync_files", "document_chunks", "1 : N (teks+embedding per file)"],
            ["app_settings", "-", "Key-value global (auto-scan, dll.)"],
            ["sync_files.paperless_document_id", "Paperless (DB paperless)", "Referensi silang logis, bukan FK SQL"],
        ],
        col_widths=[4.2 * cm, 4.5 * cm, 7.8 * cm],
    ))

    story.append(Paragraph("6.2 Field penting per tabel", s["h3"]))
    story.append(simple_table(
        ["Tabel", "Field / isi penting"],
        [
            [
                "users",
                "email, name, role (ADMIN/USER), password_hash (bcrypt), "
                "bappenas_url, encrypted_bappenas_username/password, last_sync_at",
            ],
            [
                "sync_files",
                "remote_path, file_name, file_size, content_hash, sync_status, "
                "paperless_document_id, error_message, ocr_pending_at",
            ],
            [
                "document_chunks",
                "sync_file_id, paperless_document_id, chunk_index, content, "
                "embedding (JSON float[]), content_hash, token_estimate",
            ],
            [
                "scan_jobs",
                "job_type (full_scan / ingest_selected), status, phase, "
                "total/processed/skipped/failed/new, selected_paths, current_file",
            ],
            [
                "audit_logs",
                "action, meta (JSON string: detail search/chat/admin/biaya), created_at",
            ],
            [
                "chat_conversations",
                "title, scope (all / docs / folder), updated_at",
            ],
            [
                "chat_messages",
                "role (USER/ASSISTANT), content, citations (JSON sumber)",
            ],
            [
                "cloud_favorites",
                "path, last_opened_at, last_synced_at (delta auto-scan)",
            ],
            [
                "app_settings",
                "key/value: auto_scan_enabled, auto_scan_interval_minutes, last_run_at",
            ],
        ],
        col_widths=[4 * cm, 12.5 * cm],
    ))
    story.append(PageBreak())

    story.append(Paragraph("6.3 Status SyncFile detail + arti UI", s["h3"]))
    story.append(Paragraph(
        "Setiap file yang dilacak punya status. UI Library menampilkan progress berdasarkan status ini.",
        s["body"],
    ))
    story.append(HFlow(
        ["DISCOVERED", "DOWNLOADING", "QUEUED", "OCR_PENDING", "OCR_DONE"],
        [MUTED, SKY, TEAL, AMBER, TEAL_DARK],
        width=W,
    ))
    story.append(Paragraph("Gambar 9. Jalur sukses status SyncFile (ringkas).", s["caption"]))
    story.append(simple_table(
        ["Status", "Arti teknis", "Arti di UI (kira-kira)"],
        [
            ["DISCOVERED", "Terdaftar / ditemukan, belum diunduh", "Menunggu unduh"],
            ["DOWNLOADING", "Sedang diunduh dari WebDAV", "Mengunduh…"],
            ["QUEUED", "Siap / menunggu masuk consume OCR", "Antre OCR"],
            ["OCR_PENDING", "Sudah di consume; Paperless memproses", "OCR berjalan…"],
            ["OCR_DONE", "Reconcile sukses; siap Search/Ask AI", "Siap dipakai"],
            ["SKIPPED", "Duplikat / sudah ada (hash sama + ID)", "Sudah ada (lewati)"],
            ["FAILED", "Gagal (0B, timeout, unduh, dll.)", "Gagal · bisa retry"],
        ],
        col_widths=[3.2 * cm, 6.5 * cm, 6.8 * cm],
    ))
    story.append(callout(
        "<b>Kasus khusus file 0 byte:</b> file kosong tidak dikirim ke OCR. "
        "Sistem menandainya FAILED dengan pesan jelas agar antrean tidak “nyangkut”.",
        "warn",
    ))
    story.append(PageBreak())

    # ========== E / 7 TECHNICAL FLOWS ==========
    story.append(Paragraph("E. Alur teknis mendalam", s["h1"]))
    story.append(Paragraph(
        "7. Alur teknis (SyncFile, retry, auto-scan, embedding, ingest, Ask AI, Search)",
        s["h2"],
    ))
    story.append(Paragraph(
        "Bab ini merinci pipeline yang sering ditanyakan saat operasi dan troubleshooting. "
        "Banyak diagram vertikal dan horizontal agar alur mudah diikuti.",
        s["body"],
    ))

    # 7.1 SyncFile pipeline
    story.append(Paragraph("7.1 Status SyncFile: pipeline sukses + cabang gagal", s["h3"]))
    story.append(Paragraph(
        "Jalur bahagia (happy path) berakhir di OCR_DONE. Cabang lain: SKIPPED (duplikat), "
        "FAILED (0 byte, timeout OCR, error unduh), atau tetap OCR_PENDING sampai timeout.",
        s["body"],
    ))
    vflow(story, [
        ("DISCOVERED - file terdaftar di SyncFile", MUTED),
        ("DOWNLOADING - unduh WebDAV dengan kredensial user", SKY),
        ("Validasi size &amp; hash", AMBER),
        ("QUEUED - siap masuk folder consume", TEAL),
        ("OCR_PENDING - Paperless memproses", AMBER),
        ("OCR_DONE - ID Paperless terisi, siap dipakai", TEAL_DARK),
    ], s, "Gambar 10. Pipeline sukses SyncFile.")

    story.append(Paragraph("Cabang dari validasi / reconcile", s["h3"]))
    story.append(HFlow(
        ["Hash sudah\nada + ID", "SKIPPED\nduplikat", "Size = 0B", "FAILED\n0 byte", "Timeout\nOCR", "FAILED\ntimeout"],
        [SKY, MUTED, ROSE, ROSE, AMBER, ROSE],
        width=W,
        box_h=40,
    ))
    story.append(Paragraph(
        "Gambar 11. Cabang SKIPPED / FAILED (0B / timeout) di samping jalur utama.",
        s["caption"],
    ))

    # 7.2 Retry / fail / 0B / timeout
    story.append(Paragraph("7.2 Retry, gagal, file 0 byte, timeout OCR", s["h3"]))
    story.append(Paragraph(
        "Worker memantau file yang lama di OCR_PENDING. Default timeout diatur oleh "
        "<b>OCR_PENDING_TIMEOUT_MINUTES</b> (default <b>180</b> menit). Setelah lewat, "
        "status diubah ke FAILED dengan pesan agar user bisa retry dari Library.",
        s["body"],
    ))
    vflow(story, [
        ("File di OCR_PENDING (catat ocr_pending_at)", AMBER),
        ("Reconcile: cari dokumen Paperless by checksum", SKY),
        ("Ketemu? → OCR_DONE + paperless_document_id", TEAL_DARK),
        ("Belum ketemu &amp; umur &lt; timeout → tetap tunggu", MUTED),
        ("Umur ≥ OCR_PENDING_TIMEOUT_MINUTES → FAILED", ROSE),
        ("User klik Retry di Library → job unduh/OCR ulang", TEAL),
    ], s, "Gambar 12. Reconcile, timeout OCR, dan retry.")
    story.append(callout(
        "<b>File 0 byte:</b> tidak dikirim ke consume. Langsung FAILED dengan pesan bahwa file kosong "
        "tidak bisa di-OCR. Perbaiki/ganti file di cloud, lalu retry.",
        "warn",
    ))
    story.append(PageBreak())

    # 7.3 Auto-scan
    story.append(Paragraph("7.3 Auto-scan: favorit → discovery → batch", s["h3"]))
    story.append(Paragraph(
        "Auto-scan menjalankan ingest latar belakang untuk folder favorit user. "
        "Diaktifkan lewat Admin (app_settings) dan/atau dipaksa oleh env "
        "<b>AUTO_SCAN_ENABLED=true</b>. Interval default biasanya 60 menit "
        "(auto_scan_interval_minutes). Jumlah file per batch dibatasi <b>SCAN_MAX_FILES</b> "
        "(default di Compose sering 20).",
        s["body"],
    ))
    vflow(story, [
        ("Timer / interval auto-scan", MUTED),
        ("Baca favorit user (cloud_favorites)", TEAL),
        ("Discovery PDF baru di path favorit (WebDAV)", SKY),
        ("Batasi batch (SCAN_MAX_FILES)", AMBER),
        ("Enqueue ScanJob → unduh → consume → OCR", TEAL_DARK),
        ("Update last_synced_at / last run settings", TEAL),
    ], s, "Gambar 13. Auto-scan dari favorit sampai batch ingest.")
    story.append(simple_table(
        ["Parameter", "Default / catatan"],
        [
            ["AUTO_SCAN_ENABLED (env)", "false - jika true, memaksa worker on"],
            ["auto_scan_enabled (DB)", "Toggle Admin; digabung dengan env force"],
            ["auto_scan_interval_minutes", "Default 60"],
            ["SCAN_MAX_FILES", "Batas file per batch (hindari lonjakan beban)"],
        ],
        col_widths=[5.5 * cm, 11 * cm],
    ))

    # 7.4 Embedding backfill
    story.append(Paragraph("7.4 Embedding backfill setelah OCR_DONE", s["h3"]))
    story.append(Paragraph(
        "Setelah SyncFile mencapai OCR_DONE (atau SKIPPED dengan ID dokumen), worker dapat "
        "membuat DocumentChunk: potongan teks OCR + embedding OpenAI. Backfill juga mengejar "
        "file lama yang belum punya chunk milik user tersebut.",
        s["body"],
    ))
    story.append(HFlow(
        ["OCR_DONE /\nSKIPPED", "Ambil teks\ndokumen", "Potong\nchunk", "Embed\nOpenAI", "Simpan\ndocument_chunks"],
        [TEAL_DARK, SKY, TEAL, AMBER, TEAL],
        width=W,
    ))
    story.append(Paragraph(
        "Gambar 14. Embedding backfill untuk RAG / Ask AI / search semantik.",
        s["caption"],
    ))
    story.append(callout(
        "<b>Tanpa OPENAI_API_KEY:</b> embedding terbatas/nonaktif. Ask AI dan search semantik "
        "akan kurang optimal; keyword search tetap bergantung data OCR yang ada.",
        "warn",
    ))
    story.append(PageBreak())

    # 7.5 Ingest E2E
    story.append(Paragraph("7.5 Ingest end-to-end", s["h3"]))
    story.append(Paragraph(
        "Dari klik user di Library sampai dokumen siap di Search/Ask AI:",
        s["body"],
    ))
    vflow(story, [
        ("User klik Fetch / Scan / Retry di Library", TEAL_DARK),
        ("API portal buat ScanJob (+ antre Redis/BullMQ)", TEAL),
        ("sync-worker ambil job", TEAL),
        ("Download WebDAV (kredensial user terdekripsi)", SKY),
        ("Validasi size/hash (tolak 0 byte)", AMBER),
        ("Copy ke folder consume Paperless", MUTED),
        ("Paperless OCR → dokumen punya ID", SKY),
        ("Reconcile SyncFile = OCR_DONE + ID", TEAL_DARK),
        ("Chunk + embedding (backfill)", AMBER),
        ("Muncul di Search / Ask AI", TEAL),
    ], s, "Gambar 15. Pipeline ingest end-to-end.")

    # 7.6 Ask AI
    story.append(Paragraph("7.6 Ask AI flow", s["h3"]))
    vflow(story, [
        ("User kirim pertanyaan di Ask AI (/)", TEAL_DARK),
        ("API /api/chat (+ scope: all / docs / folder)", TEAL),
        ("Retrieval chunk relevan milik user (embedding/keyword)", SKY),
        ("Susun konteks + prompt", TEAL_DARK),
        ("OpenAI chat completions (OPENAI_MODEL)", AMBER),
        ("Jawaban + sitasi sumber; audit pemakaian", TEAL),
    ], s, "Gambar 16. Alur Ask AI (retrieval → model → jawaban).")
    story.append(Paragraph(
        "Tanpa dokumen OCR_DONE + chunk, kualitas jawaban menurun tajam atau jawaban kosong.",
        s["body"],
    ))

    # 7.7 Search
    story.append(Paragraph("7.7 Search flow", s["h3"]))
    story.append(HFlow(
        ["Ketik query\n/search", "API\n/api/search", "Filter\nuserId", "Hybrid\nkeyword+sem.", "Hasil +\ncuplikan"],
        [TEAL, TEAL_DARK, MUTED, SKY, AMBER],
        width=W,
    ))
    story.append(Paragraph("Gambar 17. Alur Search (isolasi per user).", s["caption"]))
    story.extend(bullets([
        "Hanya dokumen milik user yang sedang login (biasanya status OCR_DONE).",
        "Hybrid: keyword pada teks + semantik bila embedding tersedia.",
        "Ringkasan hasil search dapat memakai OPENAI_MODEL bila dikonfigurasi.",
        "Aktivitas dicatat di audit_logs (termasuk estimasi biaya AI bila ada).",
    ], s))
    story.append(PageBreak())

    # ========== F / 8 MODULES ==========
    story.append(Paragraph("F. Modul per halaman", s["h1"]))
    story.append(Paragraph(
        "8. Modul portal: Ask AI, Search, Library, Admin, Profil",
        s["h2"],
    ))
    story.append(Paragraph(
        "Setiap modul di bawah mengikuti pola: tujuan → cara pakai singkat → API/komponen terkait → batasan.",
        s["body"],
    ))

    # Ask AI
    story.append(Paragraph("8.1 Ask AI", s["h3"]))
    story.append(simple_table(
        ["Aspek", "Isi"],
        [
            ["Route UI", "<b>/</b> (halaman utama chat)"],
            ["Tujuan", "Bertanya ke AI berdasarkan dokumen yang sudah di-OCR dan punya chunk."],
            [
                "Cara pakai",
                "Login → buka Ask AI → pilih scope (semua / dokumen / folder) → kirim pertanyaan → "
                "baca jawaban + sitasi.",
            ],
            [
                "API / komponen",
                "/api/chat, /api/chat/conversations, /api/chat/context, /api/chat/docs, "
                "AskWorkspace / ChatPanel",
            ],
            [
                "Batasan",
                "Butuh OPENAI_API_KEY; kualitas bergantung OCR_DONE + embedding; "
                "tidak menggantikan baca dokumen hukum secara formal.",
            ],
        ],
        col_widths=[3.5 * cm, 13 * cm],
    ))
    story.append(HFlow(
        ["/", "Scope\nkonteks", "/api/chat", "Retrieval", "Jawaban"],
        [TEAL_DARK, TEAL, SKY, AMBER, TEAL],
        width=W,
    ))
    story.append(Paragraph("Gambar 18. Modul Ask AI (tinggi level).", s["caption"]))

    # Search
    story.append(Paragraph("8.2 Search", s["h3"]))
    story.append(simple_table(
        ["Aspek", "Isi"],
        [
            ["Route UI", "<b>/search</b>"],
            ["Tujuan", "Mencari isi dokumen terindeks (bukan hanya nama file)."],
            [
                "Cara pakai",
                "Ketik kata/frasa → lihat hasil &amp; cuplikan → buka preview / lanjut Ask AI.",
            ],
            ["API / komponen", "/api/search, SearchWorkspace; bisa terkait /api/cloud/recent"],
            [
                "Batasan",
                "File belum OCR_DONE tidak muncul; tanpa embedding, semantik lemah; "
                "ringkasan AI opsional bergantung key.",
            ],
        ],
        col_widths=[3.5 * cm, 13 * cm],
    ))

    # Library
    story.append(Paragraph("8.3 Library", s["h3"]))
    story.append(simple_table(
        ["Aspek", "Isi"],
        [
            ["Route UI", "<b>/cloud</b>, <b>/cloud/recent</b>"],
            [
                "Tujuan",
                "Browse cloud WebDAV, pilih PDF, fetch/OCR, lihat status, favorit, retry gagal, preview.",
            ],
            [
                "Cara pakai",
                "Pastikan kredensial cloud di Profil → browse folder → pilih file/folder → "
                "Fetch/OCR → pantau status → recent / retry bila perlu.",
            ],
            [
                "API / komponen",
                "/api/cloud/browse, ingest, folder-hint, recent, favorites, tree, retry, raw, "
                "count, search; CloudBrowser, FolderTreeSidebar, RecentScansList",
            ],
            [
                "Batasan",
                "Batch dibatasi SCAN_MAX_FILES; file 0B gagal; OCR lama tergantung antrean/resource; "
                "butuh kredensial cloud valid.",
            ],
        ],
        col_widths=[3.5 * cm, 13 * cm],
    ))
    story.append(HFlow(
        ["Browse\ncloud", "Pilih\nPDF", "Ingest\nAPI", "Status\nSyncFile", "Preview /\nRecent"],
        [TEAL, TEAL, SKY, AMBER, TEAL_DARK],
        width=W,
    ))
    story.append(Paragraph("Gambar 19. Modul Library.", s["caption"]))
    story.append(PageBreak())

    # Admin
    story.append(Paragraph("8.4 Admin", s["h3"]))
    story.append(simple_table(
        ["Aspek", "Isi"],
        [
            ["Route UI", "<b>/admin</b>, <b>/admin/users</b>"],
            [
                "Tujuan",
                "Kelola pengguna, pantau audit/aktivitas AI &amp; biaya, atur auto-scan.",
            ],
            [
                "Cara pakai",
                "Login sebagai ADMIN → ringkasan/audit → kelola user (role, password, cloud) → "
                "toggle auto-scan bila perlu.",
            ],
            [
                "API / komponen",
                "/api/admin, /api/admin/audit; AdminPanel, AdminUsersPanel, AdminAuditPanel",
            ],
            [
                "Batasan",
                "Hanya role ADMIN; estimasi biaya bergantung data audit &amp; pricing; "
                "auto-scan tetap dibatasi SCAN_MAX_FILES.",
            ],
        ],
        col_widths=[3.5 * cm, 13 * cm],
    ))

    # Profile
    story.append(Paragraph("8.5 Profil", s["h3"]))
    story.append(simple_table(
        ["Aspek", "Isi"],
        [
            ["Route UI", "<b>/profile</b>"],
            [
                "Tujuan",
                "Kelola profil akun dan kredensial Cloud (disimpan terenkripsi).",
            ],
            [
                "Cara pakai",
                "Isi URL cloud, username, password → simpan → uji browse di Library.",
            ],
            ["API / komponen", "/api/profile; ProfileForm"],
            [
                "Batasan",
                "Tanpa kredensial valid Library tidak bisa browse; "
                "mengganti ENCRYPTION_KEY akan merusak data terenkripsi lama.",
            ],
        ],
        col_widths=[3.5 * cm, 13 * cm],
    ))
    story.append(PageBreak())

    # ========== G / 9 SECURITY ==========
    story.append(Paragraph("G. Keamanan &amp; multi-user", s["h1"]))
    story.append(Paragraph(
        "9. Keamanan, isolasi data, role, audit, rate limit",
        s["h2"],
    ))

    story.append(Paragraph("9.1 Isolasi data per user (contoh konkret)", s["h3"]))
    story.append(Paragraph(
        "Setiap SyncFile, DocumentChunk, chat, dan favorit terikat userId. "
        "Query Search/Ask AI/Library selalu difilter ke user yang sedang login.",
        s["body"],
    ))
    story.extend(bullets([
        "User A meng-OCR folder /proyek-x → SyncFile &amp; chunk milik A.",
        "User B login: Search tidak menampilkan dokumen A; Ask AI tidak mengambil chunk A.",
        "Meski paperless_document_id bisa sama secara isi (duplikat hash), kepemilikan logika tetap per user di DB app.",
        "Kredensial WebDAV A tidak dipakai untuk request milik B.",
    ], s))
    story.append(HFlow(
        ["Login\nsession", "userId\ndi token", "Query\nWHERE userId", "Hasil\nmilik sendiri"],
        [TEAL_DARK, TEAL, SKY, AMBER],
        width=W,
    ))
    story.append(Paragraph("Gambar 20. Isolasi data per user.", s["caption"]))

    story.append(Paragraph("9.2 Enkripsi kredensial cloud (ENCRYPTION_KEY)", s["h3"]))
    story.append(Paragraph(
        "Username dan password cloud disimpan terenkripsi di kolom encrypted_bappenas_*. "
        "Kunci berasal dari env <b>ENCRYPTION_KEY</b>. Worker/portal mendekripsi hanya saat "
        "perlu akses WebDAV.",
        s["body"],
    ))
    story.append(callout(
        "<b>PERINGATAN:</b> jangan rotate / ganti ENCRYPTION_KEY setelah kredensial tersimpan. "
        "Data terenkripsi lama tidak bisa dibaca lagi, dan browse/ingest cloud akan gagal "
        "sampai kredensial diisi ulang.",
        "crit",
    ))

    story.append(Paragraph("9.3 Role ADMIN vs USER", s["h3"]))
    story.append(simple_table(
        ["Role", "Bisa", "Tidak (default)"],
        [
            [
                "USER",
                "Library, Search, Ask AI, Profil, favorit, ingest milik sendiri",
                "Halaman /admin, kelola user lain, lihat audit global",
            ],
            [
                "ADMIN",
                "Semua kemampuan USER + Admin users/audit/auto-scan",
                "Mengakses data cloud user lain tanpa kredensial mereka",
            ],
        ],
        col_widths=[2.5 * cm, 7 * cm, 7 * cm],
    ))

    story.append(Paragraph("9.4 Password hash bcrypt", s["h3"]))
    story.append(Paragraph(
        "Password login aplikasi disimpan sebagai password_hash (bcrypt), bukan plain text. "
        "Reset/ubah password lewat Admin atau alur yang disediakan; hash lama diganti hash baru.",
        s["body"],
    ))

    story.append(Paragraph("9.5 Audit", s["h3"]))
    story.append(Paragraph(
        "Aksi penting (search, chat, admin, settings) ditulis ke audit_logs dengan meta JSON. "
        "Admin memakai /api/admin/audit untuk filter waktu, aktivitas, dan estimasi pemakaian AI.",
        s["body"],
    ))

    story.append(Paragraph("9.6 Rate limit", s["h3"]))
    story.append(Paragraph(
        "Endpoint sensitif (misalnya browse cloud) dibatasi agar tidak mudah di-spam. "
        "Jika user mendapat kesalahan rate limit, tunggu sebentar lalu coba lagi.",
        s["body"],
    ))
    story.append(PageBreak())

    # ========== H / 10 OPENAI ==========
    story.append(Paragraph("H. OpenAI models &amp; biaya", s["h1"]))
    story.append(Paragraph(
        "10. Model OpenAI, kapan dipanggil, dan audit biaya",
        s["h2"],
    ))
    story.append(Paragraph(
        "DocSearch memakai OpenAI untuk dua kelas pekerjaan: <b>chat/completion</b> dan "
        "<b>embedding</b>. Model default dikonfigurasi lewat environment variable.",
        s["body"],
    ))
    story.append(simple_table(
        ["Pemakaian", "Env", "Default"],
        [
            [
                "Chat / Ask AI / ringkasan search",
                "OPENAI_MODEL",
                "<b>gpt-4o-mini</b>",
            ],
            [
                "Embedding (RAG &amp; backfill worker)",
                "OPENAI_EMBEDDING_MODEL",
                "<b>text-embedding-3-small</b>",
            ],
        ],
        col_widths=[6 * cm, 5 * cm, 5.5 * cm],
    ))

    story.append(Paragraph("10.1 Kapan OpenAI dipanggil?", s["h3"]))
    story.append(HFlow(
        ["Ask AI\nchat", "Embedding\nRAG", "Backfill\nworker", "Search\nsummary"],
        [AMBER, SKY, TEAL, MUTED],
        width=W,
    ))
    story.append(Paragraph("Gambar 21. Titik pemanggilan OpenAI.", s["caption"]))
    story.extend(bullets([
        "<b>Ask AI</b>: chat completions dengan konteks chunk yang di-retrieve.",
        "<b>Embedding untuk retrieval</b>: mengubah query/teks chunk agar pencarian semantik bekerja.",
        "<b>Embedding backfill di sync-worker</b>: setelah OCR_DONE, isi document_chunks.",
        "<b>Search summary</b>: ringkasan hasil bila fitur dikonfigurasi memakai model chat.",
    ], s))

    story.append(Paragraph("10.2 Audit pemakaian &amp; estimasi biaya", s["h3"]))
    story.append(Paragraph(
        "Pemakaian dicatat lewat audit (meta berisi token/estimasi bila tersedia). "
        "Admin dapat melihat ringkasan hit AI dan estimasi biaya di panel audit. "
        "Angka bersifat perkiraan berdasarkan pricing yang dikonfigurasi di kode "
        "(mis. rate per 1M token untuk gpt-4o-mini), bukan invoice resmi OpenAI.",
        s["body"],
    ))
    story.append(callout(
        "<b>Tanpa OPENAI_API_KEY:</b> Ask AI dan embedding terbatas atau tidak berfungsi. "
        "Pipeline OCR/Library tetap jalan, tetapi Search semantik &amp; chat berbasis dokumen "
        "tidak optimal.",
        "warn",
    ))
    story.append(simple_table(
        ["Kondisi", "Dampak ke produk"],
        [
            ["Key valid + model default", "Ask AI, embed, summary berjalan normal"],
            ["Key hilang / invalid", "Chat/embedding gagal; OCR &amp; browse cloud tetap"],
            ["Banyak ingest sekaligus", "Lonjakan biaya embedding backfill - pantau SCAN_MAX_FILES"],
            ["Banyak chat panjang", "Lonjakan token chat - pantau audit Admin"],
        ],
        col_widths=[5.5 * cm, 11 * cm],
    ))
    story.append(PageBreak())

    # ========== I / 11 OPERATIONS ==========
    story.append(Paragraph("I. Operasional", s["h1"]))
    story.append(Paragraph(
        "11. Deploy, backup, health, dan tuning 8 GB RAM",
        s["h2"],
    ))

    story.append(Paragraph("11.1 Deploy / update singkat", s["h3"]))
    story.append(Paragraph(
        "Layanan dijalankan dengan Docker Compose. Alur operasional tipikal:",
        s["body"],
    ))
    vflow(story, [
        ("Siapkan .env (secret, token Paperless, ENCRYPTION_KEY, OpenAI)", TEAL_DARK),
        ("docker compose build / up (atau scripts/server-up.sh)", TEAL),
        ("Pastikan migrate/seed DB app &amp; token Paperless terisi", SKY),
        ("Update: pull kode → scripts/deploy-remote.sh / compose up -d --build", AMBER),
        ("Cek health &amp; logs layanan", TEAL),
    ], s, "Gambar 22. Konsep deploy / update.")
    story.extend(bullets([
        "<b>docker compose</b>: orkestrasi postgres, redis, paperless, sync-worker, app.",
        "<b>scripts/server-up.sh</b>: membantu menyalakan stack di server.",
        "<b>scripts/deploy-remote.sh</b>: pola deploy/update jarak jauh (konsep: sync kode + rebuild).",
    ], s))

    story.append(Paragraph("11.2 Backup", s["h3"]))
    story.append(simple_table(
        ["Yang dibackup", "Mengapa penting"],
        [
            ["Volume / data PostgreSQL", "Berisi DB app (user, SyncFile, chat, audit) + DB paperless"],
            ["Media &amp; data Paperless", "PDF terproses / hasil OCR tidak hanya di DB"],
            ["File .env", "Secret, token, ENCRYPTION_KEY, model OpenAI - simpan aman"],
            ["(Opsional) volume consume", "Transient; prioritas utama media+DB+env"],
        ],
        col_widths=[5.5 * cm, 11 * cm],
    ))
    story.append(callout(
        "<b>Backup ENCRYPTION_KEY bersama data.</b> Restore DB tanpa kunci yang sama = "
        "kredensial cloud tidak bisa didekripsi.",
        "crit",
    ))

    story.append(Paragraph("11.3 Health &amp; monitoring ringan", s["h3"]))
    story.extend(bullets([
        "Endpoint <b>/api/health</b>: cek hidupnya portal (middleware mengizinkan tanpa auth penuh).",
        "<b>docker compose ps</b>: pastikan app, sync-worker, paperless, postgres, redis Up.",
        "<b>docker compose logs</b> (app / sync-worker / paperless): unduh gagal, OCR timeout, antrean.",
        "Di UI: pantau status FAILED / OCR_PENDING di Library; di Admin pantau audit AI.",
    ], s))

    story.append(Paragraph("11.4 Tuning untuk sekitar 8 GB RAM", s["h3"]))
    story.append(Paragraph(
        "Paperless biasanya konsumen memori terbesar. Di mesin 8 GB, jaga beban OCR dan batch scan:",
        s["body"],
    ))
    story.append(simple_table(
        ["Parameter", "Saran praktis", "Alasan"],
        [
            ["PAPERLESS_TASK_WORKERS / threads", "1 / 1", "Cegah OOM saat OCR"],
            ["PAPERLESS_WEBSERVER_WORKERS", "1", "Cukup untuk API internal"],
            ["SCAN_MAX_FILES", "20 (atau lebih kecil)", "Batasi lonjakan unduh+OCR+embed"],
            ["OCR_PENDING_TIMEOUT_MINUTES", "180 (default)", "Beri waktu OCR; sesuaikan jika antre panjang"],
            ["Interval reconcile / auto-scan", "Jangan terlalu agresif", "Kurangi CPU idle thrash"],
            ["PAPERLESS_MEM_LIMIT", "mis. 1536m", "Batasi kontainer OCR"],
        ],
        col_widths=[5.5 * cm, 4.5 * cm, 6.5 * cm],
    ))
    story.append(PageBreak())

    # ========== J / 12 APPENDIX ==========
    story.append(Paragraph("J. Lampiran", s["h1"]))
    story.append(Paragraph("12. Glosarium, FAQ, checklist go-live", s["h2"]))

    story.append(Paragraph("12.1 Glosarium", s["h3"]))
    story.append(simple_table(
        ["Istilah", "Arti sederhana"],
        [
            ["OCR", "Mengenali teks dari gambar/PDF scan"],
            ["WebDAV", "Protokol akses file di cloud (list/download)"],
            ["Ingest / consume", "Memasukkan file ke pipeline OCR Paperless"],
            ["Consume folder", "Folder pantauan Paperless untuk file masuk"],
            ["Embedding", "Representasi angka dari teks untuk pencarian semantik"],
            ["RAG", "Jawab AI dengan mengambil cuplikan dokumen relevan dulu"],
            ["BullMQ", "Sistem antre pekerjaan di Redis"],
            ["SyncFile", "Catatan status satu file cloud di database app"],
            ["ScanJob", "Batch pekerjaan discovery/unduh/OCR"],
            ["Reconcile", "Mencocokkan SyncFile ke dokumen Paperless (checksum → ID)"],
            ["content_hash", "Checksum isi file untuk duplikat &amp; pencocokan"],
            ["paperless_document_id", "ID dokumen di Paperless setelah OCR"],
            ["SKIPPED", "Status: isi sudah ada / tidak perlu OCR ulang"],
            ["FAILED", "Status: gagal (0B, timeout, unduh, dll.)"],
            ["ENCRYPTION_KEY", "Kunci enkripsi kredensial cloud at rest"],
            ["OPENAI_MODEL", "Model chat (default gpt-4o-mini)"],
            ["OPENAI_EMBEDDING_MODEL", "Model embedding (default text-embedding-3-small)"],
            ["Paperless-ngx", "Mesin open-source OCR &amp; arsip dokumen"],
            ["AUTO_SCAN", "Ingest otomatis folder favorit sesuai interval"],
            ["SCAN_MAX_FILES", "Batas jumlah file per batch scan/ingest"],
        ],
        col_widths=[4.5 * cm, 12 * cm],
    ))
    story.append(PageBreak())

    story.append(Paragraph("12.2 FAQ", s["h3"]))
    story.append(simple_table(
        ["Pertanyaan", "Jawaban singkat"],
        [
            [
                "Kenapa file tidak muncul di Search?",
                "Belum OCR_DONE (masih pending/gagal), atau bukan milik user login. "
                "Cek status di Library; pastikan reconcile selesai.",
            ],
            [
                "Kenapa OCR lama?",
                "Antre Paperless, PDF besar/scan berat, worker=1 di RAM terbatas, "
                "atau banyak batch bersamaan. Pantau OCR_PENDING &amp; logs.",
            ],
            [
                "Apa itu file 0B?",
                "File kosong di cloud. Tidak dikirim OCR; status FAILED. "
                "Perbaiki sumber di cloud lalu retry.",
            ],
            [
                "Kredensial cloud error?",
                "Isi ulang di Profil. Pastikan URL/username/password benar. "
                "Jangan ganti ENCRYPTION_KEY setelah data tersimpan.",
            ],
            [
                "Ask AI kosong / lemah?",
                "Belum ada chunk/embedding, OPENAI_API_KEY hilang, atau scope dokumen kosong. "
                "Selesaikan OCR dulu, cek key, perluas scope.",
            ],
            [
                "Apa bedanya SKIPPED dan OCR_DONE?",
                "Keduanya bisa dipakai bila ada document ID. SKIPPED biasanya duplikat isi "
                "(hash sama) tanpa OCR ulang.",
            ],
            [
                "Auto-scan tidak jalan?",
                "Cek toggle Admin, AUTO_SCAN_ENABLED, interval, dan apakah ada favorit. "
                "Batch tetap dibatasi SCAN_MAX_FILES.",
            ],
        ],
        col_widths=[5 * cm, 11.5 * cm],
    ))

    story.append(Paragraph("12.3 Checklist go-live", s["h3"]))
    story.extend(bullets([
        ".env lengkap: NEXTAUTH_SECRET, ENCRYPTION_KEY, Postgres, PAPERLESS_SECRET_KEY, admin Paperless.",
        "PAPERLESS_API_TOKEN diisi dan dicoba (preview/reconcile berhasil).",
        "OPENAI_API_KEY diisi jika Ask AI / embedding dibutuhkan; model default dicek.",
        "Docker Compose: semua layanan Up; /api/health OK.",
        "User ADMIN dibuat; user uji punya kredensial cloud valid di Profil.",
        "Uji alur: browse → ingest 1 PDF kecil → tunggu OCR_DONE → Search → Ask AI.",
        "Uji file 0B / retry / FAILED terlihat benar di UI.",
        "Backup: rencana volume Postgres + media Paperless + salinan .env aman.",
        "Tuning 8 GB: workers Paperless=1, SCAN_MAX_FILES terkendali.",
        "Auto-scan: biarkan off dulu di produksi sampai pantauan beban stabil.",
        "Admin audit: pastikan aktivitas chat/search tercatat.",
        "Dokumentasikan kontak operasional (siapa restart compose, siapa pegang secret).",
    ], s))

    story.append(Spacer(1, 0.6 * cm))
    story.append(callout(
        "<b>Penutup.</b> DocSearch memakai Paperless-ngx sebagai fondasi OCR yang terbukti, "
        "lalu membungkusnya dengan portal multi-user, worker sync cloud, database aplikasi, "
        "embedding, dan Ask AI. Hasilnya bukan sekadar penyimpan PDF, melainkan sistem agar "
        "dokumen organisasi bisa diambil, dibaca mesin, dicari, dan ditanyakan secara terkendali "
        "dengan status yang jelas dan jejak audit.",
        "info",
    ))

    # Build
    doc = SimpleDocTemplate(
        str(PDF_PATH),
        pagesize=A4,
        leftMargin=2 * cm,
        rightMargin=2 * cm,
        topMargin=2 * cm,
        bottomMargin=1.8 * cm,
        title="DocSearch - Dokumentasi Aplikasi",
        author="DocSearch",
    )
    doc.build(story, onFirstPage=header_footer, onLaterPages=header_footer)
    print(f"Created: {PDF_PATH}")
    print(f"Size: {PDF_PATH.stat().st_size / 1024:.1f} KB")


if __name__ == "__main__":
    build()
