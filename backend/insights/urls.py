from django.urls import path

from .views import InsightsListView, InsightsSummaryView

urlpatterns = [
    path("", InsightsListView.as_view(), name="insights-list"),
    path("summary/", InsightsSummaryView.as_view(), name="insights-summary"),
]
