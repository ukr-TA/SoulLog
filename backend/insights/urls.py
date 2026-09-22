from django.urls import path

from .views import DashboardSummaryView, InsightsListView, InsightsSummaryView

urlpatterns = [
    path("", InsightsListView.as_view(), name="insights-list"),
    path("summary/", InsightsSummaryView.as_view(), name="insights-summary"),
    path("dashboard/", DashboardSummaryView.as_view(), name="insights-dashboard"),
]
