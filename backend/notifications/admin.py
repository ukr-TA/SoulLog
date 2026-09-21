from django.contrib import admin

from .models import Notification


@admin.register(Notification)
class NotificationAdmin(admin.ModelAdmin):
    # Body deliberately omitted from the list view: a notification body can
    # quote a comment on a private journal entry (spec §81, least privilege).
    list_display = ("id", "recipient", "kind", "actor", "actor_count", "is_read", "created_at")
    list_filter = ("kind", "is_read", "is_demo")
    search_fields = ("recipient__username", "actor__username")
