from django.contrib import admin

from .models import MoodCheckIn


@admin.register(MoodCheckIn)
class MoodCheckInAdmin(admin.ModelAdmin):
    list_display = ("id", "owner", "mood", "intensity", "is_demo", "created_at")
    list_filter = ("mood", "is_demo")
