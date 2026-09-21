"""
Tests for journal entries, comments, reactions, and dashboard stats.
Privacy enforcement (spec §21 — critical security requirement) gets
the most thorough coverage here, since it's the guarantee a real user's
private reflections depend on.
"""

from datetime import timedelta

from django.utils import timezone
from rest_framework.test import APITestCase

from .models import JournalComment, JournalEntry


def register_and_login(client, username):
    client.post("/api/v1/auth/register", {
        "fullname": username, "username": username,
        "email": f"{username}@example.com", "password": "SuperSecure123",
    })
    response = client.post("/api/v1/auth/login", {"username": username, "password": "SuperSecure123"})
    return response.data["access_token"]


def auth_header(token):
    return {"HTTP_AUTHORIZATION": f"Bearer {token}"}


class JournalCrudTests(APITestCase):
    def setUp(self):
        self.token = register_and_login(self.client, "owner")

    def test_create_and_list(self):
        create = self.client.post("/api/v1/journal/", {
            "title": "First entry", "content": "hello", "entry_type": "text",
        }, format="json", **auth_header(self.token))
        self.assertEqual(create.status_code, 201)

        listing = self.client.get("/api/v1/journal/", **auth_header(self.token))
        self.assertEqual(listing.status_code, 200)
        # Updated when journal listing was paginated.
        #
        # This used to assert a bare array. It became an envelope because a
        # user with years of entries was being sent every one of them on
        # every visit; the list now carries its own page window so the
        # client can ask for more instead of receiving everything.
        self.assertEqual(listing.data["total"], 1)
        self.assertEqual(len(listing.data["entries"]), 1)
        self.assertFalse(listing.data["hasMore"])

    def test_list_requires_auth(self):
        self.assertEqual(self.client.get("/api/v1/journal/").status_code, 401)

    def test_default_visibility_is_private(self):
        create = self.client.post("/api/v1/journal/", {
            "title": "t", "content": "c", "entry_type": "text",
        }, format="json", **auth_header(self.token))
        self.assertEqual(create.data["visibility"], "private")

    def test_edit_own_entry(self):
        entry = JournalEntry.objects.create(owner_id=self._owner_id(), title="Old", content="old")
        response = self.client.patch(f"/api/v1/journal/{entry.id}/", {"title": "New"},
                                      format="json", **auth_header(self.token))
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["title"], "New")

    def test_delete_is_soft(self):
        entry = JournalEntry.objects.create(owner_id=self._owner_id(), title="t", content="c")
        response = self.client.delete(f"/api/v1/journal/{entry.id}/", **auth_header(self.token))
        self.assertEqual(response.status_code, 204)

        entry.refresh_from_db()
        self.assertTrue(entry.is_deleted)  # row still exists, just flagged

        listing = self.client.get("/api/v1/journal/", **auth_header(self.token))
        self.assertEqual(listing.data["total"], 0)  # but hidden from normal listing

    def _owner_id(self):
        from users.models import User
        return User.objects.get(username="owner").id


class JournalPrivacyTests(APITestCase):
    """The critical security requirement from spec §21: a private entry
    must be unreachable by anyone but its owner, even by guessing the id."""

    def setUp(self):
        self.owner_token = register_and_login(self.client, "owner")
        self.other_token = register_and_login(self.client, "intruder")
        from users.models import User
        self.owner_id = User.objects.get(username="owner").id

    def test_private_entry_invisible_to_other_user(self):
        entry = JournalEntry.objects.create(owner_id=self.owner_id, title="secret", content="private thoughts")
        response = self.client.get(f"/api/v1/journal/{entry.id}/", **auth_header(self.other_token))
        self.assertEqual(response.status_code, 404)  # not 403 — doesn't confirm existence either

    def test_other_user_cannot_edit_private_entry(self):
        entry = JournalEntry.objects.create(owner_id=self.owner_id, title="secret", content="c")
        response = self.client.patch(f"/api/v1/journal/{entry.id}/", {"title": "HACKED"},
                                      format="json", **auth_header(self.other_token))
        self.assertEqual(response.status_code, 404)
        entry.refresh_from_db()
        self.assertEqual(entry.title, "secret")

    def test_other_user_cannot_delete_private_entry(self):
        entry = JournalEntry.objects.create(owner_id=self.owner_id, title="secret", content="c")
        response = self.client.delete(f"/api/v1/journal/{entry.id}/", **auth_header(self.other_token))
        self.assertEqual(response.status_code, 404)
        entry.refresh_from_db()
        self.assertFalse(entry.is_deleted)

    def test_other_user_does_not_see_it_in_their_list(self):
        JournalEntry.objects.create(owner_id=self.owner_id, title="secret", content="c")
        listing = self.client.get("/api/v1/journal/", **auth_header(self.other_token))
        self.assertEqual(listing.data["total"], 0)

    def test_connections_visibility_requires_an_actual_connection(self):
        """
        Updated when the Connections system was built.

        This test used to assert 201 — back when 'connections' behaved
        identically to 'community' because there was no connection model to
        check against. That was a documented gap, and closing it changed
        the expected result: a stranger now gets 404, and only an accepted
        connection gets through. The second half of this test is the part
        that proves the setting does something rather than merely refusing
        everyone.
        """
        entry = JournalEntry.objects.create(
            owner_id=self.owner_id, title="shared", content="c", visibility="connections"
        )

        stranger = self.client.post(
            f"/api/v1/journal/{entry.id}/comments/", {"content": "nice!"},
            format="json", **auth_header(self.other_token)
        )
        self.assertEqual(stranger.status_code, 404)

        from social.models import Connection
        from users.models import User

        Connection.objects.create(
            requester_id=self.owner_id,
            addressee=User.objects.get(username="intruder"),
            status=Connection.ACCEPTED,
        )

        connected = self.client.post(
            f"/api/v1/journal/{entry.id}/comments/", {"content": "nice!"},
            format="json", **auth_header(self.other_token)
        )
        self.assertEqual(connected.status_code, 201)


class CommentTests(APITestCase):
    def setUp(self):
        self.owner_token = register_and_login(self.client, "owner")
        self.other_token = register_and_login(self.client, "commenter")
        from users.models import User
        self.owner_id = User.objects.get(username="owner").id
        self.entry = JournalEntry.objects.create(
            owner_id=self.owner_id, title="t", content="c", visibility="community"
        )

    def test_comment_on_private_entry_blocked(self):
        """
        404, not 403. This assertion was 403 until the visibility rules were
        unified: a 403 tells the caller "that entry exists but isn't yours",
        which is itself something a private entry shouldn't confirm. The
        detail view had always used 404 for this reason; the comment
        endpoints now match it.
        """
        private_entry = JournalEntry.objects.create(owner_id=self.owner_id, title="p", content="c")
        response = self.client.post(f"/api/v1/journal/{private_entry.id}/comments/", {"content": "hi"},
                                     format="json", **auth_header(self.other_token))
        self.assertEqual(response.status_code, 404)

    def test_comments_can_be_turned_off_by_the_author(self):
        """`allow_comments` is one of the four share settings the UI
        collected and discarded before this. 403 rather than 404 here: at
        community visibility the entry is not a secret, only closed."""
        self.entry.allow_comments = False
        self.entry.save(update_fields=["allow_comments"])

        response = self.client.post(f"/api/v1/journal/{self.entry.id}/comments/", {"content": "hi"},
                                     format="json", **auth_header(self.other_token))
        self.assertEqual(response.status_code, 403)

    def test_reply_nests_under_parent(self):
        comment = self.client.post(f"/api/v1/journal/{self.entry.id}/comments/", {"content": "top"},
                                    format="json", **auth_header(self.other_token)).data
        self.client.post(f"/api/v1/journal/{self.entry.id}/comments/",
                          {"content": "reply", "parent": comment["id"]},
                          format="json", **auth_header(self.owner_token))

        listing = self.client.get(f"/api/v1/journal/{self.entry.id}/comments/", **auth_header(self.owner_token))
        self.assertEqual(len(listing.data), 1)  # only 1 top-level
        self.assertEqual(len(listing.data[0]["replies"]), 1)

    def test_reaction_toggles_on_and_off(self):
        comment = JournalComment.objects.create(entry=self.entry, author_id=self.owner_id, content="c")
        url = f"/api/v1/journal/{self.entry.id}/comments/{comment.id}/react/"

        on = self.client.post(url, **auth_header(self.owner_token))
        self.assertEqual(on.data, {"reacted": True, "hearts": 1})

        off = self.client.post(url, **auth_header(self.owner_token))
        self.assertEqual(off.data, {"reacted": False, "hearts": 0})

    def test_user_can_only_delete_own_comment(self):
        comment = JournalComment.objects.create(entry=self.entry, author_id=self.owner_id, content="c")
        response = self.client.delete(f"/api/v1/journal/{self.entry.id}/comments/{comment.id}/",
                                       **auth_header(self.other_token))
        self.assertEqual(response.status_code, 404)
        self.assertTrue(JournalComment.objects.filter(id=comment.id).exists())


class DashboardStatsTests(APITestCase):
    def setUp(self):
        self.token = register_and_login(self.client, "streaker")
        from users.models import User
        self.user_id = User.objects.get(username="streaker").id

    def test_zero_activity_gives_zero_stats(self):
        """
        Four more keys than this test originally asserted.

        `insights_gained` and `community_posts` used to be omitted because
        neither system existed and a number would have been a guess.
        `shared_entries` and `likes_received` arrived with journal
        pagination: the Journal screen's tiles used to be counted from the
        list response, which stopped being the whole journal once it became
        one page. All four are real, and all four are correctly 0 for an
        account with no data.
        """
        response = self.client.get("/api/v1/journal/stats/", **auth_header(self.token))
        self.assertEqual(response.data, {
            "total_entries": 0,
            "shared_entries": 0,
            "likes_received": 0,
            "current_streak_days": 0,
            "insights_gained": 0,
            "community_posts": 0,
            "mood_checkins": 0,
        })

    def test_streak_counts_consecutive_active_days(self):
        now = timezone.now()
        for days_ago in (0, 1, 2):
            entry = JournalEntry.objects.create(owner_id=self.user_id, title="t", content="c")
            JournalEntry.objects.filter(id=entry.id).update(created_at=now - timedelta(days=days_ago))

        response = self.client.get("/api/v1/journal/stats/", **auth_header(self.token))
        self.assertEqual(response.data["total_entries"], 3)
        self.assertEqual(response.data["current_streak_days"], 3)

    def test_gap_breaks_the_streak(self):
        now = timezone.now()
        for days_ago in (0, 1, 5):  # gap between day 1 and day 5
            entry = JournalEntry.objects.create(owner_id=self.user_id, title="t", content="c")
            JournalEntry.objects.filter(id=entry.id).update(created_at=now - timedelta(days=days_ago))

        response = self.client.get("/api/v1/journal/stats/", **auth_header(self.token))
        self.assertEqual(response.data["total_entries"], 3)
        self.assertEqual(response.data["current_streak_days"], 2)  # not 3 — the gap breaks it


class JournalPaginationTests(APITestCase):
    """
    The list endpoint's page window, search and sort.

    These matter more than they look: before pagination the client held
    every entry and filtered the array it had, so 'search' silently meant
    'search what you happen to be holding'. The point of these tests is
    that a match outside the first page is still found.
    """

    def setUp(self):
        self.token = register_and_login(self.client, "writer")
        from users.models import User
        self.owner = User.objects.get(username="writer")

        for index in range(25):
            JournalEntry.objects.create(
                owner=self.owner,
                title=f"Entry {index:02d}",
                content="needle" if index == 0 else "hay",
                mood="Calm" if index % 2 else "Tense",
            )

    def get(self, query=""):
        return self.client.get(f"/api/v1/journal/{query}", **auth_header(self.token))

    def test_first_page_is_capped_and_reports_more(self):
        response = self.get()
        self.assertEqual(response.data["total"], 25)
        self.assertEqual(len(response.data["entries"]), 20)
        self.assertTrue(response.data["hasMore"])

    def test_second_page_finishes_the_list(self):
        response = self.get("?offset=20")
        self.assertEqual(len(response.data["entries"]), 5)
        self.assertFalse(response.data["hasMore"])

    def test_limit_is_capped(self):
        response = self.get("?limit=5000")
        self.assertLessEqual(response.data["limit"], 100)

    def test_search_reaches_beyond_the_first_page(self):
        """The oldest entry is the only match, and it is on page two."""
        response = self.get("?q=needle")
        self.assertEqual(response.data["total"], 1)
        self.assertEqual(response.data["entries"][0]["title"], "Entry 00")

    def test_mood_filter(self):
        response = self.get("?mood=Calm")
        self.assertEqual(response.data["total"], 12)
        self.assertTrue(all(e["mood"] == "Calm" for e in response.data["entries"]))

    def test_sort_oldest_first(self):
        newest = self.get("?sort=newest").data["entries"][0]["id"]
        oldest = self.get("?sort=oldest").data["entries"][0]["id"]
        self.assertNotEqual(newest, oldest)
        self.assertLess(oldest, newest)

    def test_a_nonsense_sort_falls_back_instead_of_erroring(self):
        response = self.get("?sort=; DROP TABLE")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["total"], 25)


class EntryReactionTests(APITestCase):
    """Hearts on shared entries — the count the Journal card draws."""

    def setUp(self):
        self.owner_token = register_and_login(self.client, "sharer")
        self.other_token = register_and_login(self.client, "reader")
        from users.models import User
        self.owner = User.objects.get(username="sharer")

        self.shared = JournalEntry.objects.create(
            owner=self.owner, title="shared", content="c", visibility="community"
        )
        self.private = JournalEntry.objects.create(
            owner=self.owner, title="private", content="c"
        )

    def test_reacting_toggles(self):
        url = f"/api/v1/journal/{self.shared.id}/react/"
        first = self.client.post(url, **auth_header(self.other_token))
        self.assertTrue(first.data["liked"])
        self.assertEqual(first.data["likes"], 1)

        second = self.client.post(url, **auth_header(self.other_token))
        self.assertFalse(second.data["liked"])
        self.assertEqual(second.data["likes"], 0)

    def test_a_private_entry_cannot_be_reacted_to(self):
        response = self.client.post(
            f"/api/v1/journal/{self.private.id}/react/", **auth_header(self.other_token)
        )
        self.assertEqual(response.status_code, 404)  # not 403 — see spec §21

    def test_the_owners_list_shows_the_count(self):
        self.client.post(
            f"/api/v1/journal/{self.shared.id}/react/", **auth_header(self.other_token)
        )
        listing = self.client.get("/api/v1/journal/?sort=oldest", **auth_header(self.owner_token))
        entry = next(e for e in listing.data["entries"] if e["id"] == self.shared.id)
        self.assertEqual(entry["likes"], 1)
        self.assertTrue(entry["shared"])
        self.assertFalse(entry["liked"])  # the owner hasn't hearted it themselves

    def test_your_own_heart_does_not_inflate_likes_received(self):
        self.client.post(
            f"/api/v1/journal/{self.shared.id}/react/", **auth_header(self.owner_token)
        )
        stats = self.client.get("/api/v1/journal/stats/", **auth_header(self.owner_token))
        self.assertEqual(stats.data["likes_received"], 0)
        self.assertEqual(stats.data["shared_entries"], 1)
