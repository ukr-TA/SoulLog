"""
The conversation WebSocket.

    ws://<host>/ws/conversations/<id>/?token=<access token>

Carries three things REST cannot: a message arriving without the client
asking, a typing indicator, and a read receipt landing while you watch.

Sending a message over this socket is supported and goes through exactly
the same `services.send_message()` the REST endpoint uses — including the
recipient's `allowMessages` check and the block check. There is no shortcut
here that skips a permission the HTTP path enforces; that is the single
most important property of this file.

Typing indicators are not stored anywhere. They are relayed to the other
participants and forgotten, which is the only honest way to represent
something that is true for about two seconds.
"""

import json

from channels.db import database_sync_to_async
from channels.generic.websocket import AsyncWebsocketConsumer

from .services import conversation_group


class ConversationConsumer(AsyncWebsocketConsumer):
    async def connect(self):
        user = self.scope.get("user")

        # Both refusals accept the socket first and then close with a
        # specific code. Refusing the handshake instead would reach the
        # browser as a bare code 1006, which is what a dropped connection
        # also looks like — and the client would retry a request that can
        # never succeed. See the note in notifications/consumers.py.
        if user is None or not user.is_authenticated:
            await self.accept()
            await self.send(json.dumps({"type": "error", "detail": "Authentication failed."}))
            await self.close(code=4401)
            return

        self.conversation_id = self.scope["url_route"]["kwargs"]["conversation_id"]

        if not await self._is_participant(self.conversation_id, user):
            # 4403: authenticated, but not a member of this conversation.
            await self.accept()
            await self.send(json.dumps({"type": "error", "detail": "Not your conversation."}))
            await self.close(code=4403)
            return

        self.group_name = conversation_group(self.conversation_id)
        await self.channel_layer.group_add(self.group_name, self.channel_name)
        await self.accept()
        await self.send(json.dumps({"type": "connected", "conversationId": self.conversation_id}))

    async def disconnect(self, code):
        group = getattr(self, "group_name", None)
        if group:
            # Clear any lingering typing state for this user so a dropped
            # connection doesn't leave "Sarah is typing…" on screen forever.
            await self.channel_layer.group_send(
                group,
                {
                    "type": "conversation.event",
                    "event": "typing",
                    "payload": {"userId": self.scope["user"].id, "typing": False},
                },
            )
            await self.channel_layer.group_discard(group, self.channel_name)

    async def receive(self, text_data=None, bytes_data=None):
        try:
            message = json.loads(text_data or "{}")
        except json.JSONDecodeError:
            return

        kind = message.get("type")
        user = self.scope["user"]

        if kind == "ping":
            await self.send(json.dumps({"type": "pong"}))

        elif kind == "typing":
            await self.channel_layer.group_send(
                self.group_name,
                {
                    "type": "conversation.event",
                    "event": "typing",
                    "payload": {
                        "userId": user.id,
                        "name": user.fullname or user.username,
                        "typing": bool(message.get("typing", True)),
                    },
                },
            )

        elif kind == "message":
            body = (message.get("body") or "").strip()
            if not body:
                return
            error = await self._send_message(self.conversation_id, user, body)
            if error:
                await self.send(json.dumps({"type": "error", "detail": error}))

        elif kind == "read":
            await self._mark_read(self.conversation_id, user)
            await self.channel_layer.group_send(
                self.group_name,
                {
                    "type": "conversation.event",
                    "event": "read",
                    "payload": {"userId": user.id},
                },
            )

    async def conversation_event(self, event):
        payload = event["payload"]
        # "read" tells the *other* person their messages were seen. Sent
        # back to the reader too, it wrongly ticked the reader's own
        # messages as read.
        if (
            event["event"] == "read"
            and isinstance(payload, dict)
            and payload.get("userId") == self.scope["user"].id
        ):
            return
        # A message is serialised once, from the sender's point of view, and
        # sent to everyone in the conversation. Re-label "me"/"them" for the
        # person this socket belongs to — otherwise the receiver saw the
        # other person's messages as their own (right-hand side, "Edit").
        if isinstance(payload, dict) and "senderId" in payload:
            payload = {
                **payload,
                "sender": "me" if payload["senderId"] == self.scope["user"].id else "them",
            }
        await self.send(json.dumps({"type": event["event"], **{"data": payload}}))

    # --- database access ----------------------------------------------------

    @staticmethod
    @database_sync_to_async
    def _is_participant(conversation_id, user):
        from .models import Conversation
        from .services import is_participant

        conversation = Conversation.objects.filter(pk=conversation_id).first()
        return conversation is not None and is_participant(conversation, user)

    @staticmethod
    @database_sync_to_async
    def _send_message(conversation_id, user, body):
        """Returns an error string, or None on success."""
        from social.relations import can_message

        from .models import Conversation
        from .services import send_message

        conversation = Conversation.objects.filter(pk=conversation_id).first()
        if conversation is None:
            return "That conversation no longer exists."

        if conversation.is_direct:
            other = conversation.other_participant(user)
            if other is not None:
                allowed, reason = can_message(user, other)
                if not allowed:
                    return reason

        send_message(conversation, user, body)
        return None

    @staticmethod
    @database_sync_to_async
    def _mark_read(conversation_id, user):
        from .models import Conversation
        from .services import mark_read

        conversation = Conversation.objects.filter(pk=conversation_id).first()
        if conversation is not None:
            mark_read(conversation, user)
