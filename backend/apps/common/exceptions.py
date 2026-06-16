"""Consistent error envelope (plan §9): {detail, code, fields}."""

from rest_framework.exceptions import APIException
from rest_framework.views import exception_handler as drf_exception_handler


class ShopHeaderRequired(APIException):
    status_code = 400
    default_detail = "The X-Shop-Id header is required for this endpoint."
    default_code = "shop_required"


def envelope_exception_handler(exc, context):
    response = drf_exception_handler(exc, context)
    if response is None:
        return None

    data = response.data
    fields: dict = {}
    code = getattr(exc, "default_code", None) or "error"
    detail = "An error occurred."

    if isinstance(data, dict):
        if set(data.keys()) == {"detail"}:
            raw = data["detail"]
            detail = str(raw)
            code = getattr(raw, "code", None) or code
        else:
            # Field-level validation errors.
            fields = data
            detail = "Validation failed."
            code = "validation_error"
    elif isinstance(data, list):
        detail = "; ".join(str(item) for item in data)

    response.data = {"detail": detail, "code": code, "fields": fields}
    return response
