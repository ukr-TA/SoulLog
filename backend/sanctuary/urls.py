from django.urls import path

from .views import (
    BookmarkView,
    CommentDetailView,
    CommentView,
    FeedView,
    PostDetailView,
    ReactionView,
    ShareJournalEntryView,
    ShareView,
    TrendingTagsView,
)

urlpatterns = [
    path("posts/", FeedView.as_view(), name="sanctuary-feed"),
    path("posts/<int:pk>/", PostDetailView.as_view(), name="sanctuary-post"),
    path("posts/<int:pk>/comments/", CommentView.as_view(), name="sanctuary-comments"),
    path(
        "posts/<int:pk>/comments/<int:comment_id>/",
        CommentDetailView.as_view(),
        name="sanctuary-comment-detail",
    ),
    path("posts/<int:pk>/like/", ReactionView.as_view(), name="sanctuary-post-like"),
    path("comments/<int:comment_id>/like/", ReactionView.as_view(), name="sanctuary-comment-like"),
    path("posts/<int:pk>/bookmark/", BookmarkView.as_view(), name="sanctuary-bookmark"),
    path("posts/<int:pk>/share/", ShareView.as_view(), name="sanctuary-share"),
    path("share-entry/", ShareJournalEntryView.as_view(), name="sanctuary-share-entry"),
    path("tags/", TrendingTagsView.as_view(), name="sanctuary-tags"),
]
