"""
The notification WebSocket.

    ws://<host>/ws/notifications/?token=<access token>

One group per user, so a person signed in on a laptop and a phone gets the
notification on both. The consumer is intentionally almost empty: it sends,
it does not decide. Everything about *whether* a notification exists was
settled in `services.notify()` before this code ever runs, which keeps the
socket layer from becoming a second, subtly different permission check.
"""

import json

from channels.generic.websocket import AsyncWebsocketConsumer

from .services import user_group


class NotificationConsumer(AsyncWebsocketConsumer):
    async def connect(self):
        user = self.scope.get("user")

        if user is None or not user.is_authenticated:
            # Accept, then close with 4401 — rather than refusing the
            # handshake, which is the obvious thing to do and is wrong.
            #
            # A rejected handshake reaches a browser as a CloseEvent with
            # code 1006 ("abnormal closure") and no detail, indistinguishable
            # from the wifi dropping. The client then retries forever with a
            # token that will never work. Accepting first means the close
            # code survives, so the client can tell "your token is bad, stop
            # and refresh it" from "the network blipped, try again".
            await self.accept()
            await self.send(json.dumps({"type": "error", "detail": "Authentication failed."}))
            await self.close(code=4401)
            return

        self.group_name = user_group(user.id)
        await self.channel_layer.group_add(self.group_name, self.channel_name)
        await self.accept()

        await self.send(json.dumps({
            "type": "connected",
            "unread": await self._unread_count(user),
        }))

    async def disconnect(self, code):
        group = getattr(self, "group_name", None)
        if group:
            await self.channel_layer.group_discard(group, self.channel_name)

    async def receive(self, text_data=None, bytes_data=None):
        """
        The client only ever needs to say "still here". Anything else is
        ignored rather than parsed — this socket is a delivery channel, not
        a second API surface where an action could bypass the REST
        permission checks.
        """
        try:
            message = json.loads(text_data or "{}")
        except json.JSONDecodeError:
            return
        if message.get("type") == "ping":
            await self.send(json.dumps({"type": "pong"}))

    async def unread_changed(self, event):
        """A new direct message: the app refreshes its Whispers badge."""
        await self.send(json.dumps({"type": "unread"}))

    async def notification_message(self, event):
        await self.send(json.dumps({"type": "notification", "notification": event["payload"]}))

    @staticmethod
    async def _unread_count(user):
        from channels.db import database_sync_to_async

        from .models import Notification

        return await database_sync_to_async(
            Notification.objects.filter(recipient=user, is_read=False).count
        )()
