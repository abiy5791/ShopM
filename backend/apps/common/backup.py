"""Database backup/restore (plan §11 Phase 7, §14).

Supports the two configured engines: sqlite (dev — the online backup API) and
PostgreSQL (prod — pg_dump custom format). Both take a consistent snapshot of a
running database. See the runbook in README for the full restore drill;
``restore_sqlite`` here covers the dev path used by tests.
"""

import os
import sqlite3
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
        path = os.path.join(dest, f"backup-{stamp}.sqlite3")
        # sqlite's online backup API, not a file copy: copying a live database
        # can capture a write mid-flight (or miss the WAL) and yield a backup
        # that only fails when you finally need it.
        with sqlite3.connect(str(db["NAME"])) as source, sqlite3.connect(path) as target:
            source.backup(target)
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
    # Same reasoning as create_backup, plus one more: overwriting the file alone
    # would leave a stale -wal/-shm beside it, which sqlite then replays.
    with sqlite3.connect(backup_path) as source, sqlite3.connect(str(db["NAME"])) as target:
        source.backup(target)
