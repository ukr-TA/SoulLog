"""
Sanctuary: feed visibility, interactions, and the journal-sharing link.

The visibility tests exist because this is the one place in SoulLog where
a user's writing is deliberately shown to other people. Getting that wrong
in the direction of "too visible" is the worst bug this product can have.
"""

from rest_framework.test import APITestCase

from journal.models import JournalEntry
from social.models import Connection
from users.models import User

from .models import PostBookmark, PostComment, PostReaction, SanctuaryPost


def register_and_login(client, username):
    client.post("/api/v1/auth/register", {
        "fullname": username.title(), "username": username,
        "email": f"{username}@example.com", "password": "SuperSecure123",
    })
    return client.post(
        "/api/v1/auth/login", {"username": username, "password": "SuperSecure123"}
    ).data["access_token"]


def auth(token):
    return {"HTTP_AUTHORIZATION": f"Bearer {token}"}


class FeedVisibilityTests(APITestCase):
    def setUp(self):
        self.a_token = register_and_login(self.client, "amara")
        self.b_token = register_and_login(self.client, "bishal")
        self.a = User.objects.get(username="amara")
        self.b = User.objects.get(username="bishal")

    def _feed(self, token):
        return self.client.get("/api/v1/sanctuary/posts/", **auth(token)).data["posts"]

    def test_public_post_is_visible_to_everyone(self):
        SanctuaryPost.objects.create(author=self.a, content="public thought")
        self.assertEqual(len(self._feed(self.b_token)), 1)

    def test_connections_post_is_hidden_from_strangers(self):
        SanctuaryPost.objects.create(
            author=self.a, content="for my people", visibility=SanctuaryPost.CONNECTIONS
        )
        self.assertEqual(len(self._feed(self.b_token)), 0)

        Connection.objects.create(requester=self.a, addressee=self.b, status=Connection.ACCEPTED)
        self.assertEqual(len(self._feed(self.b_token)), 1)

    def test_following_is_not_enough_for_a_connections_post(self):
        """Following needs no consent. Connection does. That distinction is
        the entire reason the two are separate models."""
        from social.models import Follow

        Follow.objects.create(follower=self.b, following=self.a)
        SanctuaryPost.objects.create(
            author=self.a, content="for my people", visibility=SanctuaryPost.CONNECTIONS
        )
        self.assertEqual(len(self._feed(self.b_token)), 0)

    def test_blocked_author_disappears_from_the_feed(self):
        SanctuaryPost.objects.create(author=self.a, content="hello")
        self.client.post(f"/api/v1/social/block/{self.a.id}/", **auth(self.b_token))
        self.assertEqual(len(self._feed(self.b_token)), 0)

    def test_deleted_post_is_gone_but_the_row_survives(self):
        post = SanctuaryPost.objects.create(author=self.a, content="hello")
        self.client.delete(f"/api/v1/sanctuary/posts/{post.id}/", **auth(self.a_token))
        self.assertEqual(len(self._feed(self.b_token)), 0)
        self.assertTrue(SanctuaryPost.objects.filter(pk=post.pk).exists())

    def test_you_always_see_your_own_posts(self):
        SanctuaryPost.objects.create(
            author=self.a, content="mine", visibility=SanctuaryPost.CONNECTIONS
        )
        self.assertEqual(len(self._feed(self.a_token)), 1)


class JournalSharingTests(APITestCase):
    def setUp(self):
        self.a_token = register_and_login(self.client, "amara")
        self.b_token = register_and_login(self.client, "bishal")
        self.a = User.objects.get(username="amara")

    def test_private_entry_cannot_be_shared(self):
        entry = JournalEntry.objects.create(owner=self.a, title="t", content="c")
        response = self.client.post("/api/v1/sanctuary/share-entry/", {"entry_id": entry.id},
                                     format="json", **auth(self.a_token))
        self.assertEqual(response.status_code, 400)
        self.assertEqual(SanctuaryPost.objects.count(), 0)

    def test_sharing_twice_does_not_duplicate(self):
        entry = JournalEntry.objects.create(
            owner=self.a, title="t", content="c", visibility="community"
        )
        self.client.post("/api/v1/sanctuary/share-entry/", {"entry_id": entry.id},
                          format="json", **auth(self.a_token))
        self.client.post("/api/v1/sanctuary/share-entry/", {"entry_id": entry.id},
                          format="json", **auth(self.a_token))
        self.assertEqual(SanctuaryPost.objects.count(), 1)

    def test_unsharing_the_entry_removes_the_post_from_the_feed(self):
        """
        The property that makes "share to Sanctuary" safe to press: making
        the entry private again really does un-share it, rather than
        leaving a copy behind that nobody can find to delete.
        """
        entry = JournalEntry.objects.create(
            owner=self.a, title="t", content="c", visibility="community"
        )
        self.client.post("/api/v1/sanctuary/share-entry/", {"entry_id": entry.id},
                          format="json", **auth(self.a_token))

        feed = self.client.get("/api/v1/sanctuary/posts/", **auth(self.b_token)).data["posts"]
        self.assertEqual(len(feed), 1)

        entry.visibility = "private"
        entry.save(update_fields=["visibility"])

        feed = self.client.get("/api/v1/sanctuary/posts/", **auth(self.b_token)).data["posts"]
        self.assertEqual(len(feed), 0)


class InteractionTests(APITestCase):
    def setUp(self):
        self.a_token = register_and_login(self.client, "amara")
        self.b_token = register_and_login(self.client, "bishal")
        self.a = User.objects.get(username="amara")
        self.b = User.objects.get(username="bishal")
        self.post = SanctuaryPost.objects.create(author=self.a, content="hello")

    def test_like_toggles(self):
        on = self.client.post(f"/api/v1/sanctuary/posts/{self.post.id}/like/", **auth(self.b_token))
        self.assertEqual(on.data, {"liked": True, "likes": 1})

        off = self.client.post(f"/api/v1/sanctuary/posts/{self.post.id}/like/", **auth(self.b_token))
        self.assertEqual(off.data, {"liked": False, "likes": 0})

    def test_one_like_per_person(self):
        self.client.post(f"/api/v1/sanctuary/posts/{self.post.id}/like/", **auth(self.b_token))
        self.client.post(f"/api/v1/sanctuary/posts/{self.post.id}/like/", **auth(self.a_token))
        self.assertEqual(PostReaction.objects.filter(post=self.post).count(), 2)

    def test_bookmark_is_private_to_the_saver(self):
        self.client.post(f"/api/v1/sanctuary/posts/{self.post.id}/bookmark/", **auth(self.b_token))

        theirs = self.client.get("/api/v1/sanctuary/posts/", **auth(self.b_token)).data["posts"][0]
        self.assertTrue(theirs["bookmarked"])

        authors_view = self.client.get(
            "/api/v1/sanctuary/posts/", **auth(self.a_token)
        ).data["posts"][0]
        self.assertFalse(authors_view["bookmarked"])
        self.assertEqual(PostBookmark.objects.count(), 1)

    def test_replies_cannot_nest_further(self):
        top = self.client.post(f"/api/v1/sanctuary/posts/{self.post.id}/comments/",
                                {"content": "top"}, format="json", **auth(self.b_token)).data
        reply = self.client.post(f"/api/v1/sanctuary/posts/{self.post.id}/comments/",
                                  {"content": "reply", "parent": top["id"]},
                                  format="json", **auth(self.a_token)).data
        deeper = self.client.post(f"/api/v1/sanctuary/posts/{self.post.id}/comments/",
                                   {"content": "deeper", "parent": reply["id"]},
                                   format="json", **auth(self.b_token))
        self.assertEqual(deeper.status_code, 400)

    def test_post_author_can_remove_a_comment_on_their_own_post(self):
        comment = PostComment.objects.create(post=self.post, author=self.b, content="unwanted")
        response = self.client.delete(
            f"/api/v1/sanctuary/posts/{self.post.id}/comments/{comment.id}/", **auth(self.a_token)
        )
        self.assertEqual(response.status_code, 200)

    def test_a_third_party_cannot_remove_a_comment(self):
        register_and_login(self.client, "chandra")
        c_token = self.client.post(
            "/api/v1/auth/login", {"username": "chandra", "password": "SuperSecure123"}
        ).data["access_token"]

        comment = PostComment.objects.create(post=self.post, author=self.b, content="mine")
        response = self.client.delete(
            f"/api/v1/sanctuary/posts/{self.post.id}/comments/{comment.id}/", **auth(c_token)
        )
        self.assertEqual(response.status_code, 403)

    def test_counts_in_the_feed_are_real(self):
        self.client.post(f"/api/v1/sanctuary/posts/{self.post.id}/like/", **auth(self.b_token))
        self.client.post(f"/api/v1/sanctuary/posts/{self.post.id}/comments/", {"content": "hi"},
                          format="json", **auth(self.b_token))
        self.client.post(f"/api/v1/sanctuary/posts/{self.post.id}/share/", **auth(self.b_token))

        card = self.client.get("/api/v1/sanctuary/posts/", **auth(self.a_token)).data["posts"][0]
        self.assertEqual(card["likes"], 1)
        self.assertEqual(card["comments"], 1)
        self.assertEqual(card["shares"], 1)

    def test_empty_post_is_refused(self):
        response = self.client.post("/api/v1/sanctuary/posts/", {"content": "   "},
                                     format="json", **auth(self.a_token))
        self.assertEqual(response.status_code, 400)
