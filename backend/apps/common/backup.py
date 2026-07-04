"""Database backup/restore (plan §11 Phase 7, §14).

Supports the two configured engines: sqlite (dev — a file copy) and PostgreSQL
(prod — pg_dump custom format). See the runbook in README for the full restore
drill; ``restore_sqlite`` here covers the dev path used by tests.
"""

import os
import shutil
import subprocess

from django.conf import settings
from django.utils import timezone


def _db():
    return settings.DATABASES["default"]


def create_backup(dest_dir: str | None = None) -> str:
    """Produce a backup file and return its path."""
    dest = dest_dir or settings.BACKUP_DIR
    os.makedirs(dest, exist_ok=True)
    stamp = timezone.now().strftime("%Y%m%d-%H%M%S")
    db = _db()
    engine = db["ENGINE"]

    if "sqlite" in engine:
        source = str(db["NAME"])
        path = os.path.join(dest, f"backup-{stamp}.sqlite3")
        shutil.copyfile(source, path)
        return path

    if "postgresql" in engine:
        path = os.path.join(dest, f"backup-{stamp}.dump")
        env = {**os.environ, "PGPASSWORD": db.get("PASSWORD", "")}
        subprocess.run(
            [
                "pg_dump",
                "-Fc",
                "-h",
                db.get("HOST", "localhost"),
                "-p",
                str(db.get("PORT", "5432")),
                "-U",
                db["USER"],
                "-d",
                db["NAME"],
                "-f",
                path,
            ],
            check=True,
            env=env,
        )
        return path

    raise RuntimeError(f"Unsupported DB engine for backup: {engine}")


def restore_sqlite(backup_path: str) -> None:
    """Restore a sqlite backup over the configured database (dev path)."""
    db = _db()
    if "sqlite" not in db["ENGINE"]:
        raise RuntimeError("restore_sqlite only supports the sqlite engine.")
    shutil.copyfile(backup_path, str(db["NAME"]))
