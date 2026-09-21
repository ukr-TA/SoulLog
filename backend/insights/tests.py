from datetime import timedelta

from django.utils import timezone
from rest_framework.test import APITestCase

from journal.models import JournalEntry
from moods.models import MoodCheckIn


def register_and_login(client, username="insightuser"):
    client.post("/api/v1/auth/register", {
        "fullname": username, "username": username,
        "email": f"{username}@example.com", "password": "SuperSecure123",
    })
    response = client.post("/api/v1/auth/login", {"username": username, "password": "SuperSecure123"})
    return response.data["access_token"]


def auth_header(token):
    return {"HTTP_AUTHORIZATION": f"Bearer {token}"}


class InsightEngineTests(APITestCase):
    def setUp(self):
        self.token = register_and_login(self.client)
        from users.models import User
        self.user_id = User.objects.get(username="insightuser").id

    def test_no_data_gives_no_insights(self):
        """The most important test in this file: a user with zero
        activity must see zero insight cards, never fabricated ones."""
        response = self.client.get("/api/v1/insights/", **auth_header(self.token))
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data, [])

    def test_too_few_checkins_produce_no_mood_insight(self):
        for _ in range(2):  # below the analyzer's minimum of 3
            MoodCheckIn.objects.create(owner_id=self.user_id, mood="Happy", intensity=5)
        response = self.client.get("/api/v1/insights/", **auth_header(self.token))
        categories = [i["category"] for i in response.data]
        self.assertNotIn("Mood Pattern", categories)

    def test_mood_frequency_reports_correct_percentage_and_confidence(self):
        for mood in ["Calm"] * 6 + ["Happy"] * 3 + ["Anxious"]:
            MoodCheckIn.objects.create(owner_id=self.user_id, mood=mood, intensity=5)

        response = self.client.get("/api/v1/insights/", **auth_header(self.token))
        mood_insight = next(i for i in response.data if i["category"] == "Mood Pattern")
        self.assertIn("60%", mood_insight["text"])
        self.assertIn("Calm", mood_insight["text"])
        self.assertEqual(mood_insight["confidence"], "Moderate")  # 10 checkins: 5 <= n < 15

    def test_consistency_trend_detects_increase(self):
        now = timezone.now()
        # Last week: 2 active days. This week: 5 active days.
        for days_ago in (8, 10, 0, 1, 2, 3, 4):
            entry = JournalEntry.objects.create(owner_id=self.user_id, title="t", content="c")
            JournalEntry.objects.filter(id=entry.id).update(created_at=now - timedelta(days=days_ago))

        response = self.client.get("/api/v1/insights/", **auth_header(self.token))
        trend = next(i for i in response.data if i["category"] == "Consistency Pattern")
        self.assertIn("5", trend["text"])
        self.assertIn("up from 2", trend["text"])

    def test_language_is_never_diagnostic(self):
        """Spec §30: SoulLog must never present itself as diagnosing a
        condition. Guard against a regression introducing clinical claims.
        Note: the analyzer's own disclaimer legitimately contains the word
        "diagnosis" (e.g. "not a diagnosis of your emotional state") — so
        this checks for actual diagnostic claims, not the bare word."""
        for mood in ["Anxious"] * 5:
            MoodCheckIn.objects.create(owner_id=self.user_id, mood=mood, intensity=8)
        response = self.client.get("/api/v1/insights/", **auth_header(self.token))
        forbidden_phrases = ["you have anxiety", "you have depression", "disorder", "this proves", "caused by"]
        for insight in response.data:
            lowered = insight["text"].lower()
            for phrase in forbidden_phrases:
                self.assertNotIn(phrase, lowered)

    def test_requires_authentication(self):
        self.assertEqual(self.client.get("/api/v1/insights/").status_code, 401)
