"""
The questions the rest of SoulLog asks about relationships.

Journal visibility, community feeds, messaging permission and notification
delivery all need to know things like "are these two connected?" and "has
this person blocked me?". Those questions are answered here, once, so that
the answer cannot drift between subsystems — which is exactly how privacy
bugs happen.

Everything below takes and returns plain ids or booleans and does no
permission *decision* of its own; the calling view decides what to do with
the answer.
"""

from django.db.models import Q

from .models import Connection, Follow


def connected_user_ids(user):
    """Ids of everyone `user` has an accepted connection with."""
    rows = Connection.objects.accepted().involving(user).values_list("requester_id", "addressee_id")
    return {requester if addressee == user.id else addressee for requester, addressee in rows}


def are_connected(user_a, user_b):
    if user_a.id == user_b.id:
        return True
    return Connection.objects.accepted().between(user_a, user_b).exists()


def connection_between(user_a, user_b):
    return Connection.objects.between(user_a, user_b).first()


def blocked_user_ids(user):
    """
    Ids of everyone in a blocked relationship with `user` — in either
    direction.

    Blocking is deliberately symmetric in its *effect*: whoever pressed the
    button, the two of them stop seeing each other's content and stop being
    able to message or connect. Only `blocked_by` can undo it.
    """
    rows = (
        Connection.objects.filter(status=Connection.BLOCKED)
        .involving(user)
        .values_list("requester_id", "addressee_id")
    )
    return {requester if addressee == user.id else addressee for requester, addressee in rows}


def is_blocked_between(user_a, user_b):
    return Connection.objects.filter(status=Connection.BLOCKED).between(user_a, user_b).exists()


def mutual_connection_count(user, other):
    """How many accepted connections the two have in common."""
    return len(connected_user_ids(user) & connected_user_ids(other))


def following_ids(user):
    return set(Follow.objects.filter(follower=user).values_list("following_id", flat=True))


def follower_ids(user):
    return set(Follow.objects.filter(following=user).values_list("follower_id", flat=True))


def can_message(sender, recipient):
    """
    Whether `sender` is allowed to open or continue a conversation with
    `recipient`, honouring the recipient's `privacy.allowMessages` setting
    (Settings.tsx has always offered this control; until now nothing read it).

    Returns `(allowed: bool, reason: str | None)` — the reason is shown to
    the sender, so it must not leak anything about the recipient beyond the
    fact that they don't accept this message.
    """
    if sender.id == recipient.id:
        return False, "You can't start a conversation with yourself."

    if is_blocked_between(sender, recipient):
        # Deliberately the same wording as the 'nobody' case: telling a
        # sender they have specifically been blocked is information the
        # blocker did not choose to share.
        return False, "This person isn't accepting messages."

    preference = getattr(getattr(recipient, "profile", None), "allow_messages", "everyone")

    if preference == "nobody":
        return False, "This person isn't accepting messages."
    if preference == "connections" and not are_connected(sender, recipient):
        return False, "This person only accepts messages from their connections."
    return True, None


def visible_author_filter(user):
    """
    A `Q` object excluding content authored by anyone blocked in either
    direction. Applied to every public-facing feed queryset.
    """
    blocked = blocked_user_ids(user)
    if not blocked:
        return Q()
    return ~Q(author_id__in=blocked)
