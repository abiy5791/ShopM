"""Split a sale's business date from its entry date.

``occurred_at`` is the day the sale HAPPENED — what every report is keyed on and
the only one an owner may set (bounded, owner-only; see apps.sales.backdating).
``created_at`` keeps its original meaning: when the row was entered, untouchable.

Existing sales were never backdated, so both are the same for them — the
backfill copies ``created_at`` across rather than leaving the field's ``now()``
default, which would have stamped the whole history with the deploy time.
``Payment.received_at`` loses ``auto_now_add`` for the same reason: a backdated
sale's money came in on the sale's day, not on the day it was typed in.
"""

import django.utils.timezone
from django.conf import settings
from django.db import migrations, models


def backfill_occurred_at(apps, schema_editor):
    Sale = apps.get_model("sales", "Sale")
    Sale.objects.update(occurred_at=models.F("created_at"))


def noop(apps, schema_editor):
    """Reverse is a no-op — the column is dropped by the AddField reversal."""


class Migration(migrations.Migration):

    dependencies = [
        ("customers", "0001_initial"),
        ("sales", "0003_alter_payment_method"),
        ("shops", "0002_alter_shopsettings_currency_and_more"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.AlterModelOptions(
            name="sale",
            options={"ordering": ["-occurred_at", "-created_at"]},
        ),
        migrations.AddField(
            model_name="sale",
            name="occurred_at",
            field=models.DateTimeField(db_index=True, default=django.utils.timezone.now),
        ),
        migrations.RunPython(backfill_occurred_at, noop),
        migrations.AlterField(
            model_name="payment",
            name="received_at",
            field=models.DateTimeField(db_index=True, default=django.utils.timezone.now),
        ),
        migrations.AddIndex(
            model_name="sale",
            index=models.Index(
                fields=["shop", "-occurred_at"], name="sales_sale_shop_id_ba6956_idx"
            ),
        ),
    ]
