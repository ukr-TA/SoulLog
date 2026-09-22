"""
Conversation helpers and live message fan-out.

Same shape as the notifications app: the database write is the source of
truth, and the WebSocket push is a best-effort optimisation on top of it. A
client that misses a push still sees the message on its next fetch, so a
Redis hiccup loses a little latency and never loses a message.
"""

import logging

from django.db import transaction
from django.db.models import Count, Q
from django.utils import timezone

from .models import Conversation, ConversationParticipant, Message

logger = logging.getLogger("soullog.messaging")


def conversation_group(conversation_id):
    return f"conversation.{conversation_id}"


def participants_of(conversation):
    return ConversationParticipant.objects.filter(
        conversation=conversation, left_at__isnull=True
    ).select_related("user", "user__profile", "user__app_settings")


def is_participant(conversation, user):
    return ConversationParticipant.objects.filter(
        conversation=conversation, user=user, left_at__isnull=True
    ).exists()


def get_or_create_direct(user, other):
    """
    The single direct conversation between two people, created if needed.

    Finding it is an aggregate rather than a pair of `filter(user=...)`
    calls chained together: a naive chained filter matches any conversation
    containing *either* person, which for group threads is wrong. Counting
    participants and requiring exactly two, both of whom are the people we
    want, is correct for every case.
    """
    existing = (
        Conversation.objects.filter(is_direct=True, participants__user__in=[user, other])
        .annotate(
            total=Count("participants", distinct=True),
            matched=Count(
                "participants",
                filter=Q(participants__user__in=[user, other]),
                distinct=True,
            ),
        )
        .filter(total=2, matched=2)
        .first()
    )
    if existing is not None:
        # Someone who left under the old "Leave conversation" is back in.
        ConversationParticipant.objects.filter(
            conversation=existing, user__in=[user, other], left_at__isnull=False
        ).update(left_at=None)
        return existing, False

    with transaction.atomic():
        conversation = Conversation.objects.create(is_direct=True, created_by=user)
        ConversationParticipant.objects.create(conversation=conversation, user=user)
        ConversationParticipant.objects.create(conversation=conversation, user=other)
    return conversation, True


def unread_count_for(conversation, user):
    membership = ConversationParticipant.objects.filter(
        conversation=conversation, user=user
    ).first()
    if membership is None:
        return 0

    queryset = Message.objects.filter(conversation=conversation, is_deleted=False).exclude(
        sender=user
    )
    if membership.cleared_at is not None:
        queryset = queryset.filter(created_at__gt=membership.cleared_at)
    if membership.last_read_at is not None:
        queryset = queryset.filter(created_at__gt=membership.last_read_at)
    return queryset.count()


def total_unread(user):
    """
    The badge on the Whispers nav item. A muted conversation doesn't count
    towards it — that's what muting does now that messages don't create
    notifications. (Its own row in the list still shows its unread count.)
    """
    total = 0
    memberships = ConversationParticipant.objects.filter(
        user=user, left_at__isnull=True, is_muted=False, is_archived=False
    ).select_related("conversation")
    for membership in memberships:
        total += unread_count_for(membership.conversation, user)
    return total


def mark_read(conversation, user):
    ConversationParticipant.objects.filter(conversation=conversation, user=user).update(
        last_read_at=timezone.now()
    )
    # The reader's other screens (the Whispers badge) drop the count now.
    transaction.on_commit(lambda: _nudge_unread([user.id]))


def broadcast(conversation_id, event_type, payload):
    """Push an event to everyone with the conversation open."""
    try:
        from asgiref.sync import async_to_sync
        from channels.layers import get_channel_layer

        channel_layer = get_channel_layer()
        if channel_layer is None:
            return
        async_to_sync(channel_layer.group_send)(
            conversation_group(conversation_id),
            {"type": "conversation.event", "event": event_type, "payload": payload},
        )
    except Exception:  # noqa: BLE001 — see module docstring
        logger.warning("Live message delivery failed", exc_info=True)


def send_message(conversation, sender, body, attachments=None):
    """
    Persist a message, update the conversation and push it live.

    Messages don't create notifications: they have their own unread count
    on Whispers, and a notification per message filled the Notifications
    screen with chat. Instead, each other participant's devices get a
    small "unread changed" nudge so that count updates straight away.
    """
    from .serializers import serialize_message

    message = Message.objects.create(conversation=conversation, sender=sender, body=body)

    for attachment in attachments or []:
        attachment.message = message
        attachment.save()

    conversation.last_message_at = message.created_at
    conversation.save(update_fields=["last_message_at"])

    mark_read(conversation, sender)

    payload = serialize_message(message, viewer=sender)
    transaction.on_commit(lambda: broadcast(conversation.id, "message", payload))

    recipients = list(
        participants_of(conversation)
        .exclude(user=sender)
        .filter(is_muted=False)
        .values_list("user_id", flat=True)
    )
    transaction.on_commit(lambda: _nudge_unread(recipients))

    return message


def _nudge_unread(user_ids):
    """Tell these users' open apps to refresh their unread-message count."""
    try:
        from asgiref.sync import async_to_sync
        from channels.layers import get_channel_layer

        from notifications.services import user_group

        channel_layer = get_channel_layer()
        if channel_layer is None:
            return
        for user_id in user_ids:
            async_to_sync(channel_layer.group_send)(user_group(user_id), {"type": "unread.changed"})
    except Exception:  # noqa: BLE001 — best effort, like broadcast()
        logger.warning("Unread nudge failed", exc_info=True)


def membership_of(conversation, user):
    """This person's row in this conversation, from the prefetch when there is one."""
    for row in conversation.participants.all():
        if row.user_id == user.id:
            return row
    return None


def clear_for(conversation, user):
    """"Delete chat": hide everything so far from this person only."""
    now = timezone.now()
    ConversationParticipant.objects.filter(conversation=conversation, user=user).update(
        cleared_at=now, last_read_at=now, pinned_at=None, is_archived=False
    )
    transaction.on_commit(lambda: _nudge_unread([user.id]))


def is_hidden_for(conversation, membership):
    """Deleted by this person, and nothing new has been written since."""
    if membership is None or membership.cleared_at is None:
        return False
    return conversation.last_message_at is None or conversation.last_message_at <= membership.cleared_at
