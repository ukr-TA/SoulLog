from django.urls import path

from .views import (
    CategoryListView,
    ContentCommentDetailView,
    ContentCommentView,
    ContentDetailView,
    ContentProgressView,
    ContentReactionView,
    ContentSaveView,
    ContentShareView,
    LibraryView,
)

urlpatterns = [
    path("", LibraryView.as_view(), name="content-list"),
    path("categories/", CategoryListView.as_view(), name="content-categories"),
    path("<int:pk>/", ContentDetailView.as_view(), name="content-detail"),
    path("<int:pk>/progress/", ContentProgressView.as_view(), name="content-progress"),
    path("<int:pk>/like/", ContentReactionView.as_view(), name="content-like"),
    path("<int:pk>/save/", ContentSaveView.as_view(), name="content-save"),
    path("<int:pk>/share/", ContentShareView.as_view(), name="content-share"),
    path("<int:pk>/comments/", ContentCommentView.as_view(), name="content-comments"),
    path(
        "<int:pk>/comments/<int:comment_id>/",
        ContentCommentDetailView.as_view(),
        name="content-comment-detail",
    ),
]
