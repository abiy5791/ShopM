def get_client_ip(request) -> str | None:
    """Best-effort client IP. Proper X-Forwarded-For handling is hardened in Phase 8."""
    xff = request.META.get("HTTP_X_FORWARDED_FOR")
    if xff:
        return xff.split(",")[0].strip()
    return request.META.get("REMOTE_ADDR")
