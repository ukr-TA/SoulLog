from django.contrib import admin

from .models import PostBookmark, PostComment, PostMedia, PostReaction, PostShare, SanctuaryPost


@admin.register(SanctuaryPost)
class SanctuaryPostAdmin(admin.ModelAdmin):
    list_display = ("id", "author", "visibility", "is_deleted", "is_demo", "created_at")
    list_filter = ("visibility", "is_deleted", "is_demo")
    search_fields = ("author__username",)


admin.site.register(PostMedia)
admin.site.register(PostComment)
admin.site.register(PostReaction)
admin.site.register(PostBookmark)
admin.site.register(PostShare)
