from django.urls import path

from .views import (
    CommentDetailView,
    CommentListCreateView,
    CommentReactView,
    DashboardStatsView,
    EntryReactView,
    JournalDetailView,
    JournalListCreateView,
    JournalMediaDeleteView,
    JournalMediaView,
    SharedEntriesView,
)

urlpatterns = [
    path("", JournalListCreateView.as_view(), name="journal-list-create"),
    path("stats/", DashboardStatsView.as_view(), name="journal-stats"),
    path("shared/", SharedEntriesView.as_view(), name="journal-shared"),
    path("<int:entry_id>/media/", JournalMediaView.as_view(), name="journal-media"),
    path("<int:entry_id>/media/<int:pk>/", JournalMediaDeleteView.as_view(), name="journal-media-delete"),
    path("<int:entry_id>/react/", EntryReactView.as_view(), name="journal-entry-react"),
    path("<int:entry_id>/comments/", CommentListCreateView.as_view(), name="journal-comments"),
    path("<int:entry_id>/comments/<int:pk>/", CommentDetailView.as_view(), name="journal-comment-detail"),
    path("<int:entry_id>/comments/<int:comment_id>/react/", CommentReactView.as_view(), name="journal-comment-react"),
    path("<int:pk>/", JournalDetailView.as_view(), name="journal-detail"),
]
