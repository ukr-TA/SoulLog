"""
Whispers: participation, permission, unread state, and presence.

Including a real WebSocket test, because a consumer that only ever runs in
production is a consumer nobody has checked. The socket test asserts the
thing that matters most: that it enforces the same permission the HTTP
endpoint does, rather than being a quiet way around it.
"""

from asgiref.sync import async_to_sync
from django.test import TransactionTestCase
from rest_framework.test import APITestCase

from social.models import Connection
from users.models import User

from .models import Conversation, Message
from .services import get_or_create_direct, total_unread, unread_count_for


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


class ConversationTests(APITestCase):
    def setUp(self):
        self.a_token = register_and_login(self.client, "amara")
        self.b_token = register_and_login(self.client, "bishal")
        self.c_token = register_and_login(self.client, "chandra")
        self.a = User.objects.get(username="amara")
        self.b = User.objects.get(username="bishal")

    def test_opening_a_conversation_twice_reuses_the_same_thread(self):
        first = self.client.post("/api/v1/messages/conversations/", {"username": "bishal"},
                                  format="json", **auth(self.a_token))
        second = self.client.post("/api/v1/messages/conversations/", {"username": "bishal"},
                                   format="json", **auth(self.a_token))
        self.assertEqual(first.data["id"], second.data["id"])
        self.assertEqual(Conversation.objects.count(), 1)

    def test_either_side_opening_it_finds_the_same_thread(self):
        first = self.client.post("/api/v1/messages/conversations/", {"username": "bishal"},
                                  format="json", **auth(self.a_token))
        second = self.client.post("/api/v1/messages/conversations/", {"username": "amara"},
                                   format="json", **auth(self.b_token))
        self.assertEqual(first.data["id"], second.data["id"])

    def test_non_participant_gets_404_not_403(self):
        conversation = self.client.post("/api/v1/messages/conversations/", {"username": "bishal"},
                                         format="json", **auth(self.a_token)).data
        response = self.client.get(f"/api/v1/messages/conversations/{conversation['id']}/",
                                    **auth(self.c_token))
        self.assertEqual(response.status_code, 404)

    def test_non_participant_cannot_send_into_it(self):
        conversation = self.client.post("/api/v1/messages/conversations/", {"username": "bishal"},
                                         format="json", **auth(self.a_token)).data
        response = self.client.post(
            f"/api/v1/messages/conversations/{conversation['id']}/messages/",
            {"body": "intruding"}, format="json", **auth(self.c_token)
        )
        self.assertEqual(response.status_code, 404)
        self.assertEqual(Message.objects.count(), 0)

    def test_empty_message_is_refused(self):
        conversation = self.client.post("/api/v1/messages/conversations/", {"username": "bishal"},
                                         format="json", **auth(self.a_token)).data
        response = self.client.post(
            f"/api/v1/messages/conversations/{conversation['id']}/messages/",
            {"body": "   "}, format="json", **auth(self.a_token)
        )
        self.assertEqual(response.status_code, 400)

    def test_recipient_settings_are_rechecked_on_every_send(self):
        """The thread was opened when messages were allowed. Tightening the
        setting afterwards has to take effect immediately, not at the next
        conversation."""
        conversation = self.client.post("/api/v1/messages/conversations/", {"username": "bishal"},
                                         format="json", **auth(self.a_token)).data

        self.b.profile.allow_messages = "nobody"
        self.b.profile.save()

        response = self.client.post(
            f"/api/v1/messages/conversations/{conversation['id']}/messages/",
            {"body": "hello?"}, format="json", **auth(self.a_token)
        )
        self.assertEqual(response.status_code, 403)

    def test_cannot_open_a_conversation_with_someone_who_refuses(self):
        self.b.profile.allow_messages = "connections"
        self.b.profile.save()
        response = self.client.post("/api/v1/messages/conversations/", {"username": "bishal"},
                                     format="json", **auth(self.a_token))
        self.assertEqual(response.status_code, 403)

        Connection.objects.create(requester=self.a, addressee=self.b, status=Connection.ACCEPTED)
        allowed = self.client.post("/api/v1/messages/conversations/", {"username": "bishal"},
                                    format="json", **auth(self.a_token))
        self.assertEqual(allowed.status_code, 201)

    def test_own_message_is_marked_me_and_the_other_side_sees_them(self):
        conversation = self.client.post("/api/v1/messages/conversations/", {"username": "bishal"},
                                         format="json", **auth(self.a_token)).data
        self.client.post(f"/api/v1/messages/conversations/{conversation['id']}/messages/",
                          {"body": "hello"}, format="json", **auth(self.a_token))

        mine = self.client.get(f"/api/v1/messages/conversations/{conversation['id']}/",
                                **auth(self.a_token))
        self.assertEqual(mine.data["messages"][0]["sender"], "me")

        theirs = self.client.get(f"/api/v1/messages/conversations/{conversation['id']}/",
                                  **auth(self.b_token))
        self.assertEqual(theirs.data["messages"][0]["sender"], "them")

    def test_deleting_your_own_message_blanks_it_for_everyone(self):
        conversation = self.client.post("/api/v1/messages/conversations/", {"username": "bishal"},
                                         format="json", **auth(self.a_token)).data
        message = self.client.post(
            f"/api/v1/messages/conversations/{conversation['id']}/messages/",
            {"body": "oops"}, format="json", **auth(self.a_token)
        ).data

        self.client.delete(
            f"/api/v1/messages/conversations/{conversation['id']}/messages/{message['id']}/",
            **auth(self.a_token)
        )
        theirs = self.client.get(f"/api/v1/messages/conversations/{conversation['id']}/",
                                  **auth(self.b_token))
        self.assertEqual(theirs.data["messages"][0]["text"], "This message was deleted")

    def test_cannot_delete_someone_elses_message(self):
        conversation = self.client.post("/api/v1/messages/conversations/", {"username": "bishal"},
                                         format="json", **auth(self.a_token)).data
        message = self.client.post(
            f"/api/v1/messages/conversations/{conversation['id']}/messages/",
            {"body": "mine"}, format="json", **auth(self.a_token)
        ).data
        response = self.client.delete(
            f"/api/v1/messages/conversations/{conversation['id']}/messages/{message['id']}/",
            **auth(self.b_token)
        )
        self.assertEqual(response.status_code, 404)


class UnreadTests(APITestCase):
    def setUp(self):
        self.a_token = register_and_login(self.client, "amara")
        self.b_token = register_and_login(self.client, "bishal")
        self.a = User.objects.get(username="amara")
        self.b = User.objects.get(username="bishal")
        self.conversation, _ = get_or_create_direct(self.a, self.b)

    def test_your_own_messages_are_never_unread_for_you(self):
        Message.objects.create(conversation=self.conversation, sender=self.a, body="hi")
        self.assertEqual(unread_count_for(self.conversation, self.a), 0)
        self.assertEqual(unread_count_for(self.conversation, self.b), 1)

    def test_opening_the_conversation_marks_it_read(self):
        Message.objects.create(conversation=self.conversation, sender=self.a, body="hi")
        self.assertEqual(total_unread(self.b), 1)

        self.client.get(f"/api/v1/messages/conversations/{self.conversation.id}/",
                         **auth(self.b_token))
        self.assertEqual(total_unread(self.b), 0)


class PresenceTests(APITestCase):
    def setUp(self):
        self.a_token = register_and_login(self.client, "amara")
        self.b_token = register_and_login(self.client, "bishal")
        self.a = User.objects.get(username="amara")
        self.b = User.objects.get(username="bishal")

    def test_presence_reflects_real_activity_not_a_hardcoded_label(self):
        from users.presence import presence_for

        self.assertEqual(presence_for(self.b, self.a)["status"], "never")

        # Any authenticated request stamps last_seen via the middleware.
        self.client.get("/api/v1/auth/me", **auth(self.b_token))
        self.b.refresh_from_db()
        self.assertEqual(presence_for(self.b, self.a)["status"], "active")

    def test_online_status_setting_hides_presence_from_others_only(self):
        from users.presence import presence_for

        self.client.get("/api/v1/auth/me", **auth(self.b_token))
        self.b.refresh_from_db()

        settings_row = self.b.app_settings
        settings_row.social = {**settings_row.social, "onlineStatus": False}
        settings_row.save()
        self.b.refresh_from_db()

        self.assertEqual(presence_for(self.b, self.a)["status"], "hidden")
        self.assertIsNone(presence_for(self.b, self.a)["last_seen"])
        # They can still see themselves.
        self.assertEqual(presence_for(self.b, self.b)["status"], "active")


class WebSocketTests(TransactionTestCase):
    """
    The live layer, exercised for real through Channels' communicator.

    `TransactionTestCase`, not `TestCase`: the consumer runs in a different
    thread from the test, so rows created inside `TestCase`'s wrapping
    transaction would be invisible to it. This is the standard cost of
    testing async consumers against a real database, and worth paying —
    a consumer that is only ever exercised in production is a consumer
    nobody has checked.

    Uses the in-memory channel layer, which is what a developer running
    this locally without Redis also gets, so these tests cover the same
    code path as `manage.py runserver`.
    """

    def setUp(self):
        self.a = User.objects.create_user(
            username="amara", email="amara@example.com", password="SuperSecure123"
        )
        self.b = User.objects.create_user(
            username="bishal", email="bishal@example.com", password="SuperSecure123"
        )
        self.c = User.objects.create_user(
            username="chandra", email="chandra@example.com", password="SuperSecure123"
        )
        self.conversation, _ = get_or_create_direct(self.a, self.b)

    @staticmethod
    def _token_for(user):
        from rest_framework_simplejwt.tokens import RefreshToken

        return str(RefreshToken.for_user(user).access_token)

    def _communicator(self, user, conversation_id=None):
        from channels.testing import WebsocketCommunicator

        from config.asgi import application

        conversation_id = conversation_id or self.conversation.id
        return WebsocketCommunicator(
            application,
            f"/ws/conversations/{conversation_id}/?token={self._token_for(user)}",
            headers=[(b"origin", b"http://localhost"), (b"host", b"localhost")],
        )

    def test_participant_connects_and_receives_a_live_message(self):
        async def scenario():
            from channels.db import database_sync_to_async

            from .services import send_message

            communicator = self._communicator(self.b)
            connected, _ = await communicator.connect()
            self.assertTrue(connected)
            await communicator.receive_json_from()  # the 'connected' frame

            await database_sync_to_async(send_message)(self.conversation, self.a, "live hello")

            event = await communicator.receive_json_from(timeout=5)
            self.assertEqual(event["type"], "message")
            self.assertEqual(event["data"]["text"], "live hello")

            await communicator.disconnect()

        async_to_sync(scenario)()

    def test_unauthenticated_socket_is_closed(self):
        async def scenario():
            from channels.testing import WebsocketCommunicator

            from config.asgi import application

            communicator = WebsocketCommunicator(
                application,
                f"/ws/conversations/{self.conversation.id}/",
                headers=[(b"origin", b"http://localhost"), (b"host", b"localhost")],
            )
            # The socket is accepted so the close code can reach the
            # client, then closed with 4401. A refused handshake would
            # arrive as a bare 1006 and the client would retry forever.
            connected, _ = await communicator.connect()
            self.assertTrue(connected)

            error = await communicator.receive_json_from(timeout=5)
            self.assertEqual(error["type"], "error")

            close = await communicator.receive_output(timeout=5)
            self.assertEqual(close["type"], "websocket.close")
            self.assertEqual(close["code"], 4401)

        async_to_sync(scenario)()

    def test_non_participant_socket_is_closed(self):
        async def scenario():
            communicator = self._communicator(self.c)
            connected, _ = await communicator.connect()
            self.assertTrue(connected)

            error = await communicator.receive_json_from(timeout=5)
            self.assertEqual(error["type"], "error")

            close = await communicator.receive_output(timeout=5)
            self.assertEqual(close["type"], "websocket.close")
            self.assertEqual(close["code"], 4403)

        async_to_sync(scenario)()

    def test_typing_is_relayed_and_never_stored(self):
        async def scenario():
            listener = self._communicator(self.b)
            await listener.connect()
            await listener.receive_json_from()

            typer = self._communicator(self.a)
            await typer.connect()
            await typer.receive_json_from()

            await typer.send_json_to({"type": "typing", "typing": True})
            event = await listener.receive_json_from(timeout=5)
            self.assertEqual(event["type"], "typing")
            self.assertTrue(event["data"]["typing"])

            await typer.disconnect()
            await listener.disconnect()

        async_to_sync(scenario)()
        # Nothing about typing is persisted anywhere — that's the point.
        self.assertEqual(Message.objects.count(), 0)

    def test_socket_send_enforces_the_same_permission_as_http(self):
        """The most important assertion in this file: the WebSocket is not
        a back door around `allowMessages`."""
        profile = self.b.profile
        profile.allow_messages = "nobody"
        profile.save()

        async def scenario():
            communicator = self._communicator(self.a)
            await communicator.connect()
            await communicator.receive_json_from()

            await communicator.send_json_to({"type": "message", "body": "let me in"})
            event = await communicator.receive_json_from(timeout=5)
            self.assertEqual(event["type"], "error")

            await communicator.disconnect()

        async_to_sync(scenario)()
        self.assertEqual(Message.objects.count(), 0)

    def test_socket_send_stores_and_broadcasts_when_permitted(self):
        async def scenario():
            listener = self._communicator(self.b)
            await listener.connect()
            await listener.receive_json_from()

            sender = self._communicator(self.a)
            await sender.connect()
            await sender.receive_json_from()

            await sender.send_json_to({"type": "message", "body": "sent over the socket"})
            event = await listener.receive_json_from(timeout=5)
            self.assertEqual(event["data"]["text"], "sent over the socket")
            # Each side sees it from their own point of view. The receiver
            # used to be told "me", so the other person's message appeared
            # as their own.
            self.assertEqual(event["data"]["sender"], "them")
            own = await sender.receive_json_from(timeout=5)
            self.assertEqual(own["data"]["sender"], "me")

            await sender.disconnect()
            await listener.disconnect()

        async_to_sync(scenario)()
        self.assertEqual(Message.objects.filter(body="sent over the socket").count(), 1)


class NotificationSocketTests(TransactionTestCase):
    def setUp(self):
        self.a = User.objects.create_user(
            username="amara", email="amara@example.com", password="SuperSecure123"
        )
        self.b = User.objects.create_user(
            username="bishal", email="bishal@example.com", password="SuperSecure123"
        )

    def test_notification_arrives_over_the_socket(self):
        async def scenario():
            from channels.db import database_sync_to_async
            from channels.testing import WebsocketCommunicator
            from rest_framework_simplejwt.tokens import RefreshToken

            from config.asgi import application
            from notifications.services import notify

            token = str(RefreshToken.for_user(self.a).access_token)
            communicator = WebsocketCommunicator(
                application,
                f"/ws/notifications/?token={token}",
                headers=[(b"origin", b"http://localhost"), (b"host", b"localhost")],
            )
            connected, _ = await communicator.connect()
            self.assertTrue(connected)
            await communicator.receive_json_from()  # 'connected'

            await database_sync_to_async(notify)(
                recipient=self.a, actor=self.b, kind="follow", title="started following you"
            )

            event = await communicator.receive_json_from(timeout=5)
            self.assertEqual(event["type"], "notification")
            self.assertEqual(event["notification"]["type"], "follow")

            await communicator.disconnect()

        async_to_sync(scenario)()


class MessagesAndNotificationsTests(APITestCase):
    def setUp(self):
        self.a = User.objects.create_user(username="nira", email="nira@example.com", password="SuperSecure123")
        self.b = User.objects.create_user(username="om", email="om@example.com", password="SuperSecure123")
        self.conversation, _ = get_or_create_direct(self.a, self.b)

    def test_a_message_creates_no_notification(self):
        from notifications.models import Notification

        from .services import send_message

        send_message(self.conversation, self.a, "hello")
        self.assertFalse(Notification.objects.filter(recipient=self.b).exists())
        self.assertEqual(total_unread(self.b), 1)

    def test_a_muted_conversation_leaves_the_whispers_badge_alone(self):
        from .models import ConversationParticipant
        from .services import send_message

        ConversationParticipant.objects.filter(conversation=self.conversation, user=self.b).update(is_muted=True)
        send_message(self.conversation, self.a, "hello")
        self.assertEqual(total_unread(self.b), 0)
        self.assertEqual(unread_count_for(self.conversation, self.b), 1)
