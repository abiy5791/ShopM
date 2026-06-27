from rest_framework import serializers


class ReportSummaryItemSerializer(serializers.Serializer):
    label = serializers.CharField()
    value = serializers.IntegerField()
    money = serializers.BooleanField()


class ReportSerializer(serializers.Serializer):
    key = serializers.CharField()
    title = serializers.CharField()
    currency = serializers.CharField()
    summary = ReportSummaryItemSerializer(many=True)
    columns = serializers.ListField(child=serializers.CharField())
    rows = serializers.ListField(child=serializers.ListField())
    money_columns = serializers.ListField(child=serializers.IntegerField())


class DashboardSerializer(serializers.Serializer):
    currency = serializers.CharField()
    today = serializers.DictField()
    low_stock_count = serializers.IntegerField()
    total_products = serializers.IntegerField()
    cash_balance = serializers.IntegerField()
    best_sellers = serializers.ListField(child=serializers.DictField())
    recent_sales = serializers.ListField(child=serializers.DictField())
