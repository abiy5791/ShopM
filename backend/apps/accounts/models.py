import uuid

from django.contrib.auth.models import AbstractBaseUser, PermissionsMixin
from django.db import models

from apps.common.models import BaseModel

from .managers import UserManager


class Role(BaseModel):
    class Name(models.TextChoices):
        OWNER = "owner", "Owner"
        CASHIER = "cashier", "Cashier"

    name = models.CharField(max_length=32, unique=True, choices=Name.choices)
    # Coded permission strings (e.g. "sales.create"); RBAC is also enforced in code.
    permissions = models.JSONField(default=list, blank=True)

    class Meta:
        ordering = ["name"]

    def __str__(self) -> str:
        return self.get_name_display()


class User(AbstractBaseUser, PermissionsMixin):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    email = models.EmailField(unique=True)
    full_name = models.CharField(max_length=255)
    is_active = models.BooleanField(default=True)
    is_staff = models.BooleanField(default=False)
    last_login_ip = models.GenericIPAddressField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    objects = UserManager()

    USERNAME_FIELD = "email"
    EMAIL_FIELD = "email"
    REQUIRED_FIELDS = ["full_name"]

    class Meta:
        ordering = ["email"]

    def __str__(self) -> str:
        return self.email
