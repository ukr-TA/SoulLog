from django.contrib import admin

from .models import Badge, UserBadge


@admin.register(Badge)
class BadgeAdmin(admin.ModelAdmin):
    list_display = ("slug", "name", "metric", "threshold", "is_active", "sort_order")
    list_filter = ("metric", "is_active")


@admin.register(UserBadge)
class UserBadgeAdmin(admin.ModelAdmin):
    list_display = ("user", "badge", "value_at_award", "earned_at")
    list_filter = ("badge", "is_demo")
    search_fields = ("user__username",)
