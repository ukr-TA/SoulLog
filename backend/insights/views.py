from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from .engine import common_themes, mood_distribution, run_insight_engine, time_patterns


class InsightsListView(APIView):
    """GET /api/v1/insights/ — real, per-user insights computed live from
    actual journal/mood data. See engine.py for the analyzers and the
    honesty rules they follow (spec §29-32)."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        return Response(run_insight_engine(request.user))


class InsightsSummaryView(APIView):
    """
    GET /api/v1/insights/summary/?days=30

    The three panels on the Insights page that used to be hardcoded arrays
    in the component: the mood distribution chart, the time-patterns list
    and the common-themes list.

    Each can come back empty, and empty is the correct render for an
    account without enough history. The UI shows a short "not enough
    entries yet" line in that case — which is the same choice the Insight
    Engine itself makes, and the reason this page can be trusted at all.
    """

    permission_classes = [IsAuthenticated]

    def get(self, request):
        try:
            days = int(request.query_params.get("days", 30))
        except (TypeError, ValueError):
            days = 30
        days = max(7, min(days, 365))

        return Response({
            "days": days,
            "moodDistribution": mood_distribution(request.user, days=days),
            "timePatterns": time_patterns(request.user, days=days),
            "commonThemes": common_themes(request.user, days=max(days, 30)),
        })


class DashboardSummaryView(APIView):
    """
    GET /api/v1/insights/dashboard/

    Everything the Dashboard home screen draws, computed from the user's
    own data in one request: their name, streak, today's and this week's
    progress against their own goals, the last 14 days of moods, and an
    insight if the engine has one. See insights/dashboard.py.
    """

    permission_classes = [IsAuthenticated]

    def get(self, request):
        from .dashboard import dashboard_summary

        return Response(dashboard_summary(request.user))
