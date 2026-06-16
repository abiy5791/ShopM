"""Shop-scoping for DRF viewsets (plan §3.1, §8).

Resolves the active shop from the request (header set by ActiveShopMiddleware),
validates the authenticated user's membership, and auto-filters querysets. A user
hitting a shop they don't belong to gets a 404 (NotFound) — we never reveal that
the shop exists.
"""

import uuid
from functools import cached_property

from rest_framework.exceptions import NotFound

from .exceptions import ShopHeaderRequired


class ShopScopedViewSetMixin:
    #: name of the FK field on the model that points at the shop
    shop_field = "shop"

    @cached_property
    def active_membership(self):
        from apps.shops.models import ShopMembership

        shop_id = getattr(self.request, "active_shop_id", None)
        if not shop_id:
            raise ShopHeaderRequired()
        try:
            uuid.UUID(str(shop_id))
        except (ValueError, AttributeError, TypeError):
            raise NotFound("Shop not found.") from None

        membership = (
            ShopMembership.objects.select_related("shop", "role")
            .filter(
                user=self.request.user,
                shop_id=shop_id,
                shop__deleted_at__isnull=True,
            )
            .first()
        )
        if membership is None:
            raise NotFound("Shop not found.")
        return membership

    @property
    def active_shop(self):
        return self.active_membership.shop

    @property
    def active_role(self) -> str:
        return self.active_membership.role.name

    def get_queryset(self):
        qs = super().get_queryset()
        return qs.filter(**{self.shop_field: self.active_shop})

    def perform_create(self, serializer):
        # shop_id is server-controlled — never trust a client-supplied value.
        serializer.save(**{self.shop_field: self.active_shop})
