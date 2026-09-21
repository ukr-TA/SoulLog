"""
Presence tracking.

Whispers used to render a hardcoded "Active now" label under every
conversation. That was the honest-to-flag kind of fake: it looked like
information and was not. This middleware is what makes it real — it stamps
`User.last_seen` on authenticated requests, and `UserProfile`/messaging
serializers derive presence from that timestamp plus
`settings.PRESENCE_ACTIVE_WINDOW_SECONDS`.

Two deliberate limits:

  * The write is throttled to at most once per `WRITE_INTERVAL` seconds per
    user. Without that, every single API request would issue an UPDATE, which
    is a lot of write traffic to learn something we only display to
    minute-level precision.
  * A user who has switched `social.onlineStatus` off in Settings still has
    `last_seen` recorded (it is needed for "last active" ordering of their
    own conversations), but no other user is ever shown their presence — that
    filtering happens at serialization time, in `users.presence`.
"""

from django.utils import timezone


class LastSeenMiddleware:
    WRITE_INTERVAL_SECONDS = 60

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        response = self.get_response(request)

        user = getattr(request, "user", None)
        if user is not None and user.is_authenticated:
            now = timezone.now()
            last = user.last_seen
            if last is None or (now - last).total_seconds() >= self.WRITE_INTERVAL_SECONDS:
                # update() rather than save() so this never fires signals or
                # races with a concurrent profile update on the same row.
                type(user).objects.filter(pk=user.pk).update(last_seen=now)

        return response
