"""RBAC permission classes (plan §8). The backend is the real gate — the UI only
hides what a user can't do.

Roles are enforced *within the active shop*. A viewset declares either:
  - ``required_roles``: roles allowed for every action, or
  - ``action_roles``:   {action: [roles]} for per-action control.

Membership itself is enforced by ShopScopedViewSetMixin (404 if not a member);
this class only adds the role restriction on top.
"""

from rest_framework.permissions import BasePermission

# Role name constants (mirror apps.accounts.models.Role.Name).
ROLE_OWNER = "owner"
ROLE_CASHIER = "cashier"


class ActiveShopRolePermission(BasePermission):
    message = "You don't have permission to perform this action in this shop."

    def has_permission(self, request, view) -> bool:
        user = request.user
        if not (user and user.is_authenticated):
            return False

        allowed = self._allowed_roles(view)
        if allowed is None:
            return True  # no role restriction; membership still enforced by the mixin

        # Accessing active_role resolves membership and raises 404 if the user
        # isn't in the active shop — exactly the behaviour we want.
        role = getattr(view, "active_role", None)
        return role in allowed if role else False

    @staticmethod
    def _allowed_roles(view):
        action_roles = getattr(view, "action_roles", None)
        action = getattr(view, "action", None)
        if action_roles and action in action_roles:
            return set(action_roles[action])
        required = getattr(view, "required_roles", None)
        return set(required) if required else None


class IsOwner(BasePermission):
    """Owner-only, for owner-wide endpoints that don't carry an active shop
    (e.g. /api/v1/owner/*). True when the user owns at least one shop."""

    message = "Owner access required."

    def has_permission(self, request, view) -> bool:
        user = request.user
        return bool(user and user.is_authenticated and user.owned_shops.exists())
