"""
JWT authentication for WebSocket connections.

A browser cannot attach an `Authorization` header to a WebSocket handshake,
so the access token travels as a query parameter instead. That is the only
difference from the REST path — the token itself is validated by the exact
same simplejwt machinery (`JWTAuthentication.get_validated_token`), so an
expired, tampered or revoked token is rejected here for the same reasons it
would be rejected on an HTTP request. There is deliberately no second,
looser code path for sockets.

Connections that fail authentication get `AnonymousUser`; every consumer
closes immediately on an anonymous user rather than serving anything.
"""

from urllib.parse import parse_qs

from channels.db import database_sync_to_async
from channels.middleware import BaseMiddleware
from django.contrib.auth.models import AnonymousUser


@database_sync_to_async
def _user_from_token(raw_token):
    from rest_framework_simplejwt.authentication import JWTAuthentication
    from rest_framework_simplejwt.exceptions import InvalidToken, TokenError

    authenticator = JWTAuthentication()
    try:
        validated = authenticator.get_validated_token(raw_token)
        return authenticator.get_user(validated)
    except (InvalidToken, TokenError, KeyError):
        return AnonymousUser()


class JWTAuthMiddleware(BaseMiddleware):
    """Populates `scope['user']` from a `?token=<access token>` query param."""

    async def __call__(self, scope, receive, send):
        query = parse_qs((scope.get("query_string") or b"").decode())
        tokens = query.get("token") or []

        scope["user"] = await _user_from_token(tokens[0]) if tokens else AnonymousUser()
        return await super().__call__(scope, receive, send)
