"""Catalog services — SKU generation and related helpers."""

from __future__ import annotations

import re

from .models import Product


def generate_sku(shop, category=None) -> str:
    """A unique, human-readable SKU for a new product in ``shop``.

    Format ``PREFIX-NNN`` (e.g. ``MEN-005``): the prefix is the first three
    letters of the category name (``GEN`` when uncategorised), and the number is
    the next free sequence for that prefix in the shop. This mirrors the codes the
    shop already uses and stays unique among live products.
    """
    letters = re.sub(r"[^A-Za-z]", "", category.name).upper() if category else ""
    prefix = letters[:3] or "GEN"

    pattern = re.compile(rf"^{re.escape(prefix)}-(\d+)$")
    max_n = 0
    for sku in Product.objects.filter(shop=shop, sku__startswith=f"{prefix}-").values_list(
        "sku", flat=True
    ):
        match = pattern.match(sku)
        if match:
            max_n = max(max_n, int(match.group(1)))

    n = max_n + 1
    candidate = f"{prefix}-{n:03d}"
    # Defend against any stray collision (e.g. a manually-typed code).
    while Product.objects.filter(shop=shop, sku=candidate).exists():
        n += 1
        candidate = f"{prefix}-{n:03d}"
    return candidate
