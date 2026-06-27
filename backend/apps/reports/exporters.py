"""Render a report dict (from services) to XLSX or PDF (plan §11 Phase 5)."""

import io

from openpyxl import Workbook
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

from apps.common.money import format_money


def _cell(value, index, money_cols, currency):
    if index in money_cols and isinstance(value, int):
        return format_money(value, currency)
    return str(value)


def _summary_value(item, currency):
    return format_money(item["value"], currency) if item.get("money") else str(item["value"])


def to_xlsx(report: dict) -> bytes:
    wb = Workbook()
    ws = wb.active
    ws.title = report["key"][:31]
    currency = report["currency"]
    money_cols = set(report.get("money_columns", []))

    ws.append([report["title"]])
    ws.append([])
    for item in report["summary"]:
        ws.append([item["label"], _summary_value(item, currency)])
    ws.append([])
    ws.append(report["columns"])
    for row in report["rows"]:
        ws.append([_cell(v, i, money_cols, currency) for i, v in enumerate(row)])

    buffer = io.BytesIO()
    wb.save(buffer)
    return buffer.getvalue()


def to_pdf(report: dict) -> bytes:
    buffer = io.BytesIO()
    doc = SimpleDocTemplate(buffer, pagesize=A4, title=report["title"])
    styles = getSampleStyleSheet()
    currency = report["currency"]
    money_cols = set(report.get("money_columns", []))

    elements = [Paragraph(report["title"], styles["Title"]), Spacer(1, 6 * mm)]

    summary_rows = [[item["label"], _summary_value(item, currency)] for item in report["summary"]]
    if summary_rows:
        summary = Table(summary_rows, hAlign="LEFT")
        summary.setStyle(
            TableStyle(
                [
                    ("FONTSIZE", (0, 0), (-1, -1), 9),
                    ("TEXTCOLOR", (0, 0), (0, -1), colors.grey),
                    ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
                ]
            )
        )
        elements += [summary, Spacer(1, 6 * mm)]

    table_data = [report["columns"]] + [
        [_cell(v, i, money_cols, currency) for i, v in enumerate(row)] for row in report["rows"]
    ]
    table = Table(table_data, repeatRows=1)
    table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#334155")),
                ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
                ("FONTSIZE", (0, 0), (-1, -1), 8),
                ("GRID", (0, 0), (-1, -1), 0.25, colors.HexColor("#E6E8EA")),
                ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#F8FAFC")]),
            ]
        )
    )
    elements.append(table)
    doc.build(elements)
    return buffer.getvalue()
