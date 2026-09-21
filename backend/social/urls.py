from django.urls import path

from .views import (
    BlockView,
    BlockedListView,
    ConnectionDeleteView,
    ConnectionListView,
    ConnectionRequestCreateView,
    ConnectionRequestListView,
    ConnectionRespondView,
    FollowView,
    SuggestionsView,
    UserSearchView,
)

urlpatterns = [
    path("connections/", ConnectionListView.as_view(), name="connection-list"),
    path("connections/<int:user_id>/", ConnectionDeleteView.as_view(), name="connection-delete"),
    path("requests/", ConnectionRequestListView.as_view(), name="connection-requests"),
    path("requests/create/", ConnectionRequestCreateView.as_view(), name="connection-request-create"),
    path("requests/<int:pk>/respond/", ConnectionRespondView.as_view(), name="connection-respond"),
    path("block/<int:user_id>/", BlockView.as_view(), name="block"),
    path("blocked/", BlockedListView.as_view(), name="blocked-list"),
    path("follow/<int:user_id>/", FollowView.as_view(), name="follow"),
    path("suggestions/", SuggestionsView.as_view(), name="connection-suggestions"),
    path("search/", UserSearchView.as_view(), name="user-search"),
]
