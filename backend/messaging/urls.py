from django.urls import path

from .views import (
    ConversationArchiveView,
    ConversationPinView,
    ConversationDetailView,
    ConversationListView,
    ConversationMuteView,
    ConversationReadView,
    MessageCreateView,
    MessageDetailView,
    MessageableUsersView,
    UnreadTotalView,
)

urlpatterns = [
    path("conversations/", ConversationListView.as_view(), name="conversation-list"),
    path("conversations/<int:pk>/", ConversationDetailView.as_view(), name="conversation-detail"),
    path("conversations/<int:pk>/messages/", MessageCreateView.as_view(), name="message-create"),
    path(
        "conversations/<int:pk>/messages/<int:message_id>/",
        MessageDetailView.as_view(),
        name="message-detail",
    ),
    path("conversations/<int:pk>/read/", ConversationReadView.as_view(), name="conversation-read"),
    path("conversations/<int:pk>/mute/", ConversationMuteView.as_view(), name="conversation-mute"),
    path("conversations/<int:pk>/pin/", ConversationPinView.as_view(), name="conversation-pin"),
    path("conversations/<int:pk>/archive/", ConversationArchiveView.as_view(), name="conversation-archive"),
    path("recipients/", MessageableUsersView.as_view(), name="message-recipients"),
    path("unread/", UnreadTotalView.as_view(), name="message-unread"),
]
