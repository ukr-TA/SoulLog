"""
Whispers payloads, shaped to what Messages.tsx already renders.

Conversation list items keep the original keys — `name`, `avatar`,
`lastMessage`, `time`, `unread`, `online`, `typing`, `bio` — and messages
keep `{ id, text, sender: 'me' | 'them', time, status }`. Same
translate-at-the-boundary rule used everywhere else in this codebase:
the working UI is not rewritten to suit a new payload.

Two of those fields used to be decorative and are now real:

  `online`  comes from `users.presence`, derived from `last_seen`, and
            respects the other person's onlineStatus setting.
  `typing`  is never set here. It only ever arrives over the WebSocket, from
            an actual keystroke, and expires on its own — see consumers.py.
            A REST response cannot know it, so it reports False rather than
            guessing.
"""

from django.utils import timezone

from users.presence import humanize_presence, presence_for
from users.public import avatar_url, initials_for

from .models import Message
from .services import membership_of, unread_count_for


def _short_time(moment):
    """'2m ago' / '1h ago' / '3d ago' — the conversation-list stamp."""
    seconds = (timezone.now() - moment).total_seconds()
    minutes = int(seconds // 60)
    if minutes < 1:
        return "now"
    if minutes < 60:
        return f"{minutes}m ago"
    hours = minutes // 60
    if hours < 24:
        return f"{hours}h ago"
    days = hours // 24
    if days < 7:
        return f"{days}d ago"
    return moment.strftime("%b %d")


def serialize_message(message, viewer, request=None):
    if message.is_deleted:
        text = "This message was deleted"
    else:
        text = message.body

    return {
        "id": message.id,
        "text": text,
        "sender": "me" if message.sender_id == viewer.id else "them",
        "senderId": message.sender_id,
        "senderName": message.sender.fullname or message.sender.username,
        "time": timezone.localtime(message.created_at).strftime("%I:%M %p").lstrip("0"),
        "createdAt": message.created_at.isoformat(),
        # 'read' once the other side's last_read_at has passed this message;
        # computed by the caller for a list (see serialize_thread) so we
        # aren't issuing a query per message here.
        "status": "sent",
        "isDeleted": message.is_deleted,
        "editedAt": message.edited_at.isoformat() if message.edited_at else None,
        "attachments": [
            {
                "id": item.id,
                "url": request.build_absolute_uri(item.file.url) if request else item.file.url,
                "kind": item.kind,
                "mimeType": item.mime_type,
                "sizeBytes": item.size_bytes,
                "name": item.original_name,
            }
            for item in message.attachments.all()
        ],
    }


def serialize_thread(conversation, viewer, request=None, limit=100):
    """
    The messages of one conversation, oldest last (the order the UI scrolls).

    Read receipts are resolved once, from the other participants' single
    `last_read_at` timestamps, instead of one query per message.
    """
    from .services import participants_of

    others = list(participants_of(conversation).exclude(user=viewer))
    read_cutoff = min(
        (p.last_read_at for p in others if p.last_read_at is not None), default=None
    )

    own = conversation.participants.filter(user=viewer).first()
    visible = conversation.messages.all()
    if own is not None and own.cleared_at is not None:
        visible = visible.filter(created_at__gt=own.cleared_at)

    messages = list(
        visible.select_related("sender")
        .prefetch_related("attachments")
        .order_by("-created_at")[:limit]
    )
    messages.reverse()

    payload = []
    for message in messages:
        item = serialize_message(message, viewer, request)
        if message.sender_id == viewer.id:
            if read_cutoff is not None and message.created_at <= read_cutoff:
                item["status"] = "read"
            else:
                item["status"] = "delivered"
        payload.append(item)
    return payload


def serialize_conversation(conversation, viewer, request=None):
    other = conversation.other_participant(viewer) if conversation.is_direct else None
    own = membership_of(conversation, viewer)
    shown = conversation.messages.filter(is_deleted=False)
    if own is not None and own.cleared_at is not None:
        shown = shown.filter(created_at__gt=own.cleared_at)
    last = (
        shown
        .select_related("sender")
        .order_by("-created_at")
        .first()
    )

    if other is not None:
        presence = presence_for(other, viewer)
        profile = getattr(other, "profile", None)
        name = other.fullname or other.username
        data = {
            "id": conversation.id,
            "userId": other.id,
            "username": other.username,
            "name": name,
            "avatar": initials_for(other),
            "avatarUrl": avatar_url(other, request),
            "bio": (profile.bio if profile else "") or "",
            "online": presence["status"] == "active",
            "presenceLabel": humanize_presence(presence),
        }
    else:
        data = {
            "id": conversation.id,
            "userId": None,
            "username": None,
            "name": conversation.title or "Group conversation",
            "avatar": "👥",
            "avatarUrl": None,
            "bio": "",
            "online": False,
            "presenceLabel": None,
        }

    data.update({
        "lastMessage": (last.body if last else ""),
        "lastMessageAt": last.created_at.isoformat() if last else None,
        "time": _short_time(last.created_at) if last else "",
        "unread": unread_count_for(conversation, viewer),
        # Never inferred; only ever set by a live typing event.
        "typing": False,
        "isDirect": conversation.is_direct,
        # Whether *you* muted this thread — drives Mute/Unmute in the
        # conversation menu. Read from the prefetched participants, so the
        # list doesn't cost a query per row.
        "muted": bool(own and own.is_muted),
        "pinned": bool(own and own.pinned_at),
        "pinnedAt": own.pinned_at.isoformat() if own and own.pinned_at else None,
        "archived": bool(own and own.is_archived),
    })
    return data


def serialize_conversations(conversations, viewer, request=None):
    return [serialize_conversation(c, viewer, request) for c in conversations]


__all__ = [
    "Message",
    "serialize_conversation",
    "serialize_conversations",
    "serialize_message",
    "serialize_thread",
]
