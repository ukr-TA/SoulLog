from django.urls import path

from .views import MoodListCreateView

urlpatterns = [
    path("", MoodListCreateView.as_view(), name="mood-list-create"),
]
