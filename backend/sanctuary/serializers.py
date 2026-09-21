"""
Sanctuary payloads, shaped to the `Post` and `Comment` interfaces
`Sanctuary.tsx` already declares.

The counts here — likes, comments, shares — are all `COUNT(*)` over real
rows, annotated in one query by the view rather than counted per post.
`liked` and `bookmarked` are resolved with two set lookups for the whole
page, not a query per card: a feed that issues 3N queries is the thing that
makes a social product feel slow at exactly the point it starts working.
"""

from django.utils import timezone

from users.public import avatar_url, initials_for


def humanize_age(moment):
    seconds = (timezone.now() - moment).total_seconds()
    minutes = int(seconds // 60)
    if minutes < 1:
        return "just now"
    if minutes < 60:
        return f"{minutes} min ago"
    hours = minutes // 60
    if hours < 24:
        return f"{hours} hour{'s' if hours != 1 else ''} ago"
    days = hours // 24
    if days < 7:
        return f"{days} day{'s' if days != 1 else ''} ago"
    return moment.strftime("%b %d, %Y")


def serialize_author(user, request=None):
    name = user.fullname or user.username
    profile = getattr(user, "profile", None)
    return {
        "id": user.id,
        "username": user.username,
        "name": name,
        "avatar": initials_for(user),
        "avatarUrl": avatar_url(user, request),
        # 'verified' in the UI means a completed, public profile — a real,
        # checkable property of the account rather than a badge someone
        # decided to draw. It is not an identity verification claim.
        "verified": bool(
            profile
            and profile.onboarding_completed
            and profile.profile_visibility == "public"
            and (profile.bio or "").strip()
        ),
    }


def serialize_comment(comment, liked_comment_ids, request=None, include_replies=True):
    data = {
        "id": comment.id,
        "author": comment.author.fullname or comment.author.username,
        "authorId": comment.author_id,
        "avatar": initials_for(comment.author),
        "avatarUrl": avatar_url(comment.author, request),
        "content": comment.content,
        "timestamp": humanize_age(comment.created_at),
        "createdAt": comment.created_at.isoformat(),
        "likes": comment.reactions.count(),
        "liked": comment.id in liked_comment_ids,
        "parent": comment.parent_id,
        "editedAt": comment.edited_at.isoformat() if comment.edited_at else None,
        "isOwn": bool(request and comment.author_id == getattr(request.user, "id", None)),
    }
    if include_replies and comment.parent_id is None:
        data["replies"] = [
            serialize_comment(reply, liked_comment_ids, request, include_replies=False)
            for reply in comment.replies.all()
        ]
    return data


def serialize_media(media, request=None):
    url = media.file.url
    return {
        "id": media.id,
        "type": media.kind,
        "url": request.build_absolute_uri(url) if request else url,
        "alt": media.alt_text,
    }


def serialize_post(post, viewer, liked_post_ids, bookmarked_post_ids, request=None, comments=None):
    media = list(post.media.all())
    return {
        "id": post.id,
        "author": serialize_author(post.author, request),
        "content": post.content,
        "tags": post.tags or [],
        "timestamp": humanize_age(post.created_at),
        "createdAt": post.created_at.isoformat(),
        "likes": getattr(post, "like_count", None) if hasattr(post, "like_count") else post.reactions.count(),
        "comments": getattr(post, "comment_count", None) if hasattr(post, "comment_count") else post.comments.count(),
        "shares": getattr(post, "share_count_real", None) if hasattr(post, "share_count_real") else post.shares.count(),
        "liked": post.id in liked_post_ids,
        "bookmarked": post.id in bookmarked_post_ids,
        # The UI keeps its own open/closed state for the comment drawer; the
        # server has no business having an opinion about it, so this is
        # always False and the client owns it from there.
        "showComments": False,
        "media": serialize_media(media[0], request) if media else None,
        "allMedia": [serialize_media(item, request) for item in media],
        "commentsList": comments if comments is not None else [],
        "isOwn": post.author_id == viewer.id,
        "visibility": post.visibility,
        "sourceEntryId": post.source_entry_id,
    }
