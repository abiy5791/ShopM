from django.core.management.base import BaseCommand

from apps.inventory.tasks import reconcile_all_shops


class Command(BaseCommand):
    help = "Recompute cached stock from the ledger for all shops and report mismatches."

    def handle(self, *args, **options):
        results = reconcile_all_shops()
        total = sum(len(v) for v in results.values())
        if total == 0:
            self.stdout.write(self.style.SUCCESS("Reconciliation complete — 0 mismatches."))
        else:
            self.stdout.write(self.style.WARNING(f"Reconciliation fixed {total} mismatch(es)."))
            for shop_id, mismatches in results.items():
                for m in mismatches:
                    self.stdout.write(
                        f"  {shop_id} {m['sku']}: cached={m['cached']} ledger={m['ledger']}"
                    )
