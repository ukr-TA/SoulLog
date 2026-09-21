from django.conf import settings
from django.contrib.auth.models import AbstractUser
from django.db import models


class User(AbstractUser):
    """
    SoulLog's custom user model.

    We extend Django's built-in user instead of writing auth from scratch —
    it already gives us secure password hashing, permissions, and admin
    integration for free. We only add the fields the SoulLog frontend
    actually collects at signup.
    """

    fullname = models.CharField(max_length=150, blank=True)
    phone_number = models.CharField(max_length=32, blank=True)
    email = models.EmailField(unique=True)

    # Marks accounts created by `seed_demo` so they can always be told
    # apart from real users and safely removed with `clear_demo`.
    is_demo = models.BooleanField(default=False)

    # Stamped by users.middleware.LastSeenMiddleware. This is what makes
    # Whispers' presence indicator real instead of a hardcoded label —
    # see users/presence.py for how it's read and the privacy rule applied.
    last_seen = models.DateTimeField(null=True, blank=True)

    created_at = models.DateTimeField(auto_now_add=True)

    USERNAME_FIELD = "username"
    REQUIRED_FIELDS = ["email"]

    def __str__(self):
        return self.username


class UserProfile(models.Model):
    """
    Extended profile data, kept separate from the auth-critical User model.

    Splitting this out means a profile can be optional (per spec §15 —
    "Complete profile or Skip for now") without touching the auth table,
    and public-profile serialization can pull from exactly this model
    without any risk of leaking auth fields.
    """

    VISIBILITY_CHOICES = [
        ("public", "Public"),
        ("connections", "Connections only"),
        ("private", "Private"),
    ]

    user = models.OneToOneField(User, on_delete=models.CASCADE, related_name="profile")

    bio = models.TextField(blank=True)
    location = models.CharField(max_length=120, blank=True)
    website = models.CharField(max_length=200, blank=True)

    current_focus = models.CharField(max_length=200, blank=True)
    growth_areas = models.CharField(max_length=200, blank=True)
    values = models.CharField(max_length=200, blank=True)
    favorite_topics = models.JSONField(default=list, blank=True)

    profile_image = models.ImageField(upload_to="profiles/avatars/", null=True, blank=True)
    cover_image = models.ImageField(upload_to="profiles/covers/", null=True, blank=True)

    profile_visibility = models.CharField(max_length=20, choices=VISIBILITY_CHOICES, default="public")
    journal_visibility = models.CharField(max_length=20, choices=VISIBILITY_CHOICES, default="connections")
    show_email = models.BooleanField(default=False)
    show_phone = models.BooleanField(default=False)

    ALLOW_MESSAGES_CHOICES = [
        ("everyone", "Everyone"),
        ("connections", "Connections only"),
        ("nobody", "Nobody"),
    ]
    allow_messages = models.CharField(max_length=20, choices=ALLOW_MESSAGES_CHOICES, default="everyone")
    mentor_available = models.BooleanField(default=False)

    # Off by default, and reciprocal: turning this on lets you see who
    # viewed your profile, and makes your own visits to other profiles
    # visible to them. Leaving it off means neither happens — no view of
    # yours is recorded at all. See users.models.ProfileView.
    show_profile_views = models.BooleanField(default=False)

    onboarding_completed = models.BooleanField(default=False)

    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f"Profile<{self.user.username}>"


# Default shape for UserSettings' JSON groups — matches Settings.tsx's
# `settings` state exactly, field for field, so the frontend's existing
# UI needs no restructuring. See UserSettings' docstring for why these
# groups are JSON rather than individual columns.
DEFAULT_NOTIFICATION_SETTINGS = {
    "pushEnabled": True,
    "emailEnabled": True,
    "journalReminder": True,
    "socialInteractions": True,
    "achievements": True,
    "weeklyDigest": False,
}

DEFAULT_JOURNALING_SETTINGS = {
    "autoSave": True,
    "defaultTemplate": "gratitude",
    "moodTracking": True,
    "goalReminders": True,
    "streakNotifications": True,
}

DEFAULT_SOCIAL_SETTINGS = {
    "connectionRecommendations": True,
    "activitySharing": True,
    "mentionNotifications": True,
    "friendRequests": "everyone",
    "onlineStatus": True,
    "journalSharing": True,
    "communityJoining": True,
    "inspirationFeed": True,
    "publicProfile": True,
    "followSystem": True,
    "groupDiscussions": True,
    "achievementSharing": True,
}

DEFAULT_APPEARANCE_SETTINGS = {
    "fontSize": "medium",
    "language": "en",
}


class UserSettings(models.Model):
    """
    Preference toggles that don't need their own dedicated columns or
    cross-referencing (spec §53-58): notifications, journaling defaults,
    social toggles, appearance.

    Deliberately JSON rather than ~25 individual BooleanFields (spec
    §115 — avoid overengineering for data with no query/filter needs of
    its own). Profile fields (name/bio/email/etc) and privacy visibility
    are NOT here — they already have real dedicated columns on User and
    UserProfile that drive actual enforced behavior (journal visibility,
    comment permissions), so this model doesn't duplicate them.

    Many of these toggles (e.g. social.followSystem, social.communityJoining)
    currently have no feature behind them yet to actually affect — saving
    and returning the real value is honest; that value not currently
    changing app behavior elsewhere is a separate, documented gap (see
    docs/NOT-BUILT-OR-DEFERRED.md), not something hidden by this model.
    """

    user = models.OneToOneField(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="app_settings")

    notifications = models.JSONField(default=dict)
    journaling = models.JSONField(default=dict)
    social = models.JSONField(default=dict)
    appearance = models.JSONField(default=dict)

    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f"Settings<{self.user.username}>"


class ProfileView(models.Model):
    """
    A record of one person looking at another person's profile.

    This is the feature that has to be built carefully or not at all, so
    the rules are written down here rather than left in the view.

    **Reciprocity.** A view is only ever recorded when *both* people have
    `show_profile_views` on. If you want to know who looked at you, you
    accept being seen when you look at others; if you'd rather not be
    seen, you don't get the list. That symmetry is what keeps this from
    being surveillance — the cost and the benefit land on the same
    person, and nobody is observed by someone who isn't equally
    observable.

    It is enforced when the row is written, not when it's read. A record
    that exists but is hidden is still a record, and "we collected it but
    don't show it" is exactly the posture this product shouldn't have.

    **One row per viewer per day.** `viewed_on` is part of the uniqueness
    constraint, so refreshing someone's profile eleven times is one view,
    not eleven. The number then means "people", which is the only reading
    of it that's useful.

    **It expires.** Views older than `RETENTION_DAYS` are never shown and
    are deleted by `manage.py prune_profile_views`. A permanent log of who
    looked at whom is a liability nobody asked for; a rolling month
    answers the question people actually have.

    Opt-in by default: `show_profile_views` starts off.
    """

    RETENTION_DAYS = 30

    viewer = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="profile_views_made"
    )
    profile_owner = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="profile_views_received"
    )

    # Denormalised date, because it's what the uniqueness rule is about.
    viewed_on = models.DateField()
    created_at = models.DateTimeField(auto_now_add=True)
    # Bumped when the same person looks again the same day, so the list
    # can be ordered by "most recently here" rather than "first arrived".
    last_seen_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["viewer", "profile_owner", "viewed_on"],
                name="unique_profile_view_per_day",
            ),
            models.CheckConstraint(
                condition=~models.Q(viewer=models.F("profile_owner")),
                name="no_self_profile_view",
            ),
        ]
        ordering = ["-last_seen_at"]
        indexes = [models.Index(fields=["profile_owner", "-last_seen_at"])]

    def __str__(self):
        return f"{self.viewer.username} viewed {self.profile_owner.username}"
