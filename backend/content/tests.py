"""
Content library and community discovery.

Also covers the shared upload validator, since every media feature in
SoulLog depends on it and a hole there is a hole everywhere.
"""

import io

from django.core.exceptions import ValidationError
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase
from rest_framework.test import APITestCase

from core.uploads import UploadKind, validate_upload
from users.models import User

from .models import Content, ContentCategory, ContentView


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


def real_png(name="pic.png"):
    from PIL import Image

    buffer = io.BytesIO()
    Image.new("RGB", (8, 8), "white").save(buffer, format="PNG")
    return SimpleUploadedFile(name, buffer.getvalue(), content_type="image/png")


class UploadValidationTests(TestCase):
    def test_a_real_image_passes(self):
        kind, extension, mime = validate_upload(real_png())
        self.assertEqual(kind, UploadKind.IMAGE)
        self.assertEqual(extension, ".png")
        self.assertEqual(mime, "image/png")

    def test_a_file_that_only_claims_to_be_an_image_is_rejected(self):
        """The whole reason content is verified rather than trusted: the
        extension and the Content-Type are both attacker-controlled."""
        fake = SimpleUploadedFile("payload.png", b"#!/bin/sh\nrm -rf /", content_type="image/png")
        with self.assertRaises(ValidationError):
            validate_upload(fake)

    def test_unknown_extensions_are_rejected(self):
        with self.assertRaises(ValidationError):
            validate_upload(SimpleUploadedFile("thing.exe", b"MZ", content_type="image/png"))

    def test_empty_files_are_rejected(self):
        with self.assertRaises(ValidationError):
            validate_upload(SimpleUploadedFile("empty.png", b"", content_type="image/png"))

    def test_allowed_kinds_are_enforced(self):
        with self.assertRaises(ValidationError):
            validate_upload(real_png(), allowed_kinds={UploadKind.AUDIO})

    def test_size_limit_is_enforced_server_side(self):
        from django.test import override_settings

        with override_settings(MAX_IMAGE_UPLOAD_MB=0):
            with self.assertRaises(ValidationError):
                validate_upload(real_png())

    def test_the_clients_filename_is_discarded(self):
        from core.uploads import safe_upload_name

        class Fake:
            UPLOAD_PREFIX = "journal"
            owner_id = 7

        stored = safe_upload_name(Fake(), "../../etc/passwd.png")
        self.assertTrue(stored.startswith("journal/7/"))
        self.assertNotIn("..", stored)
        self.assertNotIn("passwd", stored)


class JournalMediaTests(APITestCase):
    def setUp(self):
        self.a_token = register_and_login(self.client, "amara")
        self.b_token = register_and_login(self.client, "bishal")
        self.a = User.objects.get(username="amara")

    def test_owner_can_attach_a_photo_and_the_entry_type_follows(self):
        from journal.models import JournalEntry

        entry = JournalEntry.objects.create(owner=self.a, title="t", content="c")
        response = self.client.post(
            f"/api/v1/journal/{entry.id}/media/", {"file": real_png()},
            format="multipart", **auth(self.a_token)
        )
        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.data["kind"], "image")

        entry.refresh_from_db()
        self.assertEqual(entry.entry_type, "photo")

    def test_nobody_else_can_attach_to_your_entry(self):
        from journal.models import JournalEntry

        entry = JournalEntry.objects.create(owner=self.a, title="t", content="c")
        response = self.client.post(
            f"/api/v1/journal/{entry.id}/media/", {"file": real_png()},
            format="multipart", **auth(self.b_token)
        )
        self.assertEqual(response.status_code, 404)


class LibraryTests(APITestCase):
    def setUp(self):
        self.a_token = register_and_login(self.client, "amara")
        self.b_token = register_and_login(self.client, "bishal")
        self.a = User.objects.get(username="amara")
        self.b = User.objects.get(username="bishal")
        self.item = Content.objects.create(
            author=self.a,
            title="Breathwork basics",
            description="Simple patterns.",
            body="Simple patterns.",
            category=ContentCategory.objects.get(slug="wellness"),
            duration_seconds=323,
        )

    def test_categories_come_from_the_database_with_real_counts(self):
        response = self.client.get("/api/v1/content/categories/", **auth(self.a_token))
        wellness = next(row for row in response.data if row["id"] == "wellness")
        self.assertEqual(wellness["count"], 1)
        self.assertEqual(wellness["icon"], "💚")

    def test_duration_is_formatted_the_way_the_ui_shows_it(self):
        response = self.client.get(f"/api/v1/content/{self.item.id}/", **auth(self.a_token))
        self.assertEqual(response.data["duration"], "5:23")

    def test_view_count_counts_people_not_page_loads(self):
        for _ in range(3):
            self.client.post(f"/api/v1/content/{self.item.id}/progress/", {"seconds": 40},
                              format="json", **auth(self.b_token))

        self.item.refresh_from_db()
        self.assertEqual(self.item.view_count, 1)
        self.assertEqual(ContentView.objects.filter(content=self.item).count(), 1)

    def test_progress_only_moves_forward(self):
        self.client.post(f"/api/v1/content/{self.item.id}/progress/", {"seconds": 100},
                          format="json", **auth(self.b_token))
        response = self.client.post(f"/api/v1/content/{self.item.id}/progress/", {"seconds": 20},
                                     format="json", **auth(self.b_token))
        self.assertEqual(response.data["progressSeconds"], 100)

    def test_only_the_author_can_remove_an_item(self):
        response = self.client.delete(f"/api/v1/content/{self.item.id}/", **auth(self.b_token))
        self.assertEqual(response.status_code, 404)
        self.assertTrue(Content.objects.filter(pk=self.item.pk).exists())

    def test_blocked_authors_content_disappears(self):
        self.client.post(f"/api/v1/social/block/{self.a.id}/", **auth(self.b_token))
        response = self.client.get("/api/v1/content/", **auth(self.b_token))
        self.assertEqual(len(response.data["content"]), 0)

    def test_saving_is_private(self):
        self.client.post(f"/api/v1/content/{self.item.id}/save/", **auth(self.b_token))
        saved = self.client.get("/api/v1/content/?scope=saved", **auth(self.b_token))
        self.assertEqual(len(saved.data["content"]), 1)

        authors = self.client.get("/api/v1/content/?scope=saved", **auth(self.a_token))
        self.assertEqual(len(authors.data["content"]), 0)


class DiscoveryTests(APITestCase):
    def setUp(self):
        self.a_token = register_and_login(self.client, "amara")
        self.b_token = register_and_login(self.client, "bishal")
        self.a = User.objects.get(username="amara")

    def test_short_queries_return_nothing(self):
        response = self.client.get("/api/v1/community/search/?q=a", **auth(self.a_token))
        self.assertEqual(response.data["total"], 0)

    def test_search_finds_people_posts_and_content(self):
        from sanctuary.models import SanctuaryPost

        SanctuaryPost.objects.create(author=self.a, content="a note about gratitude")
        Content.objects.create(
            author=self.a, title="Gratitude practice", body="x",
            category=ContentCategory.objects.get(slug="growth"),
        )

        response = self.client.get("/api/v1/community/search/?q=gratitude", **auth(self.b_token))
        self.assertEqual(len(response.data["posts"]), 1)
        self.assertEqual(len(response.data["content"]), 1)

    def test_search_cannot_surface_a_post_the_feed_would_hide(self):
        """Search reuses the feed's own queryset precisely so this can't
        drift apart from it."""
        from sanctuary.models import SanctuaryPost

        SanctuaryPost.objects.create(
            author=self.a, content="private gratitude note",
            visibility=SanctuaryPost.CONNECTIONS,
        )
        response = self.client.get("/api/v1/community/search/?q=gratitude", **auth(self.b_token))
        self.assertEqual(len(response.data["posts"]), 0)

    def test_recent_searches_are_the_users_own_and_nobody_elses(self):
        self.client.get("/api/v1/community/search/?q=meditation", **auth(self.a_token))

        mine = self.client.get("/api/v1/community/search/suggestions/", **auth(self.a_token))
        self.assertIn("meditation", mine.data["recent"])

        theirs = self.client.get("/api/v1/community/search/suggestions/", **auth(self.b_token))
        self.assertEqual(theirs.data["recent"], [])

    def test_one_persons_repeated_search_never_becomes_trending(self):
        """The distinct-user threshold is a privacy control, not a nicety:
        without it, a platform-wide list would leak one person's searches."""
        for _ in range(10):
            self.client.get("/api/v1/community/search/?q=insomnia", **auth(self.a_token))

        suggestions = self.client.get(
            "/api/v1/community/search/suggestions/", **auth(self.b_token)
        )
        self.assertNotIn("insomnia", suggestions.data["trending"])

    def test_clearing_search_history_works(self):
        self.client.get("/api/v1/community/search/?q=meditation", **auth(self.a_token))
        self.client.delete("/api/v1/community/search/suggestions/", **auth(self.a_token))
        suggestions = self.client.get(
            "/api/v1/community/search/suggestions/", **auth(self.a_token)
        )
        self.assertEqual(suggestions.data["recent"], [])

    def test_topics_carry_real_follower_counts(self):
        self.client.post("/api/v1/community/topics/gratitude/follow/", **auth(self.a_token))
        response = self.client.get("/api/v1/community/topics/", **auth(self.a_token))
        gratitude = next(row for row in response.data if row["id"] == "gratitude")
        self.assertEqual(gratitude["followers"], 1)
        self.assertTrue(gratitude["following"])
