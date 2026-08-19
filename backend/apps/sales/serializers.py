from rest_framework import serializers

from apps.catalog.models import Product
from apps.customers.models import Customer

from . import backdating
from .models import Payment, Sale, SaleAmendment, SaleItem


# ---------------------------------------------------------------- input
class SaleItemInputSerializer(serializers.Serializer):
    product = serializers.PrimaryKeyRelatedField(queryset=Product.objects.all())
    quantity = serializers.IntegerField(min_value=1)
    # Optional snapshot price (integer minor units). Defaults to the product's
    # current selling price server-side if omitted.
    unit_price = serializers.IntegerField(min_value=0, required=False)


class PaymentInputSerializer(serializers.Serializer):
    method = serializers.ChoiceField(choices=Payment.Method.choices)
    # A payment of zero is meaningless; fully-on-credit sales send no payments.
    amount = serializers.IntegerField(min_value=1)


class SaleCreateSerializer(serializers.Serializer):
    client_uuid = serializers.UUIDField()
    items = SaleItemInputSerializer(many=True)
    payments = PaymentInputSerializer(many=True)
    customer = serializers.PrimaryKeyRelatedField(
        queryset=Customer.objects.all(), required=False, allow_null=True
    )
    discount = serializers.IntegerField(min_value=0, default=0)
    tax = serializers.IntegerField(min_value=0, default=0)
    notes = serializers.CharField(required=False, allow_blank=True, default="")
    # The day the sale HAPPENED, when that isn't today — an owner recording a
    # day that was missed. Omit it and the sale is booked to now. Sending it at
    # all is owner-only; the view rejects it from a cashier before this data is
    # ever used (apps.sales.backdating).
    sale_date = serializers.DateField(required=False, allow_null=True)

    def validate_sale_date(self, sale_date):
        if sale_date is None:
            return None
        try:
            return backdating.validate(sale_date)
        except backdating.BackdateNotAllowed as exc:
            raise serializers.ValidationError(str(exc)) from exc

    def validate_items(self, items):
        if not items:
            raise serializers.ValidationError("A sale must have at least one item.")
        shop = self.context.get("active_shop")
        for item in items:
            product = item["product"]
            if shop is not None and product.shop_id != shop.id:
                raise serializers.ValidationError("Product not found in the active shop.")
            if product.status != Product.Status.ACTIVE:
                raise serializers.ValidationError(f"{product.name} is inactive and cannot be sold.")
        return items

    def validate_payments(self, payments):
        # Payments may be empty for a fully-on-credit sale (a customer is required,
        # enforced in the checkout service).
        return payments

    def validate_customer(self, customer):
        shop = self.context.get("active_shop")
        if customer is not None and shop is not None and customer.shop_id != shop.id:
            raise serializers.ValidationError("Customer not found in the active shop.")
        return customer


class SaleUpdateSerializer(serializers.Serializer):
    """Owner's correction to a mis-recorded sale (PATCH /sales/{id}).

    Every field is optional — only what is sent is changed — except ``reason``,
    which is always required: an edit to money that has already been reported on
    must say why. Sending ``items`` or ``payments`` replaces that whole list,
    since a partial edit of a money list has no unambiguous meaning.
    """

    reason = serializers.CharField(max_length=255, allow_blank=False, trim_whitespace=True)
    items = SaleItemInputSerializer(many=True, required=False)
    payments = PaymentInputSerializer(many=True, required=False)
    customer = serializers.PrimaryKeyRelatedField(
        queryset=Customer.objects.all(), required=False, allow_null=True
    )
    discount = serializers.IntegerField(min_value=0, required=False)
    tax = serializers.IntegerField(min_value=0, required=False)
    notes = serializers.CharField(required=False, allow_blank=True)
    sale_date = serializers.DateField(required=False, allow_null=True)

    def validate_reason(self, reason):
        if not reason.strip():
            raise serializers.ValidationError("Say why this sale is being corrected.")
        return reason.strip()

    def validate_sale_date(self, sale_date):
        if sale_date is None:
            return None
        try:
            return backdating.validate(sale_date)
        except backdating.BackdateNotAllowed as exc:
            raise serializers.ValidationError(str(exc)) from exc

    def validate_items(self, items):
        if not items:
            raise serializers.ValidationError("A sale must have at least one item.")
        shop = self.context.get("active_shop")
        # A product that has since been deactivated may stay on the sale it was
        # sold on — refusing it would force the owner to silently drop the line
        # they are trying to correct. Only *new* lines must be sellable today.
        already_on_sale = set(self.context.get("existing_product_ids") or ())
        for item in items:
            product = item["product"]
            if shop is not None and product.shop_id != shop.id:
                raise serializers.ValidationError("Product not found in the active shop.")
            if product.status != Product.Status.ACTIVE and product.id not in already_on_sale:
                raise serializers.ValidationError(
                    f"{product.name} is inactive and cannot be added to a sale."
                )
        return items

    def validate_customer(self, customer):
        shop = self.context.get("active_shop")
        if customer is not None and shop is not None and customer.shop_id != shop.id:
            raise serializers.ValidationError("Customer not found in the active shop.")
        return customer


# ---------------------------------------------------------------- output
class SaleItemSerializer(serializers.ModelSerializer):
    class Meta:
        model = SaleItem
        fields = [
            "id",
            "product",
            "name_snapshot",
            "sku_snapshot",
            "unit_price_snapshot",
            "quantity",
            "line_total",
        ]
        read_only_fields = fields


class PaymentSerializer(serializers.ModelSerializer):
    class Meta:
        model = Payment
        fields = ["id", "method", "amount", "received_at"]
        read_only_fields = fields


class SaleAmendmentSerializer(serializers.ModelSerializer):
    """One recorded correction. Read-only everywhere — amendments never change."""

    user_email = serializers.EmailField(source="user.email", read_only=True, default=None)
    user_name = serializers.CharField(source="user.full_name", read_only=True, default=None)

    class Meta:
        model = SaleAmendment
        fields = [
            "id",
            "reason",
            "changes",
            "before",
            "after",
            "user_email",
            "user_name",
            "created_at",
        ]
        read_only_fields = fields


class SaleSerializer(serializers.ModelSerializer):
    items = SaleItemSerializer(many=True, read_only=True)
    payments = PaymentSerializer(many=True, read_only=True)
    cashier_email = serializers.EmailField(source="cashier.email", read_only=True, default=None)
    customer_name = serializers.CharField(source="customer.name", read_only=True, default=None)
    amount_paid = serializers.SerializerMethodField()
    change = serializers.SerializerMethodField()
    # Both timestamps are exposed on purpose: `occurred_at` is the business day
    # the sale counts towards, `created_at` is when it was entered. When they
    # differ the sale was backdated, and the UI says so.
    is_backdated = serializers.BooleanField(read_only=True)
    # Corrections, newest first. Empty for the overwhelming majority of sales.
    is_amended = serializers.BooleanField(read_only=True)
    amendments = SaleAmendmentSerializer(many=True, read_only=True)

    class Meta:
        model = Sale
        fields = [
            "id",
            "client_uuid",
            "cashier",
            "cashier_email",
            "customer",
            "customer_name",
            "subtotal",
            "discount",
            "tax",
            "total",
            "status",
            "notes",
            "amount_paid",
            "change",
            "items",
            "payments",
            "voided_at",
            "occurred_at",
            "is_backdated",
            "amended_at",
            "is_amended",
            "amendments",
            "created_at",
        ]
        read_only_fields = fields

    def _paid(self, sale) -> int:
        return sum(p.amount for p in sale.payments.all())

    def get_amount_paid(self, sale) -> int:
        return self._paid(sale)

    def get_change(self, sale) -> int:
        return max(0, self._paid(sale) - sale.total)


class ReceiptSerializer(serializers.ModelSerializer):
    """Flattened, display-ready payload for printing (plan §11 Phase 2)."""

    items = SaleItemSerializer(many=True, read_only=True)
    payments = PaymentSerializer(many=True, read_only=True)
    shop_name = serializers.CharField(source="shop.name", read_only=True)
    shop_address = serializers.CharField(source="shop.address", read_only=True)
    cashier_name = serializers.CharField(source="cashier.full_name", read_only=True)
    currency = serializers.SerializerMethodField()
    receipt_footer = serializers.SerializerMethodField()
    amount_paid = serializers.SerializerMethodField()
    change = serializers.SerializerMethodField()
    is_backdated = serializers.BooleanField(read_only=True)

    class Meta:
        model = Sale
        fields = [
            "id",
            "shop_name",
            "shop_address",
            "cashier_name",
            "currency",
            "receipt_footer",
            "subtotal",
            "discount",
            "tax",
            "total",
            "status",
            "amount_paid",
            "change",
            "items",
            "payments",
            "occurred_at",
            "is_backdated",
            "created_at",
        ]
        read_only_fields = fields

    def _settings(self, sale):
        return getattr(sale.shop, "settings", None)

    def get_currency(self, sale) -> str:
        s = self._settings(sale)
        return s.currency if s else "ETB"

    def get_receipt_footer(self, sale) -> str:
        s = self._settings(sale)
        return s.receipt_footer if s else ""

    def get_amount_paid(self, sale) -> int:
        return sum(p.amount for p in sale.payments.all())

    def get_change(self, sale) -> int:
        return max(0, self.get_amount_paid(sale) - sale.total)
