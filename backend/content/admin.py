from django.contrib import admin

from .models import (
    Content,
    ContentCategory,
    ContentComment,
    ContentReaction,
    ContentSave,
    ContentShare,
    ContentView,
)


@admin.register(Content)
class ContentAdmin(admin.ModelAdmin):
    list_display = ("id", "title", "author", "medium", "category", "status", "view_count", "is_demo")
    list_filter = ("medium", "status", "category", "is_demo")
    search_fields = ("title", "author__username")


@admin.register(ContentCategory)
class ContentCategoryAdmin(admin.ModelAdmin):
    list_display = ("slug", "label", "icon", "sort_order")


admin.site.register(ContentView)
admin.site.register(ContentReaction)
admin.site.register(ContentSave)
admin.site.register(ContentShare)
admin.site.register(ContentComment)
