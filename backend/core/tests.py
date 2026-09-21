"""
Tests for the shared editing rules in `core.editing`.

These cover the promises the module makes rather than each of the four
call sites separately: only the author may edit, an edit is visible,
deleted text stays deleted, and the window expires. The journal comment
endpoint stands in for the REST surface; the same helper backs Sanctuary
comments, library comments and messages, and the per-app tests check that
each one is wired to it.
"""

from datetime import timedelta

from django.utils import timezone
from rest_framework.test import APITestCase

from journal.models import JournalComment, JournalEntry
from journal.tests import auth_header, register_and_login


class CommentEditingTests(APITestCase):
    def setUp(self):
        from users.models import User

        self.author_token = register_and_login(self.client, "author")
        self.other_token = register_and_login(self.client, "other")
        self.author = User.objects.get(username="author")
        self.other = User.objects.get(username="other")

        self.entry = JournalEntry.objects.create(
            owner=self.author, title="shared", content="c", visibility="community"
        )
        self.comment = JournalComment.objects.create(
            entry=self.entry, author=self.author, content="orignal typo"
        )

    def url(self):
        return f"/api/v1/journal/{self.entry.id}/comments/{self.comment.id}/"

    def test_author_can_edit_and_the_edit_is_marked(self):
        response = self.client.patch(
            self.url(), {"content": "original, fixed"},
            format="json", **auth_header(self.author_token),
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["content"], "original, fixed")
        # Visible, not silent: the UI shows 'edited' from this field.
        self.assertIsNotNone(response.data["editedAt"])

        self.comment.refresh_from_db()
        self.assertEqual(self.comment.content, "original, fixed")

    def test_someone_else_cannot_edit_it(self):
        response = self.client.patch(
            self.url(), {"content": "words I did not write"},
            format="json", **auth_header(self.other_token),
        )
        self.assertIn(response.status_code, (403, 404))
        self.comment.refresh_from_db()
        self.assertEqual(self.comment.content, "orignal typo")

    def test_empty_text_is_refused(self):
        response = self.client.patch(
            self.url(), {"content": "   "}, format="json", **auth_header(self.author_token)
        )
        self.assertEqual(response.status_code, 400)
        self.comment.refresh_from_db()
        self.assertEqual(self.comment.content, "orignal typo")

    def test_the_window_expires(self):
        JournalComment.objects.filter(pk=self.comment.pk).update(
            created_at=timezone.now() - timedelta(days=30)
        )
        response = self.client.patch(
            self.url(), {"content": "much later"},
            format="json", **auth_header(self.author_token),
        )
        self.assertEqual(response.status_code, 400)


class MessageEditingTests(APITestCase):
    """The socket-backed call site: editing must also reach the other side."""

    def setUp(self):
        from users.models import User

        self.a_token = register_and_login(self.client, "alpha")
        self.b_token = register_and_login(self.client, "beta")
        self.beta = User.objects.get(username="beta")

        conversation = self.client.post(
            "/api/v1/messages/conversations/", {"user_id": self.beta.id},
            format="json", **auth_header(self.a_token),
        ).data
        self.conversation_id = conversation["id"]
        self.message = self.client.post(
            f"/api/v1/messages/conversations/{self.conversation_id}/messages/",
            {"body": "see you at 6"}, format="json", **auth_header(self.a_token),
        ).data

    def url(self):
        return (
            f"/api/v1/messages/conversations/{self.conversation_id}"
            f"/messages/{self.message['id']}/"
        )

    def test_sender_can_correct_a_message(self):
        response = self.client.patch(
            self.url(), {"body": "see you at 7"},
            format="json", **auth_header(self.a_token),
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["text"], "see you at 7")
        self.assertIsNotNone(response.data["editedAt"])

    def test_recipient_cannot_edit_it(self):
        response = self.client.patch(
            self.url(), {"body": "see you never"},
            format="json", **auth_header(self.b_token),
        )
        self.assertIn(response.status_code, (403, 404))

    def test_a_deleted_message_cannot_be_edited_back(self):
        self.client.delete(self.url(), **auth_header(self.a_token))
        response = self.client.patch(
            self.url(), {"body": "undelete me"},
            format="json", **auth_header(self.a_token),
        )
        self.assertEqual(response.status_code, 400)
