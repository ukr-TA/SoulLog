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
    if membership.last_read_at is not None:
        queryset = queryset.filter(created_at__gt=membership.last_read_at)
    return queryset.count()


def total_unread(user):
    """The badge on the Whispers nav item."""
    total = 0
    memberships = ConversationParticipant.objects.filter(
        user=user, left_at__isnull=True
    ).select_related("conversation")
    for membership in memberships:
        total += unread_count_for(membership.conversation, user)
    return total


def mark_read(conversation, user):
    ConversationParticipant.objects.filter(conversation=conversation, user=user).update(
        last_read_at=timezone.now()
    )


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
    Persist a message, update the conversation, push it, and notify anyone
    who isn't watching.

    Notification is skipped for participants who have the conversation
    muted, and for a recipient who has read the thread within the last few
    seconds — they are plainly looking at it, and a notification for a
    message you just watched arrive is noise.
    """
    from notifications.services import notify

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

    recently_active = timezone.now() - timezone.timedelta(seconds=15)
    display_name = sender.fullname or sender.username

    for membership in participants_of(conversation).exclude(user=sender):
        if membership.is_muted:
            continue
        if membership.last_read_at and membership.last_read_at >= recently_active:
            continue
        notify(
            recipient=membership.user,
            actor=sender,
            kind="message",
            title="sent you a message",
            body=(body[:140] + "…") if len(body) > 140 else body,
            target=conversation,
            target_label=display_name,
            dedupe_key=f"message:{conversation.id}",
        )

    return message
