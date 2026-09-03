#!/usr/bin/env python3
"""Build the fixed-layout PDF edition of the ContextShield judging audit."""

from __future__ import annotations

import html
import re
from io import BytesIO
from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT, TA_RIGHT
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import inch
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfgen import canvas as pdf_canvas
from reportlab.platypus import (
    BaseDocTemplate,
    Frame,
    KeepTogether,
    ListFlowable,
    ListItem,
    PageBreak,
    PageTemplate,
    Paragraph,
    Spacer,
    Table,
    TableStyle,
)
from pypdf import PdfReader, PdfWriter
from pypdf._page import PageObject
from pypdf.generic import NameObject


ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / "docs/research/report-source.md"
OUTPUT = ROOT / "output/pdf/ContextShield-Judging-Readiness-Audit-2026-09-03.pdf"

NAVY = colors.HexColor("#183653")
BLUE = colors.HexColor("#2E73B8")
TEAL = colors.HexColor("#087F5B")
INK = colors.HexColor("#24313D")
MUTED = colors.HexColor("#5F6F7C")
LINE = colors.HexColor("#C9D4DE")
PALE = colors.HexColor("#EEF3F7")
PALE_TEAL = colors.HexColor("#E7F4EF")
PALE_AMBER = colors.HexColor("#FFF3D6")


def install_fonts() -> tuple[str, str, str]:
    candidates = [
        Path("/System/Library/Fonts/Supplemental/Arial.ttf"),
        Path("/Library/Fonts/Arial.ttf"),
    ]
    regular = next((p for p in candidates if p.exists()), None)
    bold_candidates = [
        Path("/System/Library/Fonts/Supplemental/Arial Bold.ttf"),
        Path("/Library/Fonts/Arial Bold.ttf"),
    ]
    italic_candidates = [
        Path("/System/Library/Fonts/Supplemental/Arial Italic.ttf"),
        Path("/Library/Fonts/Arial Italic.ttf"),
    ]
    bold = next((p for p in bold_candidates if p.exists()), None)
    italic = next((p for p in italic_candidates if p.exists()), None)
    if regular and bold and italic:
        pdfmetrics.registerFont(TTFont("AuditSans", str(regular)))
        pdfmetrics.registerFont(TTFont("AuditSans-Bold", str(bold)))
        pdfmetrics.registerFont(TTFont("AuditSans-Italic", str(italic)))
        pdfmetrics.registerFontFamily(
            "AuditSans", normal="AuditSans", bold="AuditSans-Bold", italic="AuditSans-Italic"
        )
        return "AuditSans", "AuditSans-Bold", "AuditSans-Italic"
    return "Helvetica", "Helvetica-Bold", "Helvetica-Oblique"


FONT, FONT_BOLD, FONT_ITALIC = install_fonts()


def ascii_dashes(value: str) -> str:
    return (
        value.replace("\u2013", " - ")
        .replace("\u2014", " - ")
        .replace("\u2011", "-")
        .replace("\u2212", "-")
    )


INLINE = re.compile(r"(\*\*.+?\*\*|`.+?`|\[[^\]]+\]\(https?://[^)]+\))")


def inline_markup(text: str) -> str:
    text = ascii_dashes(text.strip())
    output: list[str] = []
    cursor = 0
    for match in INLINE.finditer(text):
        output.append(html.escape(text[cursor : match.start()]))
        token = match.group(0)
        if token.startswith("**"):
            output.append(f"<b>{html.escape(token[2:-2])}</b>")
        elif token.startswith("`"):
            output.append(f'<font name="Courier" backColor="#EEF3F7">{html.escape(token[1:-1])}</font>')
        else:
            label, url = re.match(r"\[([^\]]+)\]\((https?://[^)]+)\)", token).groups()
            output.append(f'<link href="{html.escape(url, quote=True)}" color="#2E73B8"><u>{html.escape(label)}</u></link>')
        cursor = match.end()
    output.append(html.escape(text[cursor:]))
    return "".join(output)


def styles():
    base = getSampleStyleSheet()
    return {
        "body": ParagraphStyle(
            "Body", parent=base["BodyText"], fontName=FONT, fontSize=9.6, leading=13.2,
            textColor=INK, spaceAfter=6, splitLongWords=False,
        ),
        "h1": ParagraphStyle(
            "H1", parent=base["Heading1"], fontName=FONT_BOLD, fontSize=17, leading=20,
            textColor=BLUE, spaceBefore=10, spaceAfter=8, keepWithNext=True,
        ),
        "h2": ParagraphStyle(
            "H2", parent=base["Heading2"], fontName=FONT_BOLD, fontSize=12.5, leading=15.5,
            textColor=BLUE, spaceBefore=8, spaceAfter=5, keepWithNext=True,
        ),
        "h1_page": ParagraphStyle(
            "H1Page", parent=base["Heading1"], fontName=FONT_BOLD, fontSize=17, leading=20,
            textColor=BLUE, spaceBefore=10, spaceAfter=8, keepWithNext=True, pageBreakBefore=True,
        ),
        "status": ParagraphStyle(
            "Status", parent=base["BodyText"], fontName=FONT_BOLD, fontSize=9.5, leading=13,
            textColor=TEAL, leftIndent=10, borderColor=TEAL, borderWidth=0,
            borderPadding=(0, 0, 0, 8), spaceBefore=4, spaceAfter=7,
        ),
        "small": ParagraphStyle(
            "Small", parent=base["BodyText"], fontName=FONT, fontSize=7.4, leading=9.5,
            textColor=INK,
        ),
        "cover_label": ParagraphStyle(
            "CoverLabel", parent=base["BodyText"], fontName=FONT_BOLD, fontSize=10,
            leading=12, textColor=TEAL, spaceAfter=12,
        ),
        "cover_title": ParagraphStyle(
            "CoverTitle", parent=base["Title"], fontName=FONT_BOLD, fontSize=34, leading=39,
            textColor=NAVY, alignment=TA_LEFT, spaceAfter=14,
        ),
        "cover_sub": ParagraphStyle(
            "CoverSub", parent=base["BodyText"], fontName=FONT_ITALIC, fontSize=15,
            leading=20, textColor=MUTED, spaceAfter=18,
        ),
    }


ST = styles()


def draw_furniture(canvas, page_number: int) -> None:
    canvas.saveState()
    width, height = letter
    canvas.setStrokeColor(LINE)
    canvas.setLineWidth(0.6)
    canvas.line(0.72 * inch, height - 1.08 * inch, width - 0.72 * inch, height - 1.08 * inch)
    canvas.setFont(FONT_BOLD, 7.6)
    canvas.setFillColor(NAVY)
    canvas.drawString(0.72 * inch, height - 1.02 * inch, "CONTEXTSHIELD  |  SIH 2026")
    canvas.setFont(FONT, 7.6)
    canvas.setFillColor(MUTED)
    canvas.drawCentredString(width / 2, height - 1.02 * inch, "JUDGING-READINESS AUDIT")
    canvas.drawString(0.72 * inch, 0.96 * inch, "Evidence audit | 3 September 2026")
    canvas.drawRightString(width - 0.72 * inch, 0.96 * inch, f"Page {page_number}")
    canvas.restoreState()


class AuditDoc(BaseDocTemplate):
    def __init__(self, filename: str):
        super().__init__(
            filename,
            pagesize=letter,
            leftMargin=0.72 * inch,
            rightMargin=0.72 * inch,
            topMargin=1.0 * inch,
            bottomMargin=0.9 * inch,
            title="ContextShield judging-readiness audit",
            author="ContextShield team",
            subject="SIH 2026 rubric assessment and evidence audit",
        )
        frame = Frame(self.leftMargin, self.bottomMargin, self.width, self.height, id="main")
        self.addPageTemplates(PageTemplate(id="audit", frames=[frame]))


def add_page_furniture(source: Path, destination: Path) -> None:
    """Merge headers and footers on top after layout to avoid inherited clips."""
    reader = PdfReader(str(source))
    writer = PdfWriter()
    for page_number, page in enumerate(reader.pages, 1):
        buffer = BytesIO()
        overlay_canvas = pdf_canvas.Canvas(buffer, pagesize=letter)
        draw_furniture(overlay_canvas, page_number)
        overlay_canvas.save()
        buffer.seek(0)
        overlay = PdfReader(buffer).pages[0]
        composed = PageObject.create_blank_page(
            width=float(page.mediabox.width), height=float(page.mediabox.height)
        )
        # ReportLab emits alternating continuation-page graphics states. Place
        # furniture beneath odd-page content and above even-page content so the
        # final merged stream stays visible without disturbing selectable text.
        if page_number % 2:
            composed.merge_page(overlay, over=True)
            composed.merge_page(page, over=True)
        else:
            composed.merge_page(page, over=True)
            composed.merge_page(overlay, over=True)
        if "/Annots" in page:
            composed[NameObject("/Annots")] = page["/Annots"]
        writer.add_page(composed)
    with destination.open("wb") as stream:
        writer.write(stream)


def cover_story() -> list:
    story = [Spacer(1, 0.34 * inch)]
    story.append(Paragraph("INTERNAL DECISION BRIEF  |  EVIDENCE-LED  |  JUDGE-SAFE", ST["cover_label"]))
    story.append(Paragraph("ContextShield<br/>judging-readiness audit", ST["cover_title"]))
    story.append(Paragraph(
        "Where the SIH 2026 solution stands today - what is proved, what is controlled, and what will move the score.",
        ST["cover_sub"],
    ))
    meta = [
        [Paragraph("<b>Assessment date</b>", ST["body"]), Paragraph("3 September 2026", ST["body"])],
        [Paragraph("<b>Problem statement</b>", ST["body"]), Paragraph("SIH26171 - On-device Visual Perception for Light-weight Browser Agents", ST["body"])],
        [Paragraph("<b>Evidence base</b>", ST["body"]), Paragraph("Repository inspection, fresh tests, primary research, and first-party guidance", ST["body"])],
    ]
    table = Table(meta, colWidths=[1.4 * inch, 5.1 * inch])
    table.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 0),
        ("RIGHTPADDING", (0, 0), (-1, -1), 4),
        ("TOPPADDING", (0, 0), (-1, -1), 2),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 2),
    ]))
    story.extend([table, Spacer(1, 12)])
    score = Table([
        [Paragraph('<font color="#FFFFFF"><b>71/100</b></font>', ParagraphStyle("Score", fontName=FONT_BOLD, fontSize=22, leading=26)),
         Paragraph('<font color="#087F5B"><b>Competition-worthy core</b></font>', ST["body"]),
         Paragraph('<font color="#A45A00"><b>Not yet independently validated or deployment-ready</b></font>', ST["body"])],
    ], colWidths=[1.2 * inch, 2.4 * inch, 2.9 * inch])
    score.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (0, 0), NAVY),
        ("BACKGROUND", (1, 0), (1, 0), PALE_TEAL),
        ("BACKGROUND", (2, 0), (2, 0), PALE_AMBER),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("LEFTPADDING", (0, 0), (-1, -1), 10),
        ("RIGHTPADDING", (0, 0), (-1, -1), 8),
        ("TOPPADDING", (0, 0), (-1, -1), 10),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 10),
    ]))
    story.extend([
        score, Spacer(1, 12),
        Paragraph("<b>Bottom line</b>", ST["h2"]),
        Paragraph("The architecture is the strongest part. The largest score risk is the gap between controlled 100% regression results and independent, pixel-level, real-world evidence.", ST["body"]),
        Paragraph('<font color="#087F5B"><b>Recommended positioning</b></font>', ST["body"]),
        Paragraph('<font color="#087F5B"><i>"A working privacy-boundary architecture with controlled proof and a clear path to independent validation."</i></font>', ST["cover_sub"]),
    ])
    return story


def parse_table(lines: list[str], table_number: int):
    rows = []
    for line in lines:
        cells = [x.strip() for x in line.strip().strip("|").split("|")]
        if all(set(c) <= {"-", ":"} for c in cells):
            continue
        rows.append([Paragraph(inline_markup(c), ST["small"]) for c in cells])
    if not rows:
        return Spacer(1, 1)
    if len(rows[0]) == 3:
        widths = [1.85 * inch, 0.78 * inch, 3.87 * inch]
    else:
        widths = [1.32 * inch, 1.38 * inch, 1.67 * inch, 2.13 * inch]
    table = Table(rows, colWidths=widths, repeatRows=1, hAlign="LEFT")
    commands = [
        ("BACKGROUND", (0, 0), (-1, 0), NAVY),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("FONTNAME", (0, 0), (-1, 0), FONT_BOLD),
        ("GRID", (0, 0), (-1, -1), 0.5, LINE),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 7),
        ("RIGHTPADDING", (0, 0), (-1, -1), 7),
        ("TOPPADDING", (0, 0), (-1, -1), 6),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
    ]
    for row in range(1, len(rows)):
        if row % 2 == 0:
            commands.append(("BACKGROUND", (0, row), (-1, row), PALE))
    if table_number == 1:
        commands.extend([
            ("BACKGROUND", (0, len(rows) - 1), (-1, len(rows) - 1), colors.HexColor("#E0ECF5")),
            ("FONTNAME", (0, len(rows) - 1), (-1, len(rows) - 1), FONT_BOLD),
        ])
    table.setStyle(TableStyle(commands))
    return table


def add_list(story: list, items: list[str], ordered: bool) -> None:
    if not items:
        return
    item_style = ParagraphStyle(
        "OrderedItem" if ordered else "BulletItem",
        parent=ST["body"],
        leftIndent=16,
        firstLineIndent=-12,
        spaceAfter=4,
    )
    for item in items:
        story.append(Paragraph(inline_markup(item), item_style))


def report_story(text: str) -> list:
    lines = text.splitlines()
    story: list = []
    paragraph: list[str] = []
    list_items: list[str] = []
    list_ordered: bool | None = None
    table_number = 0
    page_break_headings = {"Executive answer", "Headline scorecard", "Rubric-by-rubric assessment", "Priority plan before judging", "Claim-to-source ledger"}

    def flush_paragraph() -> None:
        nonlocal paragraph
        if paragraph:
            merged = " ".join(x.strip().rstrip("  ") for x in paragraph)
            if merged.startswith("**Judge-safe status:**"):
                story.append(Paragraph(inline_markup(merged.replace("**Judge-safe status:**", "**Judge-safe status -**")), ST["status"]))
            else:
                story.append(Paragraph(inline_markup(merged), ST["body"]))
            paragraph = []

    def flush_list() -> None:
        nonlocal list_items, list_ordered
        if list_items:
            add_list(story, list_items, bool(list_ordered))
            list_items = []
            list_ordered = None

    i = 0
    while i < len(lines):
        line = lines[i].rstrip()
        if not line:
            flush_paragraph(); flush_list(); i += 1; continue
        if line.startswith("# ") or line.startswith("**Audience:") or line.startswith("**Assessment date:") or line.startswith("**Problem:") or line.startswith("**Decision:"):
            i += 1; continue
        if line.startswith("|"):
            flush_paragraph(); flush_list()
            table_lines = []
            while i < len(lines) and lines[i].rstrip().startswith("|"):
                table_lines.append(lines[i].rstrip()); i += 1
            table_number += 1
            story.append(parse_table(table_lines, table_number)); story.append(Spacer(1, 7)); continue
        heading = re.match(r"^(#{2,3})\s+(.+)$", line)
        if heading:
            flush_paragraph(); flush_list()
            level, title = heading.groups()
            heading_style = ST["h2"] if level == "###" else ST["h1_page" if title in page_break_headings else "h1"]
            story.append(Paragraph(inline_markup(title), heading_style))
            i += 1; continue
        numbered = re.match(r"^(\d+)\.\s+(.+)$", line)
        bullet = re.match(r"^-\s+(.+)$", line)
        if numbered or bullet:
            flush_paragraph()
            ordered = bool(numbered)
            if list_ordered is not None and list_ordered != ordered:
                flush_list()
            list_ordered = ordered
            if numbered:
                list_items.append(f"{numbered.group(1)}. {numbered.group(2)}")
            else:
                list_items.append(f"- {bullet.group(1)}")
            i += 1; continue
        paragraph.append(line)
        i += 1
    flush_paragraph(); flush_list()
    return story


def build() -> None:
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    text = SOURCE.read_text(encoding="utf-8")
    story = cover_story() + report_story(text)
    story.extend([
        Spacer(1, 8),
        Paragraph("Internal analytical estimate. This is not an official SIH score, legal opinion, or independent certification.",
                  ParagraphStyle("Disclaimer", parent=ST["small"], fontName=FONT_ITALIC, textColor=MUTED)),
    ])
    raw_output = OUTPUT.with_name(OUTPUT.stem + ".raw.pdf")
    AuditDoc(str(raw_output)).build(story)
    add_page_furniture(raw_output, OUTPUT)
    raw_output.unlink()
    print(OUTPUT)


if __name__ == "__main__":
    build()
