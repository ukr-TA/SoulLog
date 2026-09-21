from django.utils import timezone
from rest_framework import permissions
from rest_framework.generics import get_object_or_404
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import Notification, NotificationKind
from .serializers import counts_for, serialize_many, serialize_notification


class NotificationListView(APIView):
    """
    GET /api/v1/notifications/?filter=all|unread|engagement|social|community|insights|achievements

    Returns `{ notifications: [...], counts: {...} }`. The counts travel
    with the list because NotificationPage renders both at once, and two
    round trips for one screen is wasted latency on a phone.

    Scoped to `recipient=request.user` at the queryset level — the same
    enforcement pattern as journal entries, for the same reason.
    """

    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        queryset = Notification.objects.filter(recipient=request.user).select_related("actor")

        wanted = request.query_params.get("filter", "all")
        if wanted == "unread":
            queryset = queryset.filter(is_read=False)
        elif wanted in ("engagement", "social", "community", "insights", "achievements"):
            kinds = [k for k, c in NotificationKind.CATEGORY.items() if c == wanted]
            queryset = queryset.filter(kind__in=kinds)

        limit = min(int(request.query_params.get("limit", 50)), 200)
        return Response({
            "notifications": serialize_many(queryset[:limit], request),
            "counts": counts_for(request.user),
        })


class NotificationReadView(APIView):
    """POST /api/v1/notifications/<pk>/read/ — mark one as read."""

    permission_classes = [permissions.IsAuthenticated]

    def post(self, request, pk):
        notification = get_object_or_404(Notification, pk=pk, recipient=request.user)
        if not notification.is_read:
            notification.is_read = True
            notification.read_at = timezone.now()
            notification.save(update_fields=["is_read", "read_at", "updated_at"])
        return Response(serialize_notification(notification, request))


class NotificationReadAllView(APIView):
    """POST /api/v1/notifications/read-all/"""

    permission_classes = [permissions.IsAuthenticated]

    def post(self, request):
        updated = Notification.objects.filter(recipient=request.user, is_read=False).update(
            is_read=True, read_at=timezone.now()
        )
        return Response({"marked_read": updated, "counts": counts_for(request.user)})


class NotificationDeleteView(APIView):
    """DELETE /api/v1/notifications/<pk>/ — dismiss. The X button in the UI."""

    permission_classes = [permissions.IsAuthenticated]

    def delete(self, request, pk):
        notification = get_object_or_404(Notification, pk=pk, recipient=request.user)
        notification.delete()
        return Response({"detail": "Dismissed.", "counts": counts_for(request.user)})


class NotificationClearView(APIView):
    """DELETE /api/v1/notifications/ — clear all of the caller's."""

    permission_classes = [permissions.IsAuthenticated]

    def delete(self, request):
        deleted, _ = Notification.objects.filter(recipient=request.user).delete()
        return Response({"deleted": deleted})


class UnreadCountView(APIView):
    """
    GET /api/v1/notifications/unread-count/

    The red dot on the bell. Deliberately its own tiny endpoint so the
    dashboard can poll it cheaply on clients where the WebSocket isn't
    connected (a backgrounded mobile webview, for instance).
    """

    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        return Response({"unread": Notification.objects.filter(
            recipient=request.user, is_read=False
        ).count()})
