"""Phase 5 DoD assertions (plan §11 Phase 5): reports & dashboard."""

import uuid

import pytest

from apps.catalog.models import Product
from apps.expenses.models import Expense, ExpenseCategory
from apps.inventory.services import record_transaction
from apps.sales.services import create_sale

pytestmark = pytest.mark.django_db


def _seed_shop_activity(shop, owner):
    product = Product.objects.create(
        shop=shop, sku="SKU-1", name="Widget", selling_price=1000, purchase_price=600
    )
    record_transaction(product=product, quantity=50, type="adjustment")
    create_sale(
        shop=shop,
        cashier=owner,
        client_uuid=str(uuid.uuid4()),
        items=[{"product": product, "quantity": 2}],
        payments=[{"method": "cash", "amount": 2000}],
    )
    cat = ExpenseCategory.objects.create(shop=shop, name="Rent")
    from django.utils import timezone

    Expense.objects.create(
        shop=shop, category=cat, amount=500, date=timezone.now().date(), user=owner
    )
    return product


# --- DoD: dashboard numbers tie out to the underlying ledgers ---
def test_dashboard_ties_to_ledgers(make_user, make_shop, auth):
    owner = make_user("o@shopm.local")
    shop = make_shop(owner, name="S")
    _seed_shop_activity(shop, owner)
    client = auth(owner, shop=shop)

    resp = client.get("/api/v1/dashboard")
    assert resp.status_code == 200
    today = resp.data["today"]
    assert today["sales_total"] == 2000
    assert today["sales_count"] == 1
    assert today["expenses_total"] == 500
    assert today["gross_profit"] == 800  # 2000 revenue − 1200 COGS
    assert today["net_profit"] == 300  # 800 − 500 expenses
    assert resp.data["total_products"] == 1
    assert resp.data["cash_balance"] == 1500  # 2000 cash in − 500 expense


@pytest.mark.parametrize("report", ["sales", "inventory", "profit", "cashflow"])
def test_report_json(make_user, make_shop, auth, report):
    owner = make_user("o@shopm.local")
    shop = make_shop(owner, name="S")
    _seed_shop_activity(shop, owner)
    client = auth(owner, shop=shop)
    resp = client.get(f"/api/v1/reports/{report}")
    assert resp.status_code == 200
    assert "summary" in resp.data and "columns" in resp.data


# --- DoD: each report exports valid PDF and XLSX ---
@pytest.mark.parametrize("report", ["sales", "inventory", "profit", "cashflow"])
def test_report_exports_pdf_and_xlsx(make_user, make_shop, auth, report):
    owner = make_user("o@shopm.local")
    shop = make_shop(owner, name="S")
    _seed_shop_activity(shop, owner)
    client = auth(owner, shop=shop)

    pdf = client.get(f"/api/v1/reports/{report}?export=pdf")
    assert pdf.status_code == 200
    assert pdf["Content-Type"] == "application/pdf"
    assert bytes(pdf.content)[:4] == b"%PDF"

    xlsx = client.get(f"/api/v1/reports/{report}?export=xlsx")
    assert xlsx.status_code == 200
    assert bytes(xlsx.content)[:2] == b"PK"  # xlsx is a zip


# --- DoD: cashier cannot reach financial reports ---
def test_cashier_denied_reports_and_dashboard(make_user, make_shop, auth):
    owner = make_user("o@shopm.local")
    cashier = make_user("c@shopm.local")
    shop = make_shop(owner, name="S", cashier=cashier)
    client = auth(cashier, shop=shop)
    assert client.get("/api/v1/dashboard").status_code == 403
    assert client.get("/api/v1/reports/sales").status_code == 403
    assert client.get("/api/v1/reports/profit").status_code == 403
