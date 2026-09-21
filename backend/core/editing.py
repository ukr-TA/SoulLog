"""
Editing something you wrote.

Four places in SoulLog let you write a short piece of text — journal
comments, Sanctuary comments, library comments, and messages — and all
four could be posted and deleted but never corrected. This module holds
the rules they share, so that "edit" means the same thing everywhere
rather than four subtly different things.

The rules:

  Only the author may edit. Not the owner of the post, not staff. A post
  owner can *remove* an unwanted comment from their own post — that's
  already true — but rewriting someone else's words under their name is
  not a power this app should have.

  Editing is visible. `edited_at` is set and the UI shows "edited". A
  silent edit lets someone change what they said after it was replied to,
  which turns a conversation into an argument about what was actually
  written.

  Deleted stays deleted. A soft-deleted message can't be edited back into
  existence.

  There is a time limit, and it is generous. `EDIT_WINDOW_HOURS` exists so
  that a years-old comment in a long thread can't quietly become something
  else; it's long enough that ordinary corrections are never blocked.
"""

from django.utils import timezone
from rest_framework.exceptions import PermissionDenied, ValidationError

# Long enough that nobody hits it fixing a typo or rewording something
# they regret, short enough that an old comment can't be repurposed after
# the conversation around it has settled.
EDIT_WINDOW_HOURS = 24 * 7

MAX_LENGTH = 5000


def check_editable(instance, user, *, text_attr="content", window_hours=EDIT_WINDOW_HOURS):
    """
    Raise if `user` may not edit `instance` right now. Returns nothing.

    Expects the object to have an `author` or `sender`, a `created_at`,
    and optionally an `is_deleted`.
    """
    author_id = getattr(instance, "author_id", None)
    if author_id is None:
        author_id = getattr(instance, "sender_id", None)

    if author_id != user.id:
        raise PermissionDenied("You can only edit your own words.")

    if getattr(instance, "is_deleted", False):
        raise ValidationError({"detail": "This was deleted and can't be edited."})

    age_hours = (timezone.now() - instance.created_at).total_seconds() / 3600
    if age_hours > window_hours:
        days = int(window_hours // 24)
        raise ValidationError({
            "detail": f"This is more than {days} days old and can no longer be edited."
        })

    del text_attr


def clean_text(raw, *, field="content", max_length=MAX_LENGTH):
    """Validate replacement text the same way everywhere."""
    text = (raw or "").strip()
    if not text:
        raise ValidationError({field: ["This can't be empty. Delete it instead."]})
    if len(text) > max_length:
        raise ValidationError({field: [f"Keep this under {max_length} characters."]})
    return text


def apply_edit(instance, text, *, text_attr="content"):
    """Write the new text and stamp `edited_at`, in one save."""
    setattr(instance, text_attr, text)
    instance.edited_at = timezone.now()
    instance.save(update_fields=[text_attr, "edited_at"])
    return instance
