from django.conf import settings
from django.conf.urls.static import static
from django.contrib import admin
from django.urls import include, path

from users.profile_views import (
    MentorDirectoryView,
    MyAchievementsView,
    MyProfileView,
    ProfileImageDeleteView,
    ProfileViewersView,
    PublicProfilePostsView,
    PublicProfileView,
)
from users.settings_views import SettingsView
from users.views import HealthView

urlpatterns = [
    path("admin/", admin.site.urls),
    # Liveness/readiness probe. Deliberately unauthenticated and boring:
    # a load balancer needs to know the process is up and the database
    # answers, and nothing more.
    path("healthz", HealthView.as_view(), name="healthz"),

    path("api/v1/auth/", include("users.urls")),
    path("api/v1/journal/", include("journal.urls")),
    path("api/v1/mood/", include("moods.urls")),
    path("api/v1/insights/", include("insights.urls")),
    path("api/v1/settings/", SettingsView.as_view(), name="settings"),

    # Subsystems that used to exist only as frontend UI.
    path("api/v1/social/", include("social.urls")),
    path("api/v1/notifications/", include("notifications.urls")),
    path("api/v1/messages/", include("messaging.urls")),
    path("api/v1/community/", include("community.urls")),
    path("api/v1/sanctuary/", include("sanctuary.urls")),
    path("api/v1/content/", include("content.urls")),

    # Profiles. The mentors route is declared before <username> so that a
    # user who happens to be called "mentors" can't shadow the directory.
    path("api/v1/profile/", MyProfileView.as_view(), name="my-profile"),
    path("api/v1/profile/image/", ProfileImageDeleteView.as_view(), name="profile-image-delete"),
    path("api/v1/profile/mentors/", MentorDirectoryView.as_view(), name="mentor-directory"),
    path("api/v1/profile/views/", ProfileViewersView.as_view(), name="profile-viewers"),
    path("api/v1/profile/achievements/", MyAchievementsView.as_view(), name="my-achievements"),
    path("api/v1/profile/<str:username>/", PublicProfileView.as_view(), name="public-profile"),
    path(
        "api/v1/profile/<str:username>/posts/",
        PublicProfilePostsView.as_view(),
        name="public-profile-posts",
    ),
]

if settings.DEBUG:
    urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)
