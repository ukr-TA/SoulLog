"""
The analyzers added when the Insights page stopped being partly hardcoded.

Every test here is really the same test asked six ways: does this analyzer
stay silent when the data doesn't support it? That restraint is the only
reason a user should believe the cards that do appear.
"""

from datetime import timedelta

from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APITestCase

from journal.models import JournalEntry
from moods.models import MoodCheckIn
from users.models import User

from .engine import (
    common_themes,
    extract_themes,
    mood_distribution,
    stress_evolution_analyzer,
    theme_analyzer,
    time_of_day_analyzer,
    time_patterns,
    weekend_depth_analyzer,
)


def make_entry(user, when, content="word word word", words=None, mood=""):
    entry = JournalEntry.objects.create(owner=user, title="t", content=content, mood=mood)
    if words is not None:
        JournalEntry.objects.filter(pk=entry.pk).update(created_at=when, word_count=words)
    else:
        JournalEntry.objects.filter(pk=entry.pk).update(created_at=when)
    entry.refresh_from_db()
    return entry


def make_checkin(user, when, mood="Calm"):
    checkin = MoodCheckIn.objects.create(owner=user, mood=mood, intensity=5)
    MoodCheckIn.objects.filter(pk=checkin.pk).update(created_at=when)
    return checkin


class SilenceTests(TestCase):
    """A new account gets no insight cards at all. Not one."""

    def setUp(self):
        self.user = User.objects.create_user(
            username="quiet", email="quiet@example.com", password="SuperSecure123"
        )
        self.now = timezone.now()

    def test_every_analyzer_is_silent_without_data(self):
        for analyzer in (
            time_of_day_analyzer,
            weekend_depth_analyzer,
            stress_evolution_analyzer,
            theme_analyzer,
        ):
            self.assertEqual(analyzer(self.user, self.now), [], analyzer.__name__)

    def test_chart_helpers_return_empty_rather_than_placeholders(self):
        self.assertEqual(mood_distribution(self.user), [])
        self.assertEqual(common_themes(self.user), [])
        self.assertEqual(time_patterns(self.user), [])


class TimeOfDayTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(
            username="writer", email="writer@example.com", password="SuperSecure123"
        )
        self.now = timezone.now()

    def test_an_even_spread_is_not_reported_as_a_pattern(self):
        """The guard that stops this analyzer from calling chance a habit."""
        base = self.now.replace(hour=0, minute=0) - timedelta(days=10)
        for index, hour in enumerate([7, 14, 19, 23, 8, 15, 20, 2]):
            make_entry(self.user, base + timedelta(days=index, hours=hour))

        self.assertEqual(time_of_day_analyzer(self.user, self.now), [])

    def test_a_real_lean_is_reported(self):
        base = self.now.replace(hour=0, minute=0) - timedelta(days=10)
        for index in range(8):
            make_entry(self.user, base + timedelta(days=index, hours=20))

        result = time_of_day_analyzer(self.user, self.now)
        self.assertEqual(len(result), 1)
        self.assertIn("evening", result[0]["text"])
        self.assertEqual(result[0]["category"], "Time Pattern")


class WeekendDepthTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(
            username="weekender", email="weekender@example.com", password="SuperSecure123"
        )
        self.now = timezone.now()

    def _seed(self, weekend_words, weekday_words):
        # Walk back from a known Sunday so the weekday/weekend split is
        # deterministic rather than dependent on when the suite runs.
        cursor = self.now - timedelta(days=1)
        while cursor.weekday() != 6:
            cursor -= timedelta(days=1)

        for index in range(4):
            make_entry(self.user, cursor - timedelta(days=index * 7), words=weekend_words)
        for index in range(4):
            make_entry(self.user, cursor - timedelta(days=3 + index * 7), words=weekday_words)

    def test_similar_lengths_produce_nothing(self):
        self._seed(weekend_words=100, weekday_words=105)
        self.assertEqual(weekend_depth_analyzer(self.user, self.now), [])

    def test_a_clear_difference_is_reported(self):
        self._seed(weekend_words=300, weekday_words=100)
        result = weekend_depth_analyzer(self.user, self.now)
        self.assertEqual(len(result), 1)
        self.assertIn("longer", result[0]["text"])
        self.assertEqual(result[0]["category"], "Weekend Reflection Depth")


class StressEvolutionTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(
            username="steady", email="steady@example.com", password="SuperSecure123"
        )
        self.now = timezone.now()

    def test_too_few_checkins_says_nothing(self):
        for index in range(5):
            make_checkin(self.user, self.now - timedelta(days=index), mood="Stressed")
        self.assertEqual(stress_evolution_analyzer(self.user, self.now), [])

    def test_a_real_decrease_is_reported_without_claiming_a_cause(self):
        for index in range(10):
            make_checkin(self.user, self.now - timedelta(days=40 + index), mood="Stressed")
        for index in range(10):
            make_checkin(self.user, self.now - timedelta(days=index), mood="Calm")

        result = stress_evolution_analyzer(self.user, self.now)
        self.assertEqual(len(result), 1)
        text = result[0]["text"]
        self.assertIn("down from", text)
        self.assertIn("doesn't explain why", text)

    def test_a_flat_trend_says_nothing(self):
        for index in range(10):
            make_checkin(
                self.user, self.now - timedelta(days=40 + index),
                mood="Stressed" if index % 2 else "Calm",
            )
        for index in range(10):
            make_checkin(
                self.user, self.now - timedelta(days=index),
                mood="Stressed" if index % 2 else "Calm",
            )
        self.assertEqual(stress_evolution_analyzer(self.user, self.now), [])


class ThemeExtractionTests(TestCase):
    def test_stopwords_are_excluded(self):
        texts = ["the and but I was really just", "the and but I was really just"] * 3
        self.assertEqual(extract_themes(texts), [])

    def test_counts_documents_not_occurrences(self):
        """A word repeated eight times in one entry is one entry's worth of
        evidence."""
        themes = extract_themes(["garden " * 8], minimum_mentions=1)
        self.assertEqual(themes[0], {"theme": "garden", "mentions": 1})

    def test_contractions_are_not_themes(self):
        """
        Regression. The first version of this allowed apostrophes in the
        word pattern, and the real output on seeded data came back as
        "I've", "I'd" and "Rather" — the most common words in anyone's
        writing and the least meaningful as a theme.
        """
        texts = ["I've been thinking and I'd rather not"] * 5
        themes = [row["theme"] for row in extract_themes(texts, minimum_mentions=2)]
        self.assertNotIn("i've", themes)
        self.assertNotIn("i'd", themes)
        self.assertNotIn("rather", themes)

    def test_number_and_time_words_are_not_themes(self):
        """
        Regression. Seeded data produced "Three (mentioned 3 times)" and
        "Four (mentioned 3 times)" as someone's common themes — true, and
        useless, and it reads as a broken feature.
        """
        texts = ["one two three four five days later that week"] * 5
        self.assertEqual(extract_themes(texts, minimum_mentions=2), [])

    def test_a_recurring_word_surfaces(self):
        texts = ["thinking about the garden"] * 4 + ["nothing in particular"] * 2
        themes = extract_themes(texts, minimum_mentions=3)
        self.assertIn("garden", [t["theme"] for t in themes])


class InsightsApiTests(APITestCase):
    def setUp(self):
        self.client.post("/api/v1/auth/register", {
            "fullname": "Ama", "username": "ama",
            "email": "ama@example.com", "password": "SuperSecure123",
        })
        self.token = self.client.post(
            "/api/v1/auth/login", {"username": "ama", "password": "SuperSecure123"}
        ).data["access_token"]
        self.user = User.objects.get(username="ama")

    def _auth(self):
        return {"HTTP_AUTHORIZATION": f"Bearer {self.token}"}

    def test_summary_endpoint_is_empty_for_a_new_account(self):
        response = self.client.get("/api/v1/insights/summary/", **self._auth())
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["moodDistribution"], [])
        self.assertEqual(response.data["timePatterns"], [])
        self.assertEqual(response.data["commonThemes"], [])

    def test_mood_chart_reflects_real_checkins(self):
        now = timezone.now()
        for _ in range(5):
            make_checkin(self.user, now - timedelta(days=1), mood="Calm")
        for _ in range(2):
            make_checkin(self.user, now - timedelta(days=2), mood="Happy")

        response = self.client.get("/api/v1/insights/summary/", **self._auth())
        chart = response.data["moodDistribution"]
        self.assertEqual(chart[0]["label"], "Calm")
        self.assertEqual(chart[0]["value"], 5)
        self.assertEqual(chart[0]["height"], 100)  # tallest bar
        self.assertEqual(chart[1]["label"], "Happy")

    def test_insights_are_scoped_to_the_caller(self):
        other = User.objects.create_user(
            username="other", email="other@example.com", password="SuperSecure123"
        )
        now = timezone.now()
        for _ in range(10):
            make_checkin(other, now - timedelta(days=1), mood="Stressed")

        response = self.client.get("/api/v1/insights/", **self._auth())
        self.assertEqual(response.data, [])
