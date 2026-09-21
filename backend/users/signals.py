from django.conf import settings
from django.db.models.signals import post_save
from django.dispatch import receiver


@receiver(post_save, sender=settings.AUTH_USER_MODEL)
def ensure_profile_exists(sender, instance, created, **kwargs):
    """
    Guarantees every User row has a matching UserProfile and UserSettings,
    no matter which code path created the user (signup API,
    `createsuperuser`, or the future `seed_demo` management command).
    get_or_create avoids clashing with RegisterSerializer, which also
    creates the profile explicitly.
    """
    if created:
        from .models import (
            DEFAULT_APPEARANCE_SETTINGS,
            DEFAULT_JOURNALING_SETTINGS,
            DEFAULT_NOTIFICATION_SETTINGS,
            DEFAULT_SOCIAL_SETTINGS,
            UserProfile,
            UserSettings,
        )

        UserProfile.objects.get_or_create(user=instance)
        UserSettings.objects.get_or_create(
            user=instance,
            defaults={
                "notifications": DEFAULT_NOTIFICATION_SETTINGS,
                "journaling": DEFAULT_JOURNALING_SETTINGS,
                "social": DEFAULT_SOCIAL_SETTINGS,
                "appearance": DEFAULT_APPEARANCE_SETTINGS,
            },
        )
