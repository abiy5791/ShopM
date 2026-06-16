"""Tenancy middleware (plan §3.1, §8).

JWT authentication runs in the DRF view layer, not in Django middleware, so this
middleware only *extracts* the active-shop header onto the request. The actual
membership validation (and the deliberate 404-not-403 on cross-shop access)
happens in apps.common.mixins.ShopScopedViewSetMixin, which has request.user.
"""


class ActiveShopMiddleware:
    HEADER = "X-Shop-Id"

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        request.active_shop_id = request.headers.get(self.HEADER) or None
        return self.get_response(request)
