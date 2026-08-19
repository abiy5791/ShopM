"""Backdating policy for sales — the single place the rules live.

Why this exists
---------------
A day's takings sometimes never get rung up: the shop was busy, the tablet was
flat, someone simply forgot. The next morning those sales cannot just be typed
in as new ones — they would land on the *new* day, inflating it and leaving the
missed day empty, and every report keyed on that day would be wrong for good.

So a sale carries two independent timestamps:

* ``Sale.occurred_at`` — when the sale HAPPENED. Every report, dashboard, day
  book and KPI is keyed on this. An owner may set it to an earlier day.
* ``Sale.created_at``  — when the row was ENTERED. Never settable, never
  changed. This is the audit fact; the gap between the two is the evidence that
  a sale was backdated, and by how much.

The rules below are deliberately narrow. Backdating rewrites history, so it is:

* **owner-only**   — a cashier can never move a sale off today;
* **past-only**    — a sale can never be dated into the future;
* **bounded**      — at most ``MAX_BACKDATE_DAYS`` days back, so books that have
  already been closed and reported on cannot be quietly re-opened;
* **logged**       — the caller writes a ``warn``-level activity row naming the
  day the sale was moved to (see ``apps.sales.views``).

Stock is *not* backdated: the goods leave the ledger when the correction is
entered, because that is when the system learns they are gone. The ledger row
carries a note saying which day the sale belongs to.
"""

from __future__ import annotations

from datetime import date, datetime, timedelta

from django.utils import timezone

#: How far back an owner may date a sale. Anything older is a closed period —
#: correct it with an adjustment, not by re-opening the books.
MAX_BACKDATE_DAYS = 30


class BackdateNotAllowed(Exception):
    """The requested sale date is outside what the policy permits."""


def allowed_range(today: date | None = None) -> tuple[date, date]:
    """The inclusive [earliest, latest] date a sale may be booked to."""
    today = today or timezone.localdate()
    return today - timedelta(days=MAX_BACKDATE_DAYS), today


def validate(sale_date: date, *, today: date | None = None) -> date:
    """Check ``sale_date`` against the policy; return it, or raise.

    Raises ``BackdateNotAllowed`` with a message written for the shop owner,
    not for a developer — it is surfaced verbatim in the API error.
    """
    today = today or timezone.localdate()
    earliest, latest = allowed_range(today)
    if sale_date > latest:
        raise BackdateNotAllowed("A sale cannot be dated in the future.")
    if sale_date < earliest:
        raise BackdateNotAllowed(
            f"A sale can be dated at most {MAX_BACKDATE_DAYS} days back "
            f"(not before {earliest.isoformat()})."
        )
    return sale_date


def to_datetime(sale_date: date, *, now: datetime | None = None) -> datetime:
    """Turn a chosen day into the instant the sale is booked at.

    Today keeps the real clock. A past day gets the current time-of-day applied
    to it, which lands safely inside the day and keeps several catch-up sales in
    the order they were entered.
    """
    now = now or timezone.now()
    if timezone.localdate(now) == sale_date:
        return now
    tz = timezone.get_current_timezone()
    return timezone.make_aware(datetime.combine(sale_date, timezone.localtime(now).time()), tz)
