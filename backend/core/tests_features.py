"""
Tests for the second round of "make it real" fixes.

Each class here covers something the UI used to show or offer without the
backend doing it: the Dashboard's numbers, the Settings switches that were
saved and never read, the weekly digest nobody sent, badges nobody checked,
and the sign-up and reset flows that dropped what they were given.
"""

from datetime import timedelta

from django.core import mail
from django.core.management import call_command
from django.test import override_settings
from django.utils import timezone
from rest_framework.test import APITestCase

from journal.models import JournalEntry
from journal.tests import auth_header, register_and_login
from moods.models import MoodCheckIn
from users.models import User


def _user(username):
    return User.objects.get(username=username)


def _set(user, group, **values):
    settings = user.app_settings
    setattr(settings, group, {**(getattr(settings, group) or {}), **values})
    settings.save()


class DashboardSummaryTests(APITestCase):
    def setUp(self):
        self.token = register_and_login(self.client, "sarah")
        self.user = _user("sarah")
        self.user.fullname = "Sarah Chen"
        self.user.save()

    def get(self):
        return self.client.get("/api/v1/insights/dashboard/", **auth_header(self.token))

    def test_greets_the_real_person(self):
        """The screen used to say "Welcome back, Alex!" to everyone."""
        self.assertEqual(self.get().data["firstName"], "Sarah")

    def test_a_new_account_has_no_streak_and_fourteen_empty_days(self):
        data = self.get().data
        self.assertEqual(data["streakDays"], 0)
        self.assertEqual(len(data["last14"]), 14)
        self.assertTrue(all(day["mood"] is None for day in data["last14"]))
        self.assertIsNone(data["timeTip"])  # no tip without data to support it

    def test_a_check_in_shows_up_today(self):
        MoodCheckIn.objects.create(owner=self.user, mood="Grateful")
        data = self.get().data
        self.assertEqual(data["last14"][-1]["mood"], "Grateful")
        self.assertEqual(data["today"]["checkin"]["mood"], "Grateful")
        self.assertEqual(data["streakDays"], 1)

    def test_goals_come_from_settings(self):
        _set(self.user, "journaling", dailyGoal=3, weeklyGoal=7)
        JournalEntry.objects.create(owner=self.user, title="t", content="c")
        data = self.get().data
        self.assertEqual(data["today"], {**data["today"], "entries": 1, "goal": 3})
        self.assertEqual(data["week"]["goal"], 7)

    def test_quote_follows_the_daily_inspiration_setting(self):
        self.assertTrue(self.get().data["showQuote"])
        _set(self.user, "social", inspirationFeed=False)
        self.assertFalse(self.get().data["showQuote"])


class WeeklyDigestTests(APITestCase):
    def setUp(self):
        register_and_login(self.client, "writer")
        self.user = _user("writer")
        last_week = timezone.now() - timedelta(days=7)
        entry = JournalEntry.objects.create(owner=self.user, title="t", content="c")
        JournalEntry.objects.filter(pk=entry.pk).update(created_at=last_week)

    def digests(self):
        from notifications.models import Notification

        return Notification.objects.filter(recipient=self.user, title="Your week in SoulLog")

    def test_sent_once_when_switched_on(self):
        from insights.dashboard import send_weekly_digest

        _set(self.user, "notifications", weeklyDigest=True)
        send_weekly_digest(self.user)
        send_weekly_digest(self.user)
        self.assertEqual(self.digests().count(), 1)
        self.assertIn("1 journal entry", self.digests().first().body)

    def test_not_sent_when_switched_off(self):
        from insights.dashboard import send_weekly_digest

        _set(self.user, "notifications", weeklyDigest=False)
        send_weekly_digest(self.user)
        self.assertEqual(self.digests().count(), 0)


class SocialSettingsTests(APITestCase):
    """Friend Requests, Allow Followers, Recommendations, Show My Badges."""

    def setUp(self):
        self.a_token = register_and_login(self.client, "alpha")
        self.b_token = register_and_login(self.client, "beta")
        self.alpha, self.beta = _user("alpha"), _user("beta")

    def request_beta(self):
        return self.client.post(
            "/api/v1/social/requests/create/", {"user_id": self.beta.id},
            format="json", **auth_header(self.a_token),
        )

    def test_friend_requests_no_one(self):
        _set(self.beta, "social", friendRequests="none")
        self.assertEqual(self.request_beta().status_code, 403)

    def test_friend_requests_friends_of_friends_needs_a_mutual(self):
        _set(self.beta, "social", friendRequests="friends")
        self.assertEqual(self.request_beta().status_code, 403)

    def test_friend_requests_everyone_is_the_default(self):
        self.assertEqual(self.request_beta().status_code, 201)

    def test_allow_followers_off(self):
        _set(self.beta, "social", followSystem=False)
        response = self.client.post(
            f"/api/v1/social/follow/{self.beta.id}/", **auth_header(self.a_token)
        )
        self.assertEqual(response.status_code, 403)

    def test_recommendations_off_means_no_suggestions(self):
        _set(self.alpha, "social", connectionRecommendations=False)
        response = self.client.get("/api/v1/social/suggestions/", **auth_header(self.a_token))
        self.assertEqual(response.data, [])

    def test_show_my_badges_off_hides_them_from_others_only(self):
        for index in range(1):
            JournalEntry.objects.create(owner=self.beta, title=str(index), content="c")
        call_command("award_badges", "--username", "beta", verbosity=0)
        _set(self.beta, "social", achievementSharing=False)

        public = self.client.get("/api/v1/profile/beta/", **auth_header(self.a_token))
        self.assertEqual(public.data["achievements"], [])

        own = self.client.get("/api/v1/profile/", **auth_header(self.b_token))
        self.assertTrue(own.data["achievements"])


class NotificationMasterSwitchTests(APITestCase):
    def test_notifications_off_means_none(self):
        from notifications.models import Notification, NotificationKind
        from notifications.services import notify

        register_and_login(self.client, "quiet")
        user = _user("quiet")
        _set(user, "notifications", pushEnabled=False, emailEnabled=True)
        notify(recipient=user, actor=None, kind=NotificationKind.MILESTONE, title="x")
        self.assertFalse(Notification.objects.filter(recipient=user).exists())


class JournalDefaultVisibilityTests(APITestCase):
    def setUp(self):
        self.token = register_and_login(self.client, "writer")
        self.user = _user("writer")

    def create(self, **extra):
        return self.client.post(
            "/api/v1/journal/", {"title": "t", "content": "c", **extra},
            format="json", **auth_header(self.token),
        )

    def test_private_by_default(self):
        self.assertEqual(self.user.profile.journal_visibility, "private")
        self.assertEqual(self.create().data["visibility"], "private")

    def test_the_setting_is_used_when_the_entry_says_nothing(self):
        profile = self.user.profile
        profile.journal_visibility = "connections"
        profile.save()
        self.assertEqual(self.create().data["visibility"], "connections")

    def test_public_maps_to_community(self):
        profile = self.user.profile
        profile.journal_visibility = "public"
        profile.save()
        self.assertEqual(self.create().data["visibility"], "community")

    def test_an_explicit_choice_always_wins(self):
        profile = self.user.profile
        profile.journal_visibility = "public"
        profile.save()
        self.assertEqual(self.create(visibility="private").data["visibility"], "private")


class AwardBadgesCommandTests(APITestCase):
    def test_awards_history_quietly_and_only_once(self):
        from achievements.models import UserBadge
        from notifications.models import Notification

        register_and_login(self.client, "history")
        user = _user("history")
        JournalEntry.objects.create(owner=user, title="t", content="c")
        Notification.objects.filter(recipient=user).delete()

        call_command("award_badges", verbosity=0)
        earned = UserBadge.objects.filter(user=user).count()
        self.assertGreater(earned, 0)
        self.assertFalse(Notification.objects.filter(recipient=user, kind="milestone").exists())

        call_command("award_badges", verbosity=0)
        self.assertEqual(UserBadge.objects.filter(user=user).count(), earned)


class SignupAndResetTests(APITestCase):
    def test_signup_keeps_the_phone_number(self):
        """The form always had the field; it used to be dropped before sending."""
        self.client.post("/api/v1/auth/register", {
            "fullname": "P", "username": "phoney", "email": "p@example.com",
            "password": "SuperSecure123", "phone_number": "+977 9800000000",
        }, format="json")
        self.assertEqual(_user("phoney").phone_number, "+977 9800000000")

    @override_settings(
        EMAIL_BACKEND="django.core.mail.backends.locmem.EmailBackend",
        FRONTEND_BASE_URL="https://soullog.example",
    )
    def test_reset_email_contains_a_working_link(self):
        register_and_login(self.client, "forgetful")
        self.client.post("/api/v1/auth/password-reset/request/", {"username": "forgetful"}, format="json")
        self.assertEqual(len(mail.outbox), 1)
        self.assertIn("https://soullog.example/#/reset-password/", mail.outbox[0].body)


class TaglineTests(APITestCase):
    def test_tagline_round_trips(self):
        token = register_and_login(self.client, "tagged")
        self.client.patch("/api/v1/profile/", {"tagline": "Mindful explorer"},
                          format="json", **auth_header(token))
        self.assertEqual(
            self.client.get("/api/v1/profile/", **auth_header(token)).data["tagline"],
            "Mindful explorer",
        )


class SeedDemoTests(APITestCase):
    def test_no_one_posts_or_writes_the_same_thing_twice(self):
        """The Sanctuary feed showed the same author posting the same words twice."""
        from django.db.models import Count

        from sanctuary.models import SanctuaryPost

        call_command("seed_demo", verbosity=0)
        self.assertFalse(
            SanctuaryPost.objects.values("content").annotate(n=Count("id")).filter(n__gt=1).exists()
        )
        self.assertFalse(
            JournalEntry.objects.values("owner", "title").annotate(n=Count("id")).filter(n__gt=1).exists()
        )


class CommentAvatarTests(APITestCase):
    def test_journal_comments_carry_a_capital_initial_and_photo_field(self):
        token = register_and_login(self.client, "lowercase")
        entry = JournalEntry.objects.create(owner=_user("lowercase"), title="t", content="c", visibility="community")
        self.client.post(f"/api/v1/journal/{entry.id}/comments/", {"content": "hi"}, format="json", **auth_header(token))
        rows = self.client.get(f"/api/v1/journal/{entry.id}/comments/", **auth_header(token)).data
        rows = rows.get("results", rows) if isinstance(rows, dict) else rows
        self.assertEqual(rows[0]["avatar"], "L")
        self.assertIn("avatarUrl", rows[0])


class DeclinedRequestTests(APITestCase):
    """After "Decline", the two people are suggestions for each other again."""

    def setUp(self):
        self.a_token = register_and_login(self.client, "asker")
        self.b_token = register_and_login(self.client, "decider")
        self.a, self.b = _user("asker"), _user("decider")
        for user in (self.a, self.b):  # something in common, so they're suggested
            user.profile.location = "Kathmandu"
            user.profile.save()

    def suggested(self, token):
        rows = self.client.get("/api/v1/social/suggestions/", **auth_header(token)).data
        return {row["username"]: row for row in rows}

    def test_declined_pair_reappears_in_suggestions(self):
        from social.models import Connection

        self.client.post("/api/v1/social/requests/create/", {"user_id": self.b.id},
                         format="json", **auth_header(self.a_token))
        self.assertNotIn("decider", self.suggested(self.a_token))  # pending: hidden

        Connection.objects.filter(requester=self.a, addressee=self.b).update(status=Connection.DECLINED)

        for token, other in ((self.a_token, "decider"), (self.b_token, "asker")):
            rows = self.suggested(token)
            self.assertIn(other, rows)
            self.assertEqual(rows[other]["relationship"]["state"], "none")

        # ...and a fresh request goes through.
        again = self.client.post("/api/v1/social/requests/create/", {"user_id": self.b.id},
                                 format="json", **auth_header(self.a_token))
        self.assertIn(again.status_code, (200, 201))


class NotificationTabCountsTests(APITestCase):
    def test_tab_numbers_count_only_unread(self):
        """The tabs used to show running totals; now only what's new."""
        from notifications.models import Notification
        from notifications.serializers import counts_for
        from notifications.services import notify

        register_and_login(self.client, "counted")
        user = _user("counted")
        notify(recipient=user, actor=None, kind="follow", title="a")
        notify(recipient=user, actor=None, kind="connection_request", title="b")
        self.assertEqual(counts_for(user)["social"], 2)
        Notification.objects.filter(recipient=user).update(is_read=True)
        counts = counts_for(user)
        self.assertEqual((counts["all"], counts["social"], counts["unread"]), (0, 0, 0))


class FriendsCountAsFollowsTests(APITestCase):
    """One friend is one follower and one following, and is never counted twice."""

    def setUp(self):
        self.a_token = register_and_login(self.client, "friend_a")
        self.b_token = register_and_login(self.client, "friend_b")
        self.a, self.b = _user("friend_a"), _user("friend_b")

    def stats(self, token):
        return self.client.get("/api/v1/profile/", **auth_header(token)).data["stats"]

    def test_friend_counts_both_ways_once(self):
        from social.models import Connection, Follow

        Connection.objects.create(requester=self.a, addressee=self.b, status=Connection.ACCEPTED)
        for token in (self.a_token, self.b_token):
            stats = self.stats(token)
            self.assertEqual((stats["followers"], stats["following"]), (1, 1))

        # Also following each other the old way doesn't double it.
        Follow.objects.create(follower=self.a, following=self.b)
        self.assertEqual(self.stats(self.a_token)["following"], 1)
        self.assertEqual(self.stats(self.b_token)["followers"], 1)

        other = self.client.get("/api/v1/profile/friend_b/", **auth_header(self.a_token)).data
        self.assertTrue(other["is_following"])

    def test_removing_the_friend_removes_the_counts(self):
        from social.models import Connection

        Connection.objects.create(requester=self.a, addressee=self.b, status=Connection.ACCEPTED)
        Connection.objects.all().delete()
        stats = self.stats(self.a_token)
        self.assertEqual((stats["followers"], stats["following"]), (0, 0))
