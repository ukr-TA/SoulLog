from django.urls import path

from .views import SearchSuggestionsView, SearchView, TopicFollowView, TopicListView

urlpatterns = [
    path("search/", SearchView.as_view(), name="community-search"),
    path("search/suggestions/", SearchSuggestionsView.as_view(), name="community-search-suggestions"),
    path("topics/", TopicListView.as_view(), name="community-topics"),
    path("topics/<slug:slug>/follow/", TopicFollowView.as_view(), name="community-topic-follow"),
]
