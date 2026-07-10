#!/bin/sh
# Prod entrypoint: run once at container start before handing off to CMD.
set -e

echo "Applying database migrations..."
python manage.py migrate --noinput

echo "Collecting static files..."
python manage.py collectstatic --noinput

exec "$@"
