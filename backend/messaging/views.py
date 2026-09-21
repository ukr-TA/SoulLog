"""
The Whispers REST API.

REST carries history, sending and read state; the WebSocket carries live
delivery and typing. Doing both over REST would mean polling; doing both
over the socket would mean a client with a dropped connection cannot read
its own message history. Each does the part it is good at.

Permission model, in one line: you may touch a conversation only if you are
an active participant of it, and you may only *start* one with someone whose
`privacy.allowMessages` setting permits it.
"""

from django.core.exceptions import ValidationError as DjangoValidationError
from django.db.models import Prefetch
from rest_framework import permissions
from rest_framework.exceptions import PermissionDenied
from rest_framework.generics import get_object_or_404
from rest_framework.parsers import FormParser, MultiPartParser
from rest_framework.response import Response
from rest_framework.views import APIView

from core.editing import apply_edit, check_editable, clean_text
from core.uploads import validate_upload
from social.relations import can_message
from users.models import User

from .models import Conversation, ConversationParticipant, Message, MessageAttachment
from .serializers import (
    serialize_conversation,
    serialize_conversations,
    serialize_message,
    serialize_thread,
)
from .services import (
    broadcast,
    get_or_create_direct,
    is_participant,
    mark_read,
    participants_of,
    send_message,
    total_unread,
)


def _require_participant(conversation, user):
    if not is_participant(conversation, user):
        # 404-not-403, same as journal entries: confirming a conversation
        # exists is itself information the caller isn't entitled to.
        from django.http import Http404

        raise Http404
    return conversation


class ConversationListView(APIView):
    """
    GET  /api/v1/messages/conversations/        — the conversation list
    POST /api/v1/messages/conversations/        — { user_id | username }
                                                  opens (or reuses) a direct thread
    """

    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        conversations = (
            Conversation.objects.filter(
                participants__user=request.user, participants__left_at__isnull=True
            )
            .prefetch_related(
                Prefetch(
                    "participants",
                    queryset=ConversationParticipant.objects.select_related(
                        "user", "user__profile", "user__app_settings"
                    ),
                )
            )
            .distinct()
            .order_by("-last_message_at", "-created_at")
        )

        query = (request.query_params.get("q") or "").strip().lower()
        payload = serialize_conversations(conversations, request.user, request)
        if query:
            payload = [c for c in payload if query in (c["name"] or "").lower()]

        return Response({"conversations": payload, "unread": total_unread(request.user)})

    def post(self, request):
        if request.data.get("user_id"):
            other = get_object_or_404(User, pk=request.data["user_id"])
        else:
            other = get_object_or_404(User, username__iexact=request.data.get("username", ""))

        allowed, reason = can_message(request.user, other)
        if not allowed:
            raise PermissionDenied(reason)

        conversation, created = get_or_create_direct(request.user, other)
        return Response(
            serialize_conversation(conversation, request.user, request),
            status=201 if created else 200,
        )


class ConversationDetailView(APIView):
    """
    GET /api/v1/messages/conversations/<pk>/

    Returns the conversation header and its messages, and marks the thread
    read — opening a conversation *is* reading it, and a separate explicit
    call would just be a round trip the UI always makes anyway.
    """

    permission_classes = [permissions.IsAuthenticated]

    def get(self, request, pk):
        conversation = _require_participant(get_object_or_404(Conversation, pk=pk), request.user)
        limit = min(int(request.query_params.get("limit", 100)), 500)

        messages = serialize_thread(conversation, request.user, request, limit=limit)
        mark_read(conversation, request.user)

        # Tell the other side their messages have now been seen.
        broadcast(conversation.id, "read", {"userId": request.user.id})

        return Response({
            "conversation": serialize_conversation(conversation, request.user, request),
            "messages": messages,
        })

    def delete(self, request, pk):
        """Leave a conversation. The thread and its history survive for the
        other participant."""
        conversation = _require_participant(get_object_or_404(Conversation, pk=pk), request.user)
        from django.utils import timezone

        ConversationParticipant.objects.filter(
            conversation=conversation, user=request.user
        ).update(left_at=timezone.now())
        return Response({"detail": "You've left this conversation."})


class MessageCreateView(APIView):
    """
    POST /api/v1/messages/conversations/<pk>/messages/

    Accepts JSON `{ "body": "..." }` or multipart with `files`. A message
    must carry either text or at least one attachment — an empty message is
    rejected rather than stored as a blank bubble.
    """

    permission_classes = [permissions.IsAuthenticated]
    parser_classes = [MultiPartParser, FormParser, *APIView.parser_classes]

    def post(self, request, pk):
        conversation = _require_participant(get_object_or_404(Conversation, pk=pk), request.user)

        # Re-check permission on every send, not just at conversation
        # creation: the recipient may have tightened their settings or
        # blocked the sender since the thread was opened.
        if conversation.is_direct:
            other = conversation.other_participant(request.user)
            if other is not None:
                allowed, reason = can_message(request.user, other)
                if not allowed:
                    raise PermissionDenied(reason)

        body = (request.data.get("body") or "").strip()
        uploads = request.FILES.getlist("files")

        if not body and not uploads:
            return Response({"detail": "A message needs text or an attachment."}, status=400)

        attachments = []
        for uploaded in uploads[:5]:
            try:
                kind, _extension, mime_type = validate_upload(uploaded)
            except DjangoValidationError as exc:
                return Response({"files": exc.messages}, status=400)
            attachments.append(
                MessageAttachment(
                    file=uploaded,
                    kind=kind,
                    mime_type=mime_type,
                    size_bytes=uploaded.size,
                    original_name=(uploaded.name or "")[:255],
                )
            )

        message = send_message(conversation, request.user, body, attachments)
        return Response(serialize_message(message, request.user, request), status=201)


class MessageDetailView(APIView):
    """
    PATCH  /api/v1/messages/conversations/<pk>/messages/<message_id>/
    DELETE /api/v1/messages/conversations/<pk>/messages/<message_id>/

    Your own message only, in both cases. An edit sets `edited_at` and is
    pushed down the conversation socket so the other side sees the
    correction rather than the version they were replying to; see
    `core.editing` for why edits are visible and time-limited.

    A message carrying only attachments has no text to correct, so editing
    it is refused instead of silently turning it into a text message.
    """

    permission_classes = [permissions.IsAuthenticated]

    def _message(self, request, pk, message_id):
        conversation = _require_participant(get_object_or_404(Conversation, pk=pk), request.user)
        message = get_object_or_404(
            Message, pk=message_id, conversation=conversation, sender=request.user
        )
        return conversation, message

    def patch(self, request, pk, message_id):
        conversation, message = self._message(request, pk, message_id)
        check_editable(message, request.user, text_attr="body")

        if not (message.body or "").strip():
            return Response(
                {"detail": "There's no text in this message to edit."}, status=400
            )

        body = clean_text(request.data.get("body"), field="body")
        apply_edit(message, body, text_attr="body")

        payload = serialize_message(message, request.user, request)
        broadcast(conversation.id, "edited", {
            "id": message.id,
            "text": payload["text"],
            "editedAt": payload["editedAt"],
        })
        return Response(payload)

    def delete(self, request, pk, message_id):
        conversation, message = self._message(request, pk, message_id)
        message.is_deleted = True
        message.body = ""
        message.save(update_fields=["is_deleted", "body"])

        broadcast(conversation.id, "deleted", {"id": message.id})
        return Response({"detail": "Message deleted."})


class ConversationReadView(APIView):
    """POST /api/v1/messages/conversations/<pk>/read/"""

    permission_classes = [permissions.IsAuthenticated]

    def post(self, request, pk):
        conversation = _require_participant(get_object_or_404(Conversation, pk=pk), request.user)
        mark_read(conversation, request.user)
        broadcast(conversation.id, "read", {"userId": request.user.id})
        return Response({"unread": total_unread(request.user)})


class ConversationMuteView(APIView):
    """POST /api/v1/messages/conversations/<pk>/mute/ — { muted: bool }"""

    permission_classes = [permissions.IsAuthenticated]

    def post(self, request, pk):
        conversation = _require_participant(get_object_or_404(Conversation, pk=pk), request.user)
        muted = bool(request.data.get("muted", True))
        ConversationParticipant.objects.filter(
            conversation=conversation, user=request.user
        ).update(is_muted=muted)
        return Response({"muted": muted})


class UnreadTotalView(APIView):
    """GET /api/v1/messages/unread/ — the Whispers nav badge."""

    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        return Response({"unread": total_unread(request.user)})


class MessageableUsersView(APIView):
    """
    GET /api/v1/messages/recipients/?q=

    Who the caller can start a new conversation with: their accepted
    connections, plus anyone searchable whose settings allow messages from
    everyone. Anyone who wouldn't accept the message is filtered out here
    rather than letting the user compose one and be refused at send time.
    """

    permission_classes = [permissions.IsAuthenticated]
    throttle_scope = "search"

    def get(self, request):
        from django.db.models import Q

        from social.relations import connected_user_ids
        from users.public import PublicUserSerializer

        query = (request.query_params.get("q") or "").strip()
        candidates = User.objects.exclude(pk=request.user.pk).select_related(
            "profile", "app_settings"
        )

        if query:
            candidates = candidates.filter(
                Q(username__icontains=query) | Q(fullname__icontains=query)
            )
        else:
            candidates = candidates.filter(pk__in=connected_user_ids(request.user))

        allowed = [user for user in candidates[:50] if can_message(request.user, user)[0]]
        return Response(
            PublicUserSerializer(
                allowed, many=True, context={"request": request, "viewer": request.user}
            ).data
        )


__all__ = [
    "ConversationDetailView",
    "ConversationListView",
    "ConversationMuteView",
    "ConversationReadView",
    "MessageCreateView",
    "MessageDetailView",
    "MessageableUsersView",
    "UnreadTotalView",
    "participants_of",
]
