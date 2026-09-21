from django.contrib import admin

from .models import Connection, Follow


@admin.register(Connection)
class ConnectionAdmin(admin.ModelAdmin):
    list_display = ("id", "requester", "addressee", "status", "is_demo", "created_at")
    list_filter = ("status", "is_demo")
    search_fields = ("requester__username", "addressee__username")


@admin.register(Follow)
class FollowAdmin(admin.ModelAdmin):
    list_display = ("id", "follower", "following", "is_demo", "created_at")
    list_filter = ("is_demo",)
    search_fields = ("follower__username", "following__username")
