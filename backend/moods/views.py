from rest_framework import generics, permissions, serializers

from .models import MoodCheckIn


class MoodCheckInSerializer(serializers.ModelSerializer):
    class Meta:
        model = MoodCheckIn
        fields = ["id", "mood", "reason", "intensity", "description", "created_at"]
        read_only_fields = ["id", "created_at"]


class MoodListCreateView(generics.ListCreateAPIView):
    """GET/POST /api/v1/mood/ — matches MoodCheckin.tsx's POST call."""

    serializer_class = MoodCheckInSerializer
    permission_classes = [permissions.IsAuthenticated]
    pagination_class = None  # see NOTE in journal/views.py — same reasoning

    def get_queryset(self):
        return MoodCheckIn.objects.filter(owner=self.request.user)

    def perform_create(self, serializer):
        serializer.save(owner=self.request.user)

        from achievements.models import Badge
        from achievements.services import award_quietly

        award_quietly(
            self.request.user,
            metrics={Badge.MOOD_CHECKINS, Badge.CURRENT_STREAK, Badge.BEST_STREAK},
        )
