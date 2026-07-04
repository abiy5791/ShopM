from django.core.management.base import BaseCommand

from apps.common.backup import create_backup


class Command(BaseCommand):
    help = "Create a database backup (admin-triggered manual backup, plan §11 Phase 7)."

    def add_arguments(self, parser):
        parser.add_argument("--dest", default=None, help="Destination directory.")

    def handle(self, *args, **options):
        path = create_backup(options.get("dest"))
        self.stdout.write(self.style.SUCCESS(f"Backup written to {path}"))
