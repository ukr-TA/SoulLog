from django.contrib import admin
from django.contrib.auth.admin import UserAdmin as DjangoUserAdmin

from .models import User, UserProfile, UserSettings


@admin.register(User)
class UserAdmin(DjangoUserAdmin):
    # Least-privilege (spec §81): admins see account metadata, never
    # private journal content, which lives in a different app entirely.
    list_display = ("username", "email", "fullname", "is_demo", "is_staff", "created_at")
    list_filter = ("is_demo", "is_staff", "is_active")
    fieldsets = DjangoUserAdmin.fieldsets + (
        ("SoulLog", {"fields": ("fullname", "phone_number", "is_demo")}),
    )


@admin.register(UserProfile)
class UserProfileAdmin(admin.ModelAdmin):
    list_display = ("user", "profile_visibility", "onboarding_completed", "updated_at")
    list_filter = ("profile_visibility", "onboarding_completed")


@admin.register(UserSettings)
class UserSettingsAdmin(admin.ModelAdmin):
    list_display = ("user", "updated_at")
