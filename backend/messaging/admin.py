from django.contrib import admin

from .models import Conversation, ConversationParticipant, Message, MessageAttachment


@admin.register(Conversation)
class ConversationAdmin(admin.ModelAdmin):
    list_display = ("id", "is_direct", "created_by", "last_message_at", "is_demo")
    list_filter = ("is_direct", "is_demo")


@admin.register(Message)
class MessageAdmin(admin.ModelAdmin):
    # Message bodies are private correspondence. Staff can see that a
    # message exists and who sent it, never what it said (spec §81).
    list_display = ("id", "conversation", "sender", "is_deleted", "created_at")
    list_filter = ("is_deleted", "is_demo")
    search_fields = ("sender__username",)


admin.site.register(ConversationParticipant)
admin.site.register(MessageAttachment)
