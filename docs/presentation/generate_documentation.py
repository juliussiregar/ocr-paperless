#!/usr/bin/env python3
"""
DocSearch — Comprehensive Application Documentation (PDF).
Cool English section titles; body in Indonesian. Many flowcharts.
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
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)

OUT = Path(__file__).resolve().parent
PDF_PATH = OUT / "DocSearch-Dokumentasi-Aplikasi.pdf"

# Colors
TEAL = colors.HexColor("#0B6E63")
TEAL_DEEP = colors.HexColor("#064E40")
TEAL_SOFT = colors.HexColor("#E8F5F3")
TEAL_MID = colors.HexColor("#5FABA0")
INK = colors.HexColor("#1E293B")
MUTED = colors.HexColor("#64748B")
LINE = colors.HexColor("#CBD5E1")
SKY = colors.HexColor("#0E7490")
AMBER = colors.HexColor("#B45309")
WHITE = colors.white
SLATE = colors.HexColor("#F8FAFC")


# ---------------------------------------------------------------------------
# Flowchart drawing
# ---------------------------------------------------------------------------

class FlowChart(Flowable):
    """Horizontal or vertical box flowchart with arrows."""

    def __init__(
        self,
        boxes: list[tuple[str, str]],
        *,
        width=17 * cm,
        box_h=1.55 * cm,
        vertical=False,
        fill=TEAL,
    ):
        Flowable.__init__(self)
        self.boxes = boxes
        self.width = width
        self.box_h = box_h
        self.vertical = vertical
        self.fill = fill
        n = len(boxes)
        if vertical:
            gap = 0.45 * cm
            self.height = n * box_h + (n - 1) * gap + 0.2 * cm
        else:
            self.height = box_h + 0.8 * cm

    def draw(self):
        c = self.canv
        n = len(self.boxes)
        if self.vertical:
            gap = 0.45 * cm
            bw = self.width * 0.72
            bx = (self.width - bw) / 2
            y = self.height - self.box_h
            for i, (title, sub) in enumerate(self.boxes):
                self._box(c, bx, y, bw, self.box_h, title, sub)
                if i < n - 1:
                    ax = self.width / 2
                    c.setStrokeColor(TEAL_MID)
                    c.setFillColor(TEAL_MID)
                    c.setLineWidth(1.5)
                    c.line(ax, y - 2, ax, y - gap + 6)
                    path = c.beginPath()
                    path.moveTo(ax - 4, y - gap + 8)
                    path.lineTo(ax, y - gap + 2)
                    path.lineTo(ax + 4, y - gap + 8)
                    path.close()
                    c.drawPath(path, fill=1, stroke=0)
                y -= self.box_h + gap
        else:
            gap = 0.28 * cm
            arrow_w = 0.35 * cm
            usable = self.width - (n - 1) * (gap + arrow_w)
            bw = usable / n
            x = 0
            y = 0.35 * cm
            for i, (title, sub) in enumerate(self.boxes):
                self._box(c, x, y, bw, self.box_h, title, sub)
                if i < n - 1:
                    ax0 = x + bw + 2
                    ax1 = x + bw + gap + arrow_w - 2
                    midy = y + self.box_h / 2
                    c.setStrokeColor(TEAL_MID)
                    c.setFillColor(TEAL_MID)
                    c.setLineWidth(1.5)
                    c.line(ax0, midy, ax1 - 4, midy)
                    path = c.beginPath()
                    path.moveTo(ax1 - 5, midy - 4)
                    path.lineTo(ax1, midy)
                    path.lineTo(ax1 - 5, midy + 4)
                    path.close()
                    c.drawPath(path, fill=1, stroke=0)
                x += bw + gap + arrow_w

    def _box(self, c, x, y, w, h, title, sub):
        c.setFillColor(self.fill)
        c.setStrokeColor(self.fill)
        c.roundRect(x, y, w, h, 6, fill=1, stroke=0)
        c.setFillColor(WHITE)
        c.setFont("Helvetica-Bold", 9)
        # wrap title
        lines = title.split("\n")
        ty = y + h - 16
        for line in lines:
            c.drawCentredString(x + w / 2, ty, line)
            ty -= 11
        if sub:
            c.setFont("Helvetica", 7.5)
            c.setFillColor(colors.HexColor("#D1FAE5"))
            for line in sub.split("\n"):
                c.drawCentredString(x + w / 2, ty - 2, line)
                ty -= 9


class LayerDiagram(Flowable):
    """Stacked architecture layers."""

    def __init__(self, layers: list[tuple[str, str, colors.Color]], width=17 * cm):
        Flowable.__init__(self)
        self.layers = layers
        self.width = width
        self.row_h = 1.35 * cm
        self.gap = 0.25 * cm
        self.height = len(layers) * self.row_h + (len(layers) - 1) * self.gap

    def draw(self):
        c = self.canv
        y = self.height - self.row_h
        for i, (title, sub, fill) in enumerate(self.layers):
            c.setFillColor(fill)
            c.roundRect(0, y, self.width, self.row_h, 5, fill=1, stroke=0)
            c.setFillColor(WHITE)
            c.setFont("Helvetica-Bold", 11)
            c.drawString(12, y + self.row_h / 2 + 4, title)
            c.setFont("Helvetica", 8)
            c.setFillColor(colors.HexColor("#ECFDF5"))
            c.drawString(12, y + self.row_h / 2 - 10, sub)
            if i < len(self.layers) - 1:
                mid = self.width / 2
                c.setFillColor(TEAL_MID)
                c.setStrokeColor(TEAL_MID)
                c.line(mid, y - 1, mid, y - self.gap + 4)
            y -= self.row_h + self.gap


class StatusPipeline(Flowable):
    def __init__(self, statuses: list[tuple[str, colors.Color]], width=17 * cm):
        Flowable.__init__(self)
        self.statuses = statuses
        self.width = width
        self.height = 1.8 * cm

    def draw(self):
        c = self.canv
        n = len(self.statuses)
        gap = 0.2 * cm
        aw = 0.25 * cm
        bw = (self.width - (n - 1) * (gap + aw)) / n
        x = 0
        y = 0.35 * cm
        h = 1.2 * cm
        for i, (label, fill) in enumerate(self.statuses):
            c.setFillColor(fill)
            c.roundRect(x, y, bw, h, 4, fill=1, stroke=0)
            c.setFillColor(WHITE)
            c.setFont("Helvetica-Bold", 7)
            # multi-line label
            parts = label.split("\n")
            ty = y + h / 2 + (len(parts) - 1) * 4
            for p in parts:
                c.drawCentredString(x + bw / 2, ty, p)
                ty -= 9
            if i < n - 1:
                c.setFillColor(TEAL_MID)
                midy = y + h / 2
                c.line(x + bw + 2, midy, x + bw + gap + aw - 4, midy)
                path = c.beginPath()
                ax1 = x + bw + gap + aw
                path.moveTo(ax1 - 5, midy - 3)
                path.lineTo(ax1, midy)
                path.lineTo(ax1 - 5, midy + 3)
                path.close()
                c.drawPath(path, fill=1, stroke=0)
            x += bw + gap + aw


# ---------------------------------------------------------------------------
# Page chrome
# ---------------------------------------------------------------------------

def on_page(canvas, doc):
    canvas.saveState()
    # header line
    if doc.page > 1:
        canvas.setStrokeColor(LINE)
        canvas.setLineWidth(0.5)
        canvas.line(2 * cm, A4[1] - 1.4 * cm, A4[0] - 2 * cm, A4[1] - 1.4 * cm)
        canvas.setFont("Helvetica-Bold", 8)
        canvas.setFillColor(TEAL)
        canvas.drawString(2 * cm, A4[1] - 1.2 * cm, "DocSearch")
        canvas.setFont("Helvetica", 8)
        canvas.setFillColor(MUTED)
        canvas.drawRightString(A4[0] - 2 * cm, A4[1] - 1.2 * cm, "Application Documentation")
        # footer
        canvas.line(2 * cm, 1.3 * cm, A4[0] - 2 * cm, 1.3 * cm)
        canvas.drawCentredString(A4[0] / 2, 0.85 * cm, f"{doc.page}")
    canvas.restoreState()


def styles():
    base = getSampleStyleSheet()
    return {
        "cover_kicker": ParagraphStyle(
            "cover_kicker", fontName="Helvetica", fontSize=11, textColor=TEAL_MID, alignment=TA_CENTER, spaceAfter=8, tracking=1
        ),
        "cover_title": ParagraphStyle(
            "cover_title", fontName="Helvetica-Bold", fontSize=28, textColor=TEAL_DEEP, alignment=TA_CENTER, spaceAfter=12, leading=34
        ),
        "cover_sub": ParagraphStyle(
            "cover_sub", fontName="Helvetica", fontSize=12, textColor=MUTED, alignment=TA_CENTER, spaceAfter=6, leading=16
        ),
        "h1": ParagraphStyle(
            "h1", fontName="Helvetica-Bold", fontSize=16, textColor=TEAL_DEEP, spaceBefore=6, spaceAfter=8, leading=20
        ),
        "h2": ParagraphStyle(
            "h2", fontName="Helvetica-Bold", fontSize=12, textColor=TEAL, spaceBefore=12, spaceAfter=6, leading=15
        ),
        "h3": ParagraphStyle(
            "h3", fontName="Helvetica-Bold", fontSize=10.5, textColor=INK, spaceBefore=8, spaceAfter=4, leading=13
        ),
        "body": ParagraphStyle(
            "body", fontName="Helvetica", fontSize=9.5, textColor=INK, alignment=TA_JUSTIFY, spaceAfter=7, leading=13.5
        ),
        "bullet": ParagraphStyle(
            "bullet", fontName="Helvetica", fontSize=9.5, textColor=INK, leftIndent=12, spaceAfter=3, leading=13
        ),
        "note": ParagraphStyle(
            "note", fontName="Helvetica-Oblique", fontSize=8.5, textColor=MUTED, spaceBefore=4, spaceAfter=8, leading=12
        ),
        "caption": ParagraphStyle(
            "caption", fontName="Helvetica", fontSize=8, textColor=MUTED, alignment=TA_CENTER, spaceBefore=4, spaceAfter=10
        ),
        "table_cell": ParagraphStyle(
            "table_cell", fontName="Helvetica", fontSize=8, textColor=INK, leading=11
        ),
        "table_head": ParagraphStyle(
            "table_head", fontName="Helvetica-Bold", fontSize=8, textColor=WHITE, leading=11
        ),
    }


def bullets(items: list[str], S) -> ListFlowable:
    return ListFlowable(
        [ListItem(Paragraph(i, S["bullet"]), leftIndent=8, bulletColor=TEAL) for i in items],
        bulletType="bullet",
        start="•",
        leftIndent=15,
        bulletFontSize=8,
    )


def section_title(en: str, id_sub: str | None, S):
    parts = [Paragraph(en, S["h1"])]
    if id_sub:
        parts.append(Paragraph(id_sub, S["note"]))
    return parts


def simple_table(headers: list[str], rows: list[list[str]], S, col_widths=None):
    data = [[Paragraph(h, S["table_head"]) for h in headers]]
    for row in rows:
        data.append([Paragraph(c, S["table_cell"]) for c in row])
    t = Table(data, colWidths=col_widths, repeatRows=1)
    t.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, 0), TEAL),
                ("BACKGROUND", (0, 1), (-1, -1), SLATE),
                ("ROWBACKGROUNDS", (0, 1), (-1, -1), [SLATE, WHITE]),
                ("GRID", (0, 0), (-1, -1), 0.4, LINE),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("TOPPADDING", (0, 0), (-1, -1), 5),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
                ("LEFTPADDING", (0, 0), (-1, -1), 6),
                ("RIGHTPADDING", (0, 0), (-1, -1), 6),
            ]
        )
    )
    return t


def callout(title: str, body: str, S):
    data = [[Paragraph(f"<b>{title}</b><br/>{body}", S["body"])]]
    t = Table(data, colWidths=[17 * cm])
    t.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, -1), TEAL_SOFT),
                ("BOX", (0, 0), (-1, -1), 1, TEAL_MID),
                ("LEFTPADDING", (0, 0), (-1, -1), 10),
                ("RIGHTPADDING", (0, 0), (-1, -1), 10),
                ("TOPPADDING", (0, 0), (-1, -1), 8),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
            ]
        )
    )
    return t


# ---------------------------------------------------------------------------
# Document body
# ---------------------------------------------------------------------------

def build():
    S = styles()
    story: list = []

    # ===== COVER =====
    story.append(Spacer(1, 3.2 * cm))
    story.append(Paragraph("APPLICATION DOCUMENTATION", S["cover_kicker"]))
    story.append(Paragraph("DocSearch", S["cover_title"]))
    story.append(
        Paragraph(
            "Portal OCR, Library Cloud, Hybrid Search &amp; Ask AI<br/>untuk dokumen organisasi",
            S["cover_sub"],
        )
    )
    story.append(Spacer(1, 0.8 * cm))
    story.append(
        Paragraph(
            "Dokumen ini menjelaskan cara kerja aplikasi secara menyeluruh:<br/>"
            "Paperless-ngx, arsitektur, stack, database, pipeline sync, dan fitur portal.",
            S["cover_sub"],
        )
    )
    story.append(Spacer(1, 2 * cm))
    story.append(Paragraph("Versi dokumentasi · 2026", S["cover_sub"]))
    story.append(PageBreak())

    # ===== TOC-ish overview =====
    story += section_title("Table of Contents", "Daftar isi ringkas", S)
    toc = [
        "1. Executive Overview",
        "2. Problem Statement &amp; Product Promise",
        "3. Paperless-ngx Deep Dive",
        "4. System Architecture",
        "5. Technology Stack",
        "6. Core Components",
        "7. Data Model &amp; Database",
        "8. Sync &amp; OCR Pipeline",
        "9. Search &amp; Ask AI (RAG)",
        "10. Portal Features",
        "11. Security Model",
        "12. Infrastructure Blueprint",
        "13. Glossary",
    ]
    for t in toc:
        story.append(Paragraph(t, S["bullet"]))
    story.append(PageBreak())

    # ===== 1 =====
    story += section_title("1. Executive Overview", "Ringkasan eksekutif", S)
    story.append(
        Paragraph(
            "DocSearch adalah portal web untuk organisasi yang menyimpan PDF di cloud "
            "(contoh: Cloud Bappenas via WebDAV). Aplikasi membantu pengguna <b>mengambil</b> "
            "dokumen dari cloud, <b>mengubahnya menjadi teks</b> lewat OCR, lalu "
            "<b>mencari isi</b> dan <b>bertanya ke AI</b> berdasarkan dokumen yang sudah diproses.",
            S["body"],
        )
    )
    story.append(
        Paragraph(
            "Secara singkat: cloud tetap jadi sumber kebenaran file asli; DocSearch menjadi "
            "lapisan cerdas di atasnya (indeks, status, pencarian, chat).",
            S["body"],
        )
    )
    story.append(Paragraph("Value Chain", S["h2"]))
    story.append(
        FlowChart(
            [
                ("Cloud\nStorage", "PDF asli"),
                ("Ingest &\nOCR", "Paperless"),
                ("Index &\nEmbed", "DB + AI"),
                ("Search &\nAsk AI", "Portal"),
            ]
        )
    )
    story.append(Paragraph("Gambar 1. Rantai nilai DocSearch (tinggi level)", S["caption"]))
    story.append(PageBreak())

    # ===== 2 =====
    story += section_title("2. Problem Statement &amp; Product Promise", "Masalah dan janji produk", S)
    story.append(Paragraph("Pain Points", S["h2"]))
    story.append(
        bullets(
            [
                "File banyak di cloud, tapi isi PDF tidak mudah dicari (search hanya nama file).",
                "OCR manual tidak skalabel untuk ratusan/ribuan dokumen.",
                "Sulit tahu mana yang sudah siap dibaca mesin, mana yang gagal atau kosong (0 byte).",
                "Tanya isi dokumen masih bergantung orang atau buka PDF satu per satu.",
            ],
            S,
        )
    )
    story.append(Paragraph("Product Promise", S["h2"]))
    story.append(
        bullets(
            [
                "Browse cloud dari satu portal (Library).",
                "Fetch &amp; OCR otomatis dengan status transparan.",
                "Hybrid search: kata kunci + makna (embedding).",
                "Ask AI dengan kutipan dari dokumen milik user.",
                "Isolasi data per pengguna; admin punya audit &amp; manajemen user.",
            ],
            S,
        )
    )
    story.append(PageBreak())

    # ===== 3 Paperless =====
    story += section_title(
        "3. Paperless-ngx Deep Dive",
        "Asal-usul, kelebihan, fungsi, dan peran di DocSearch",
        S,
    )
    story.append(Paragraph("Origin Story", S["h2"]))
    story.append(
        Paragraph(
            "<b>Paperless</b> awalnya proyek open-source untuk mendigitalkan arsip kertas "
            "(scan → OCR → arsip searchable). Komunitas lalu melanjutkan dan memodernisasi "
            "proyek tersebut sebagai <b>Paperless-ngx</b>: fork yang aktif dikembangkan, "
            "lebih mudah di-deploy (Docker), dengan antrean tugas, API, dan dukungan multi-bahasa OCR.",
            S["body"],
        )
    )
    story.append(
        Paragraph(
            "Nama “ngx” menandai generasi baru setelah proyek asli. Fokusnya tetap sama: "
            "<i>document management dengan OCR</i>, bukan sekadar folder file.",
            S["body"],
        )
    )

    story.append(Paragraph("Why Paperless-ngx?", S["h2"]))
    story.append(
        bullets(
            [
                "<b>OCR built-in</b> (Tesseract) dengan bahasa yang bisa dikonfigurasi (di sini: Inggris + Indonesia).",
                "<b>Consumer folder</b>: taruh PDF ke folder consume, otomatis diproses.",
                "<b>REST API</b>: cocok diintegrasikan ke aplikasi lain (seperti DocSearch).",
                "<b>Metadata &amp; full-text</b>: hasil OCR bisa dicari di dalam Paperless sendiri.",
                "<b>Mature &amp; open-source</b>: tidak perlu membangun mesin OCR dari nol.",
                "<b>Docker-friendly</b>: mudah dipaket bersama Postgres &amp; Redis.",
            ],
            S,
        )
    )

    story.append(Paragraph("Core Capabilities (Paperless-ngx)", S["h2"]))
    story.append(
        simple_table(
            ["Capability", "Arti praktis"],
            [
                ["Document ingest", "Menerima PDF (upload / consume folder)"],
                ["OCR pipeline", "Mengenali teks dari scan atau PDF image-based"],
                ["Full-text index", "Mencari isi dokumen di UI Paperless"],
                ["Tags / correspondents", "Mengorganisasi dokumen (opsional)"],
                ["REST API + token", "Integrasi sistem eksternal"],
                ["Preview &amp; download", "Melihat/mengunduh dokumen terproses"],
            ],
            S,
            col_widths=[5.5 * cm, 11.5 * cm],
        )
    )
    story.append(Spacer(1, 0.3 * cm))

    story.append(Paragraph("What DocSearch Uses from Paperless", S["h2"]))
    story.append(
        Paragraph(
            "DocSearch <b>tidak</b> menggantikan Paperless sebagai mesin OCR. Portal memakai Paperless sebagai "
            "<b>OCR engine + document store</b> di belakang layar. Pengguna akhir biasanya cukup di portal DocSearch; "
            "UI admin Paperless lebih untuk operasi/teknis (token API, cek kesehatan OCR).",
            S["body"],
        )
    )
    story.append(
        bullets(
            [
                "<b>Consume directory</b>: sync-worker menaruh PDF yang diunduh dari WebDAV ke folder consume.",
                "<b>OCR eng+ind</b>: bahasa OCR disetel untuk dokumen Indonesia &amp; Inggris.",
                "<b>API token</b>: app &amp; worker memanggil Paperless untuk status, preview, download, checksum.",
                "<b>Document ID</b>: setelah OCR selesai, ID dokumen Paperless disimpan di database DocSearch "
                "(field <i>paperlessDocumentId</i>) agar portal bisa preview / Ask AI.",
                "<b>Polling / reconcile</b>: worker memeriksa berkala mana yang sudah OCR_DONE.",
            ],
            S,
        )
    )
    story.append(
        callout(
            "Batas tanggung jawab",
            "Paperless fokus OCR &amp; arsip dokumen. Login multi-user cloud Bappenas, Library UX, "
            "hybrid search, Ask AI, audit OpenAI, dan isolasi per user adalah tanggung jawab DocSearch.",
            S,
        )
    )
    story.append(Spacer(1, 0.25 * cm))
    story.append(Paragraph("Paperless in the Pipeline", S["h2"]))
    story.append(
        FlowChart(
            [
                ("PDF dari\nWebDAV", "sync-worker"),
                ("Consume\nFolder", "drop file"),
                ("Paperless\nOCR", "eng + ind"),
                ("Document\nReady", "API + ID"),
            ],
            fill=SKY,
        )
    )
    story.append(Paragraph("Gambar 2. Peran Paperless-ngx di DocSearch", S["caption"]))
    story.append(PageBreak())

    # ===== 4 Architecture =====
    story += section_title("4. System Architecture", "Arsitektur sistem", S)
    story.append(
        Paragraph(
            "DocSearch terdiri dari beberapa layanan yang berjalan bersama (biasanya lewat Docker Compose). "
            "Browser hanya berbicara ke <b>portal web</b>. Portal dan worker berbagi database &amp; antrean, "
            "serta memanggil Paperless dan (opsional) OpenAI.",
            S["body"],
        )
    )
    story.append(
        LayerDiagram(
            [
                ("Presentation Layer — Portal Web (Next.js)", "Ask AI · Search · Library · Admin · Auth", TEAL_DEEP),
                ("Application Services — API Routes + Sync Worker", "Ingest jobs · WebDAV · reconcile OCR · embeddings", TEAL),
                ("Intelligence &amp; OCR — Paperless-ngx + OpenAI", "OCR teks · chat · embedding", SKY),
                ("Data Plane — PostgreSQL + Redis + File volumes", "Metadata app · antre BullMQ · media OCR", AMBER),
                ("Source of Truth — Organizational Cloud (WebDAV)", "PDF asli per kredensial pengguna", colors.HexColor("#475569")),
            ]
        )
    )
    story.append(Paragraph("Gambar 3. Layer arsitektur DocSearch", S["caption"]))

    story.append(Paragraph("Runtime Topology", S["h2"]))
    story.append(
        simple_table(
            ["Service", "Peran"],
            [
                ["app", "Portal Next.js (UI + API)"],
                ["sync-worker", "Unduh WebDAV, antre scan, reconcile OCR, embedding"],
                ["paperless", "Mesin OCR &amp; penyimpanan dokumen terproses"],
                ["postgres", "Database (skema app + DB Paperless)"],
                ["redis", "Cache &amp; antre pekerjaan (BullMQ)"],
            ],
            S,
            col_widths=[4 * cm, 13 * cm],
        )
    )
    story.append(PageBreak())

    # ===== 5 Stack =====
    story += section_title("5. Technology Stack", "Stack teknologi", S)
    story.append(
        simple_table(
            ["Layer", "Teknologi", "Catatan"],
            [
                ["Frontend", "Next.js 16, React 19, Tailwind CSS", "App Router, UI portal"],
                ["Auth", "NextAuth (Auth.js) v5", "Session login, role ADMIN/USER"],
                ["API", "Next.js Route Handlers", "REST JSON internal"],
                ["ORM", "Prisma 6", "Skema TypeScript-first"],
                ["Worker", "Node.js + TypeScript", "Proses background sync"],
                ["Queue", "BullMQ + Redis 7", "Scan jobs &amp; concurrency"],
                ["OCR DMS", "Paperless-ngx", "Consume + OCR + API"],
                ["Database", "PostgreSQL 16", "App DB + Paperless DB"],
                ["Cloud I/O", "WebDAV client", "Cloud organisasi"],
                ["AI", "OpenAI API", "gpt-4o-mini + text-embedding-3-small"],
                ["Packaging", "Docker Compose", "Deploy multi-service"],
            ],
            S,
            col_widths=[3.2 * cm, 6.5 * cm, 7.3 * cm],
        )
    )
    story.append(Spacer(1, 0.3 * cm))
    story.append(
        callout(
            "Design choice",
            "OCR tidak ditulis sendiri: memakai Paperless-ngx. AI tidak menyimpan dokumen mentah di OpenAI "
            "sebagai “drive”; OpenAI dipakai untuk embedding/chat atas potongan teks yang sudah di-OCR di infrastruktur sendiri.",
            S,
        )
    )
    story.append(PageBreak())

    # ===== 6 Components =====
    story += section_title("6. Core Components", "Komponen inti", S)

    story.append(Paragraph("6.1 Portal Web (app)", S["h2"]))
    story.append(
        Paragraph(
            "Aplikasi Next.js yang dilihat pengguna. Menyediakan halaman Ask AI, Search, Library (cloud browser), "
            "Profil, dan Admin. API di dalamnya mengurus auth, browse WebDAV, trigger ingest, search hybrid, chat, "
            "preview dokumen, serta audit.",
            S["body"],
        )
    )

    story.append(Paragraph("6.2 Sync Worker", S["h2"]))
    story.append(
        Paragraph(
            "Proses Node.js terpisah. Bertugas menjalankan job scan/ingest: discovery file di cloud, unduh PDF, "
            "validasi file kosong, kirim ke folder consume Paperless, memantau status OCR, dan membuat "
            "<i>document chunks</i> + embedding untuk Ask AI. Juga mendukung auto-scan terjadwal (folder favorit).",
            S["body"],
        )
    )

    story.append(Paragraph("6.3 Paperless-ngx", S["h2"]))
    story.append(
        Paragraph(
            "Mesin OCR dan penyimpanan dokumen hasil proses. Di DocSearch dikonfigurasi hemat resource "
            "(worker OCR terbatas) agar cocok di server ber-RAM 8 GB.",
            S["body"],
        )
    )

    story.append(Paragraph("6.4 PostgreSQL", S["h2"]))
    story.append(
        Paragraph(
            "Satu instance Postgres melayani dua database logis: database aplikasi DocSearch (user, sync, chat, audit, chunks) "
            "dan database milik Paperless. Ini mengurangi jumlah server database yang harus dikelola.",
            S["body"],
        )
    )

    story.append(Paragraph("6.5 Redis", S["h2"]))
    story.append(
        Paragraph(
            "Dipakai Paperless (broker tugas) dan DocSearch (BullMQ untuk scan jobs). Redis di-setting memory-limit "
            "agar tidak “makan” RAM tanpa batas.",
            S["body"],
        )
    )
    story.append(PageBreak())

    # ===== 7 Data model =====
    story += section_title("7. Data Model &amp; Database", "Model data &amp; database", S)
    story.append(
        Paragraph(
            "Database aplikasi memakai Prisma. Tabel penting:",
            S["body"],
        )
    )
    story.append(
        simple_table(
            ["Entity", "Isi utama"],
            [
                ["User", "Akun, role, kredensial cloud terenkripsi"],
                ["SyncFile", "Path remote, status pipeline, size, paperlessDocumentId"],
                ["DocumentChunk", "Potongan teks OCR + embedding JSON"],
                ["ScanJob", "Batch ingest: progress, phase, cancel/pause"],
                ["CloudFavorite", "Folder favorit + lastSyncedAt (delta scan)"],
                ["ChatConversation / ChatMessage", "Riwayat Ask AI + kutipan"],
                ["AuditLog", "Jejak aksi (search, chat, admin, settings)"],
                ["AppSetting", "Misalnya auto-scan on/off"],
            ],
            S,
            col_widths=[5.5 * cm, 11.5 * cm],
        )
    )
    story.append(Spacer(1, 0.25 * cm))
    story.append(Paragraph("SyncFile Status Machine", S["h2"]))
    story.append(
        StatusPipeline(
            [
                ("DISCOVERED\nterdeteksi", colors.HexColor("#64748B")),
                ("DOWNLOADING\nunduh", SKY),
                ("QUEUED\nantre", colors.HexColor("#0369A1")),
                ("OCR_PENDING\nOCR", AMBER),
                ("OCR_DONE\nsiap", TEAL),
                ("FAILED\ngagal", colors.HexColor("#B91C1C")),
            ]
        )
    )
    story.append(Paragraph("Gambar 4. Status pipeline SyncFile (SKIPPED = duplikat/sudah ada)", S["caption"]))
    story.append(
        Paragraph(
            "Status <b>SKIPPED</b> dipakai bila file dianggap duplikat (misalnya checksum sudah ada) sehingga "
            "tidak perlu OCR ulang, tetapi tetap bisa ditandai siap di portal.",
            S["body"],
        )
    )
    story.append(PageBreak())

    # ===== 8 Pipeline =====
    story += section_title("8. Sync &amp; OCR Pipeline", "Pipeline sync &amp; OCR", S)
    story.append(
        Paragraph(
            "Alur lengkap dari aksi user di Library sampai dokumen siap di Search/Ask AI:",
            S["body"],
        )
    )
    story.append(
        FlowChart(
            [
                ("User pilih\nPDF / folder", "Library"),
                ("Buat\nScanJob", "Redis/BullMQ"),
                ("Worker unduh\nWebDAV", "per-user creds"),
                ("Drop ke\nconsume", "Paperless"),
                ("OCR &\nreconcile", "ID dokumen"),
                ("Chunk +\nembedding", "Ask/Search"),
            ],
            box_h=1.7 * cm,
        )
    )
    story.append(Paragraph("Gambar 5. End-to-end ingest pipeline", S["caption"]))

    story.append(Paragraph("Detailed Steps", S["h2"]))
    story.append(
        bullets(
            [
                "<b>Trigger</b>: user memilih file, scan folder, newest batch, retry gagal, atau auto-scan favorit.",
                "<b>Job queue</b>: permintaan masuk antrean agar tidak memblokir UI.",
                "<b>Download</b>: worker memakai kredensial Bappenas milik user (terenkripsi di DB).",
                "<b>Guard 0 byte</b>: file kosong tidak dikirim OCR (menghindari hang / hasil sia-sia).",
                "<b>Consume</b>: file dipindah ke folder yang dipantau Paperless.",
                "<b>OCR_PENDING → OCR_DONE</b>: worker mem-poll/reconcile sampai dapat document id.",
                "<b>Embedding</b>: teks OCR dipecah jadi chunk, di-embed, disimpan untuk retrieval.",
            ],
            S,
        )
    )
    story.append(
        FlowChart(
            [
                ("Library UI", "pilih & status"),
                ("API ingest\n/scan", "auth + validasi"),
                ("sync-worker", "download + drop"),
                ("Paperless", "OCR engine"),
                ("Postgres", "SyncFile +\nchunks"),
            ],
            vertical=True,
            fill=TEAL,
        )
    )
    story.append(Paragraph("Gambar 6. Alur vertikal komponen saat ingest", S["caption"]))
    story.append(PageBreak())

    # ===== 9 RAG =====
    story += section_title("9. Search &amp; Ask AI (RAG)", "Pencarian hybrid &amp; tanya AI", S)
    story.append(
        Paragraph(
            "RAG (<b>Retrieval-Augmented Generation</b>) berarti: sebelum AI menjawab, sistem mencari "
            "potongan dokumen relevan milik user, lalu memberi potongan itu sebagai konteks ke model bahasa.",
            S["body"],
        )
    )
    story.append(Paragraph("Ask AI Flow", S["h2"]))
    story.append(
        FlowChart(
            [
                ("Pertanyaan\nuser", "chat UI"),
                ("Retrieval", "keyword +\nvector"),
                ("Context\npack", "snippet"),
                ("LLM\nanswer", "OpenAI"),
                ("Citations", "sumber dokumen"),
            ],
            fill=AMBER,
        )
    )
    story.append(Paragraph("Gambar 7. Alur Ask AI (RAG)", S["caption"]))
    story.append(
        Paragraph(
            "Search memakai pendekatan hybrid: pencocokan teks + kemiripan embedding. "
            "Hasil bisa dilengkapi ringkasan. Scope chat bisa “semua dokumen user”, dokumen tertentu, atau prefix folder.",
            S["body"],
        )
    )
    story.append(PageBreak())

    # ===== 10 Features =====
    story += section_title("10. Portal Features", "Fitur portal", S)
    story.append(Paragraph("For End Users", S["h2"]))
    story.append(
        simple_table(
            ["Modul", "Fungsi"],
            [
                ["Ask AI", "Chat berbasis dokumen OCR + kutipan sumber"],
                ["Search", "Cari isi dokumen, load more, ringkasan, feed terbaru"],
                ["Library", "Browse WebDAV, favorit, batch OCR, antrean gagal/retry"],
                ["Recent scans", "Daftar dokumen siap OCR (halaman terpisah)"],
                ["Preview", "Panel PDF bisa di-resize"],
                ["Profil", "Update nama &amp; kredensial cloud"],
            ],
            S,
            col_widths=[4 * cm, 13 * cm],
        )
    )
    story.append(Spacer(1, 0.25 * cm))
    story.append(Paragraph("For Admins", S["h2"]))
    story.append(
        simple_table(
            ["Modul", "Fungsi"],
            [
                ["Audit logs", "Aktivitas + estimasi biaya/hit OpenAI + filter waktu"],
                ["User management", "Create/update user via dialog, role, cloud creds"],
                ["Auto scan", "Nyalakan/matikan scan terjadwal folder favorit"],
            ],
            S,
            col_widths=[4 * cm, 13 * cm],
        )
    )
    story.append(Spacer(1, 0.2 * cm))
    story.append(Paragraph("Library Mental Model", S["h2"]))
    story.append(
        FlowChart(
            [
                ("Tree &\nbreadcrumb", "navigasi"),
                ("File list +\nsize/status", "kejelasan"),
                ("Fetch &\nOCR", "aksi"),
                ("Queue &\nretry", "operasi"),
                ("Preview /\nAsk AI", "manfaat"),
            ]
        )
    )
    story.append(Paragraph("Gambar 8. Pola penggunaan Library", S["caption"]))
    story.append(PageBreak())

    # ===== 11 Security =====
    story += section_title("11. Security Model", "Model keamanan", S)
    story.append(
        bullets(
            [
                "<b>Authentication</b>: login session via NextAuth.",
                "<b>Authorization</b>: role USER vs ADMIN (halaman/API admin dilindungi).",
                "<b>Per-user data isolation</b>: SyncFile, chunk, chat terikat userId.",
                "<b>Encrypted cloud credentials</b>: username/password Bappenas dienkripsi dengan ENCRYPTION_KEY.",
                "<b>Network posture</b>: database, Redis, Paperless idealnya hanya di jaringan internal / localhost; portal yang dipublikasikan.",
                "<b>Audit trail</b>: aksi penting dicatat untuk tinjauan admin.",
                "<b>Rate limiting</b>: endpoint sensitif (mis. browse/search) dibatasi agar tidak mudah di-spam.",
            ],
            S,
        )
    )
    story.append(
        callout(
            "Operational warning",
            "Jangan mengganti ENCRYPTION_KEY setelah kredensial tersimpan: data lama tidak bisa didekripsi dengan key baru.",
            S,
        )
    )
    story.append(PageBreak())

    # ===== 12 Infra =====
    story += section_title("12. Infrastructure Blueprint", "Cetak biru infrastruktur", S)
    story.append(
        Paragraph(
            "Rekomendasi praktis untuk menjalankan seluruh stack dalam <b>satu server aplikasi</b>:",
            S["body"],
        )
    )
    story.append(
        simple_table(
            ["Resource", "Rekomendasi", "Alasan"],
            [
                ["RAM", "<b>8 GB</b>", "Portal + worker + OCR + DB dalam satu mesin"],
                ["CPU", "4 vCPU", "OCR dan build/antrean butuh headroom"],
                ["Disk", "100 GB+ SSD", "Media dokumen &amp; indeks tumbuh"],
                ["OS", "Linux + Docker Compose", "Selaras dengan paket layanan"],
                ["Akses", "HTTPS ke portal", "Login &amp; data organisasi"],
            ],
            S,
            col_widths=[3.5 * cm, 4.5 * cm, 9 * cm],
        )
    )
    story.append(Spacer(1, 0.25 * cm))
    story.append(
        Paragraph(
            "Di dalam server, layanan dipisah container: Postgres, Redis, Paperless, sync-worker, dan app. "
            "Batasi memori per container agar OCR tidak menghabiskan seluruh RAM. "
            "Disarankan ada swap sebagai jaring pengaman, tetapi RAM 8 GB tetap target utama.",
            S["body"],
        )
    )
    story.append(Paragraph("Logical Deployment", S["h2"]))
    story.append(
        FlowChart(
            [
                ("Users\n(Browser)", "HTTPS"),
                ("DocSearch\nPortal", "app"),
                ("Workers &\nOCR", "sync +\npaperless"),
                ("Data\nservices", "Postgres\n+ Redis"),
            ],
            fill=TEAL_DEEP,
        )
    )
    story.append(Paragraph("Gambar 9. Deployment logis (tanpa detail host spesifik)", S["caption"]))
    story.append(PageBreak())

    # ===== 13 Glossary =====
    story += section_title("13. Glossary", "Glosarium istilah", S)
    story.append(
        simple_table(
            ["Term", "Arti sederhana"],
            [
                ["OCR", "Optical Character Recognition: mengubah gambar/PDF jadi teks"],
                ["WebDAV", "Protokol akses file lewat HTTP; dipakai banyak cloud"],
                ["RAG", "AI menjawab dengan dibantu cuplikan dokumen yang diambil dulu"],
                ["Embedding", "Representasi angka dari teks agar bisa diukur kemiripannya"],
                ["BullMQ", "Library antre pekerjaan di atas Redis"],
                ["Consume folder", "Folder yang dipantau Paperless untuk file baru"],
                ["SyncFile", "Catatan satu file cloud di database DocSearch"],
                ["Paperless-ngx", "Sistem DMS/OCR open-source yang dipakai sebagai mesin OCR"],
            ],
            S,
            col_widths=[4 * cm, 13 * cm],
        )
    )
    story.append(Spacer(1, 0.6 * cm))
    story.append(Paragraph("Closing Note", S["h2"]))
    story.append(
        Paragraph(
            "DocSearch memadukan tiga kekuatan: <b>cloud organisasi sebagai sumber file</b>, "
            "<b>Paperless-ngx sebagai mesin OCR yang sudah teruji</b>, dan <b>portal modern untuk search + AI</b>. "
            "Dokumentasi ini sengaja menjelaskan “apa” dan “mengapa” agar mudah dipahami non-teknis maupun teknis, "
            "tanpa mengunci ke satu nama server atau konfigurasi rahasia lingkungan.",
            S["body"],
        )
    )

    doc = SimpleDocTemplate(
        str(PDF_PATH),
        pagesize=A4,
        leftMargin=2 * cm,
        rightMargin=2 * cm,
        topMargin=2 * cm,
        bottomMargin=1.8 * cm,
        title="DocSearch — Application Documentation",
        author="DocSearch",
    )
    doc.build(story, onFirstPage=on_page, onLaterPages=on_page)
    print(f"Created: {PDF_PATH}")
    print(f"Pages built (approx by content).")


if __name__ == "__main__":
    build()
