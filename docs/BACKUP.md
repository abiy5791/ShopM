# Backup & restore runbook

ShopM backs up the database on a nightly schedule (Celery beat: `nightly-backup`
at 03:00) and on demand. Backups land in `BACKUP_DIR` (default `backend/backups/`,
git-ignored). In production point `BACKUP_DIR` at mounted/object storage.

## Produce a backup

```bash
# Admin-triggered manual backup
make shell   # or:
docker compose exec backend python manage.py backup_db          # → backups/backup-<ts>.{sqlite3,dump}
docker compose exec backend python manage.py backup_db --dest /mnt/backups
```

The command auto-detects the engine:

- **sqlite (dev):** a file copy → `backup-<ts>.sqlite3`
- **PostgreSQL (prod):** `pg_dump -Fc` → `backup-<ts>.dump` (custom format)

## Restore into a clean database

### PostgreSQL (prod)

```bash
# 1. Create an empty target database
createdb -h "$POSTGRES_HOST" -U "$POSTGRES_USER" shopm_restore

# 2. Restore the custom-format dump
pg_restore -h "$POSTGRES_HOST" -U "$POSTGRES_USER" -d shopm_restore --clean --if-exists backup-<ts>.dump

# 3. Point the app at the restored DB (POSTGRES_DB=shopm_restore) and run migrations
python manage.py migrate --check    # should report no pending migrations
```

### sqlite (dev)

Stop the app, then replace the DB file:

```bash
cp backend/backups/backup-<ts>.sqlite3 backend/db.sqlite3
```

(Programmatically: `apps.common.backup.restore_sqlite(path)`.)

## Verify a restore

After restoring, smoke-test:

```bash
python manage.py migrate --check
python manage.py shell -c "from apps.sales.models import Sale; print(Sale.objects.count())"
```

A restore drill is exercised once in the test suite
(`tests/test_phase7.py::test_backup_and_restore_roundtrip`) and should be repeated
against a real Postgres dump before each production release (Phase 8 §15).
