from django.conf import settings
from django.db import models

from journal.models import MOOD_CHOICES


class MoodCheckIn(models.Model):
    """A single mood check-in — matches MoodCheckin.tsx's payload exactly:
    { mood, reason, intensity, description }."""

    owner = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="mood_checkins"
    )

    mood = models.CharField(max_length=20, choices=MOOD_CHOICES)
    reason = models.CharField(max_length=100, blank=True)
    intensity = models.PositiveSmallIntegerField(default=5)  # 1-10 scale
    description = models.TextField(blank=True)

    is_demo = models.BooleanField(default=False)

    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]
        indexes = [models.Index(fields=["owner", "-created_at"])]

    def __str__(self):
        return f"{self.owner.username}: {self.mood} ({self.created_at:%Y-%m-%d})"
