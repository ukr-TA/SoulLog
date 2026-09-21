"""
Notifications: what gets created, what deliberately doesn't, and the
settings that decide.

The suppression tests carry most of the weight. A notification system that
ignores the user's own switches is worse than one that doesn't exist,
because the switches promise something.
"""

from rest_framework.test import APITestCase

from social.models import Connection
from users.models import User

from .models import Notification
from .services import notify


def register_and_login(client, username):
    client.post("/api/v1/auth/register", {
        "fullname": username.title(), "username": username,
        "email": f"{username}@example.com", "password": "SuperSecure123",
    })
    return client.post(
        "/api/v1/auth/login", {"username": username, "password": "SuperSecure123"}
    ).data["access_token"]


def auth(token):
    return {"HTTP_AUTHORIZATION": f"Bearer {token}"}


class NotificationCreationTests(APITestCase):
    def setUp(self):
        self.a_token = register_and_login(self.client, "amara")
        register_and_login(self.client, "bishal")
        self.a = User.objects.get(username="amara")
        self.b = User.objects.get(username="bishal")

    def test_basic_notification_is_stored(self):
        notify(recipient=self.a, actor=self.b, kind="like", title="liked your post")
        self.assertEqual(Notification.objects.filter(recipient=self.a).count(), 1)

    def test_never_notifies_you_about_your_own_action(self):
        result = notify(recipient=self.a, actor=self.a, kind="like", title="liked your post")
        self.assertIsNone(result)
        self.assertEqual(Notification.objects.count(), 0)

    def test_blocked_actor_produces_nothing(self):
        Connection.objects.create(
            requester=self.a, addressee=self.b, status=Connection.BLOCKED, blocked_by=self.a
        )
        result = notify(recipient=self.a, actor=self.b, kind="like", title="liked your post")
        self.assertIsNone(result)

    def test_respects_the_recipients_own_switch(self):
        settings_row = self.a.app_settings
        settings_row.notifications = {**settings_row.notifications, "socialInteractions": False}
        settings_row.save()

        self.assertIsNone(notify(recipient=self.a, actor=self.b, kind="like", title="liked"))
        # A kind governed by a different switch still gets through.
        self.assertIsNotNone(
            notify(recipient=self.a, actor=self.b, kind="connection_accepted", title="accepted")
        )

    def test_repeat_events_fold_into_one_row_with_a_real_count(self):
        from journal.models import JournalEntry

        entry = JournalEntry.objects.create(owner=self.a, title="t", content="c")
        register_and_login(self.client, "chandra")
        c = User.objects.get(username="chandra")

        notify(recipient=self.a, actor=self.b, kind="like", title="liked your entry", target=entry)
        notify(recipient=self.a, actor=c, kind="like", title="liked your entry", target=entry)

        rows = Notification.objects.filter(recipient=self.a)
        self.assertEqual(rows.count(), 1)
        self.assertEqual(rows.first().actor_count, 2)

    def test_same_actor_twice_does_not_inflate_the_count(self):
        from journal.models import JournalEntry

        entry = JournalEntry.objects.create(owner=self.a, title="t", content="c")
        notify(recipient=self.a, actor=self.b, kind="like", title="liked your entry", target=entry)
        notify(recipient=self.a, actor=self.b, kind="like", title="liked your entry", target=entry)

        self.assertEqual(Notification.objects.get(recipient=self.a).actor_count, 1)


class NotificationApiTests(APITestCase):
    def setUp(self):
        self.a_token = register_and_login(self.client, "amara")
        self.b_token = register_and_login(self.client, "bishal")
        self.a = User.objects.get(username="amara")
        self.b = User.objects.get(username="bishal")
        notify(recipient=self.a, actor=self.b, kind="follow", title="started following you")

    def test_list_is_scoped_to_the_recipient(self):
        mine = self.client.get("/api/v1/notifications/", **auth(self.a_token))
        self.assertEqual(len(mine.data["notifications"]), 1)

        theirs = self.client.get("/api/v1/notifications/", **auth(self.b_token))
        self.assertEqual(len(theirs.data["notifications"]), 0)

    def test_counts_match_the_filter_tabs(self):
        response = self.client.get("/api/v1/notifications/", **auth(self.a_token))
        self.assertEqual(response.data["counts"]["all"], 1)
        self.assertEqual(response.data["counts"]["unread"], 1)
        self.assertEqual(response.data["counts"]["social"], 1)
        self.assertEqual(response.data["counts"]["engagement"], 0)

    def test_mark_read(self):
        notification = Notification.objects.get(recipient=self.a)
        response = self.client.post(
            f"/api/v1/notifications/{notification.id}/read/", **auth(self.a_token)
        )
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.data["isRead"])

    def test_cannot_touch_someone_elses_notification(self):
        notification = Notification.objects.get(recipient=self.a)
        response = self.client.post(
            f"/api/v1/notifications/{notification.id}/read/", **auth(self.b_token)
        )
        self.assertEqual(response.status_code, 404)

    def test_dismiss(self):
        notification = Notification.objects.get(recipient=self.a)
        self.client.delete(f"/api/v1/notifications/{notification.id}/", **auth(self.a_token))
        self.assertEqual(Notification.objects.count(), 0)

    def test_payload_matches_the_shape_the_screen_renders(self):
        response = self.client.get("/api/v1/notifications/", **auth(self.a_token))
        item = response.data["notifications"][0]
        for key in ("id", "type", "user", "userAvatar", "action", "time", "isRead", "category"):
            self.assertIn(key, item)


class RealActionNotificationTests(APITestCase):
    """The notifications a user actually experiences, produced by real
    endpoints rather than by calling notify() directly."""

    def setUp(self):
        self.a_token = register_and_login(self.client, "amara")
        self.b_token = register_and_login(self.client, "bishal")
        self.a = User.objects.get(username="amara")
        self.b = User.objects.get(username="bishal")

    def test_connection_request_notifies(self):
        self.client.post("/api/v1/social/requests/create/", {"username": "bishal"},
                          format="json", **auth(self.a_token))
        self.assertTrue(
            Notification.objects.filter(recipient=self.b, kind="connection_request").exists()
        )

    def test_comment_on_a_post_notifies_the_author(self):
        post = self.client.post("/api/v1/sanctuary/posts/", {"content": "hello"},
                                 format="json", **auth(self.a_token)).data
        self.client.post(f"/api/v1/sanctuary/posts/{post['id']}/comments/", {"content": "nice"},
                          format="json", **auth(self.b_token))
        self.assertTrue(Notification.objects.filter(recipient=self.a, kind="comment").exists())

    def test_like_notifies_the_author(self):
        post = self.client.post("/api/v1/sanctuary/posts/", {"content": "hello"},
                                 format="json", **auth(self.a_token)).data
        self.client.post(f"/api/v1/sanctuary/posts/{post['id']}/like/", **auth(self.b_token))
        self.assertTrue(Notification.objects.filter(recipient=self.a, kind="like").exists())

    def test_bookmark_is_private_and_notifies_nobody(self):
        post = self.client.post("/api/v1/sanctuary/posts/", {"content": "hello"},
                                 format="json", **auth(self.a_token)).data
        self.client.post(f"/api/v1/sanctuary/posts/{post['id']}/bookmark/", **auth(self.b_token))
        # Updated when achievement badges were added.
        #
        # 'a' now gets one notification for posting at all — the first-post
        # badge — which has nothing to do with b's bookmark. The point of
        # this test is that a bookmark is silent, so it excludes milestones
        # rather than asserting an empty inbox.
        self.assertEqual(
            Notification.objects.filter(recipient=self.a).exclude(kind="milestone").count(), 0
        )
