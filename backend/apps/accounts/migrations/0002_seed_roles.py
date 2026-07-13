"""Seed the two built-in roles (v2 plan §3, fixes P11).

Fresh databases previously had no Role rows until `manage.py seed` ran, so
memberships couldn't be created. Roles are part of the schema contract.
"""

from django.db import migrations


def seed_roles(apps, schema_editor):
    Role = apps.get_model("accounts", "Role")
    for name in ("owner", "cashier"):
        Role.objects.get_or_create(name=name)


def unseed_roles(apps, schema_editor):
    # Leave rows in place on reverse: memberships may reference them (PROTECT).
    pass


class Migration(migrations.Migration):
    dependencies = [
        ("accounts", "0001_initial"),
    ]

    operations = [
        migrations.RunPython(seed_roles, unseed_roles),
    ]
