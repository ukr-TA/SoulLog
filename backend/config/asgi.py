"""
ASGI entry point.

HTTP is served exactly as before; WebSocket connections are routed to the
Channels consumers that back Whispers (live messages, typing indicators)
and live notification delivery.

Authentication over WebSocket uses the same JWT access token the REST API
uses — passed as a `?token=` query parameter, because browsers cannot set
an Authorization header on a WebSocket handshake. See
`users.ws_auth.JWTAuthMiddleware` for the validation, which is the same
simplejwt validation the REST layer performs, not a parallel weaker one.
"""

import os

from django.core.asgi import get_asgi_application

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")

# The HTTP application must be built before anything imports models, because
# importing models before app registry population raises AppRegistryNotReady.
django_asgi_app = get_asgi_application()

from channels.routing import ProtocolTypeRouter, URLRouter  # noqa: E402
from channels.security.websocket import AllowedHostsOriginValidator  # noqa: E402
from django.urls import path  # noqa: E402

from messaging.consumers import ConversationConsumer  # noqa: E402
from notifications.consumers import NotificationConsumer  # noqa: E402
from users.ws_auth import JWTAuthMiddleware  # noqa: E402

websocket_urlpatterns = [
    path("ws/notifications/", NotificationConsumer.as_asgi()),
    path("ws/conversations/<int:conversation_id>/", ConversationConsumer.as_asgi()),
]

application = ProtocolTypeRouter({
    "http": django_asgi_app,
    "websocket": AllowedHostsOriginValidator(
        JWTAuthMiddleware(URLRouter(websocket_urlpatterns))
    ),
})
