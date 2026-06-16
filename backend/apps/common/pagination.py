from rest_framework.pagination import PageNumberPagination


class DefaultPagination(PageNumberPagination):
    """Standard list pagination: ?page=&page_size= (plan §9)."""

    page_size = 25
    page_size_query_param = "page_size"
    max_page_size = 200
