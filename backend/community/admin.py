from django.contrib import admin

from .models import SearchQuery, Topic, TopicFollow


@admin.register(Topic)
class TopicAdmin(admin.ModelAdmin):
    list_display = ("slug", "label", "is_demo")


@admin.register(SearchQuery)
class SearchQueryAdmin(admin.ModelAdmin):
    # A person's search history is personal. Staff can see volume and
    # timing, not the terms (spec §81, least privilege).
    list_display = ("id", "user", "scope", "result_count", "created_at")
    list_filter = ("scope",)


admin.site.register(TopicFollow)
