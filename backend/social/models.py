from django.conf import settings
from django.db import models
from django.db.models import Q


class ConnectionQuerySet(models.QuerySet):
    def accepted(self):
        return self.filter(status=Connection.ACCEPTED)

    def involving(self, user):
        return self.filter(Q(requester=user) | Q(addressee=user))

    def between(self, user_a, user_b):
        return self.filter(
            Q(requester=user_a, addressee=user_b) | Q(requester=user_b, addressee=user_a)
        )


class Connection(models.Model):
    """
    One row per *pair* of users, not one row per direction.

    This is the decision everything else in the social layer rests on, so
    it's worth stating plainly. A symmetric friendship stored as two rows
    means every read has to reconcile two records that can disagree, and
    every write has to keep them in step. One row with a requester and an
    addressee cannot get out of sync with itself. The cost is that every
    query needs the `involving()`/`between()` helpers above rather than a
    naive `filter(user=...)` — a small, contained cost paid in one place.

    The pair is also normalised by a database-level constraint (see Meta):
    there can only ever be one Connection row for any two users, in either
    direction, so a simultaneous "A adds B" and "B adds A" cannot produce
    two competing requests.

    States:
      pending   A asked, B hasn't answered.
      accepted  Mutual connection. This is what `visibility='connections'`
                on a journal entry actually means.
      declined  B said no. The row is kept rather than deleted so A can't
                re-send the same request in a loop, and so B isn't
                repeatedly re-suggested A.
      blocked   B (or A) blocked the other. `blocked_by` records who did it,
                because unblocking must only be possible for that person.

    Following is separate and deliberately so — see `Follow` below.
    """

    PENDING = "pending"
    ACCEPTED = "accepted"
    DECLINED = "declined"
    BLOCKED = "blocked"

    STATUS_CHOICES = [
        (PENDING, "Pending"),
        (ACCEPTED, "Accepted"),
        (DECLINED, "Declined"),
        (BLOCKED, "Blocked"),
    ]

    requester = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="connections_sent"
    )
    addressee = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="connections_received"
    )
    status = models.CharField(max_length=10, choices=STATUS_CHOICES, default=PENDING)

    blocked_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name="blocks_made",
    )

    is_demo = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)
    responded_at = models.DateTimeField(null=True, blank=True)
    updated_at = models.DateTimeField(auto_now=True)

    objects = ConnectionQuerySet.as_manager()

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["requester", "addressee"], name="unique_connection_pair"
            ),
            models.CheckConstraint(
                condition=~Q(requester=models.F("addressee")),
                name="no_self_connection",
            ),
        ]
        indexes = [
            models.Index(fields=["requester", "status"]),
            models.Index(fields=["addressee", "status"]),
        ]

    def __str__(self):
        return f"{self.requester.username} -> {self.addressee.username} ({self.status})"

    def other_user(self, user):
        return self.addressee if self.requester_id == user.id else self.requester


class Follow(models.Model):
    """
    A one-way follow, kept entirely separate from Connection.

    These are two genuinely different relationships and merging them would
    be wrong in both directions: a connection is mutual and gates access to
    `visibility='connections'` journal entries, while following is one-way,
    needs no consent, and only affects what appears in a feed. A user can
    follow a mentor they have no connection with; two connected users need
    not follow each other's community posts.
    """

    follower = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="following"
    )
    following = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="followers"
    )

    is_demo = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["follower", "following"], name="unique_follow"),
            models.CheckConstraint(
                condition=~Q(follower=models.F("following")), name="no_self_follow"
            ),
        ]
        indexes = [models.Index(fields=["following", "-created_at"])]

    def __str__(self):
        return f"{self.follower.username} follows {self.following.username}"
