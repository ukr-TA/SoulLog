"""
Creating and delivering notifications.

The split spec §89 asks for, made concrete:

    notify()   decide → store          (this module, synchronous, in-request)
    deliver()  store  → open socket    (this module, best-effort)
    <future>   store  → APNs / FCM     (a new function here; nothing else changes)

Every call site in the codebase calls `notify()` and nothing else. That is
the whole point of the split: adding mobile push later is adding one
function below and one line inside `deliver()`.

Three rules `notify()` enforces so no caller has to remember them:

  * Never notify someone about their own action.
  * Never notify across a block.
  * Respect the recipient's own notification toggles in Settings. Those
    switches have existed in the UI since the beginning; this is the first
    thing that actually reads them.
"""

import logging

from django.contrib.contenttypes.models import ContentType
from django.db import transaction
from django.utils import timezone

from .models import Notification, NotificationKind

logger = logging.getLogger("soullog.notifications")

# How long a repeat event folds into an existing notification instead of
# creating a new row. Beyond this, "Sarah liked your entry" is news again.
DEDUPE_WINDOW_HOURS = 24


def _wants(recipient, kind):
    app_settings = getattr(recipient, "app_settings", None)
    if app_settings is None:
        return True

    prefs = app_settings.notifications or {}
    # "Notifications" (stored as pushEnabled) is the master switch. It used
    # to take both it *and* an email switch being off to silence anything,
    # but SoulLog sends no notification email, so the email switch has been
    # removed from Settings and this one alone decides.
    if not prefs.get("pushEnabled", True):
        # Switched off means the user has asked for nothing. The row is not
        # created — a silent pile-up they never asked
        # for is not more honest than not creating it.
        return False

    setting_key = NotificationKind.SETTING_KEY.get(kind)
    if setting_key is None:
        return True
    return bool(prefs.get(setting_key, True))


def notify(recipient, kind, title, body="", actor=None, target=None, target_label="", dedupe_key=None):
    """
    Create (or fold into) a notification and attempt live delivery.

    Returns the Notification, or None when it was suppressed. Callers do
    not need to check the return value — it exists for tests.
    """
    if actor is not None and actor.id == recipient.id:
        return None

    if actor is not None:
        from social.relations import is_blocked_between

        if is_blocked_between(actor, recipient):
            return None

    if not _wants(recipient, kind):
        return None

    target_type = target_id = None
    if target is not None:
        target_type = ContentType.objects.get_for_model(target)
        target_id = target.pk

    if dedupe_key is None and target is not None:
        dedupe_key = f"{kind}:{target_type.id}:{target_id}"

    notification = None
    if dedupe_key:
        cutoff = timezone.now() - timezone.timedelta(hours=DEDUPE_WINDOW_HOURS)
        notification = (
            Notification.objects.filter(
                recipient=recipient, dedupe_key=dedupe_key, created_at__gte=cutoff
            )
            .order_by("-created_at")
            .first()
        )

    if notification is not None:
        # A different person doing the same thing to the same object folds
        # into the existing row and bumps the count. The same person doing
        # it twice (unlike then like again) does not inflate anything.
        if actor is not None and notification.actor_id != actor.id:
            notification.actor_count += 1
            notification.actor = actor
        notification.title = title
        notification.body = body
        notification.is_read = False
        notification.read_at = None
        notification.save()
    else:
        notification = Notification.objects.create(
            recipient=recipient,
            actor=actor,
            kind=kind,
            title=title,
            body=body,
            target_label=target_label,
            target_type=target_type,
            target_id=target_id,
            dedupe_key=dedupe_key or "",
        )

    # Deliver after the surrounding transaction commits. Pushing a
    # notification for a row that then gets rolled back is the classic way
    # to show someone a comment that doesn't exist.
    transaction.on_commit(lambda: deliver(notification))
    return notification


def deliver(notification):
    """
    Push an already-stored notification to the recipient's open sockets.

    Best-effort by design: a failure here must never fail the user action
    that caused it. The notification is already in the database, so the
    recipient still sees it on their next fetch — live delivery is an
    optimisation on top of a durable store, not the store itself.
    """
    try:
        from asgiref.sync import async_to_sync
        from channels.layers import get_channel_layer

        from .serializers import serialize_notification

        channel_layer = get_channel_layer()
        if channel_layer is None:
            return

        async_to_sync(channel_layer.group_send)(
            user_group(notification.recipient_id),
            {"type": "notification.message", "payload": serialize_notification(notification)},
        )
    except Exception:  # noqa: BLE001 — deliberately swallowed, see docstring
        logger.warning("Live notification delivery failed", exc_info=True)


def user_group(user_id):
    """The channel group name for one user's devices."""
    return f"notifications.user.{user_id}"


def unread_count(user):
    return Notification.objects.filter(recipient=user, is_read=False).count()
