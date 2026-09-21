from django.contrib import admin

from .models import JournalEntry, JournalMedia


@admin.register(JournalEntry)
class JournalEntryAdmin(admin.ModelAdmin):
    # Content column deliberately omitted — private reflections shouldn't
    # be casually browsable even by staff (spec §81, least privilege).
    list_display = ("id", "owner", "entry_type", "mood", "visibility", "is_demo", "created_at")
    list_filter = ("entry_type", "visibility", "is_demo")
    search_fields = ("owner__username", "title")


admin.site.register(JournalMedia)

from .models import JournalComment, JournalCommentReaction

admin.site.register(JournalComment)
admin.site.register(JournalCommentReaction)
