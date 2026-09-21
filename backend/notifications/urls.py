from django.urls import path

from .views import (
    NotificationClearView,
    NotificationDeleteView,
    NotificationListView,
    NotificationReadAllView,
    NotificationReadView,
    UnreadCountView,
)

urlpatterns = [
    path("", NotificationListView.as_view(), name="notification-list"),
    path("unread-count/", UnreadCountView.as_view(), name="notification-unread-count"),
    path("read-all/", NotificationReadAllView.as_view(), name="notification-read-all"),
    path("clear/", NotificationClearView.as_view(), name="notification-clear"),
    path("<int:pk>/read/", NotificationReadView.as_view(), name="notification-read"),
    path("<int:pk>/", NotificationDeleteView.as_view(), name="notification-delete"),
]
