"""
Profiles: visibility, contact-detail privacy, and image replacement.

`profile_visibility` is the setting most likely to be quietly wrong —
it's enforced in two places (the serializer and the view) and both need
checking, because only one of them runs for a feed.
"""

import io

from django.core.files.uploadedfile import SimpleUploadedFile
from rest_framework.test import APITestCase

from social.models import Connection

from .models import User


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


class MyProfileTests(APITestCase):
    def setUp(self):
        self.token = register_and_login(self.client, "amara")
        self.user = User.objects.get(username="amara")

    def test_update_accepts_both_camel_and_snake_case(self):
        response = self.client.patch("/api/v1/profile/", {
            "bio": "Learning to go slower.",
            "currentFocus": "Writing three times a week",
            "interests": ["mindfulness", "writing"],
        }, format="json", **auth(self.token))

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["bio"], "Learning to go slower.")
        self.assertEqual(response.data["current_focus"], "Writing three times a week")
        self.assertEqual(response.data["interests"], ["mindfulness", "writing"])

    def test_onboarding_completes_itself_from_real_content(self):
        self.assertFalse(self.client.get("/api/v1/profile/", **auth(self.token)).data[
            "onboardingCompleted"
        ])

        self.client.patch("/api/v1/profile/", {"bio": "Hello."}, format="json", **auth(self.token))
        self.assertTrue(self.client.get("/api/v1/profile/", **auth(self.token)).data[
            "onboardingCompleted"
        ])

    def test_avatar_upload_and_replacement_does_not_accumulate_files(self):
        first = self.client.patch("/api/v1/profile/", {"profile_image": real_png("one.png")},
                                   format="multipart", **auth(self.token))
        self.assertEqual(first.status_code, 200)
        self.user.refresh_from_db()
        original_path = self.user.profile.profile_image.name

        self.client.patch("/api/v1/profile/", {"profile_image": real_png("two.png")},
                           format="multipart", **auth(self.token))
        self.user.refresh_from_db()
        new_path = self.user.profile.profile_image.name

        self.assertNotEqual(original_path, new_path)
        self.assertFalse(self.user.profile.profile_image.storage.exists(original_path))

    def test_a_non_image_is_refused_as_an_avatar(self):
        bad = SimpleUploadedFile("avatar.png", b"not an image", content_type="image/png")
        response = self.client.patch("/api/v1/profile/", {"profile_image": bad},
                                      format="multipart", **auth(self.token))
        self.assertEqual(response.status_code, 400)

    def test_stats_are_real(self):
        from journal.models import JournalEntry

        JournalEntry.objects.create(owner=self.user, title="t", content="c")
        response = self.client.get("/api/v1/profile/", **auth(self.token))
        self.assertEqual(response.data["stats"]["entries"], 1)
        self.assertEqual(response.data["stats"]["privateEntries"], 1)


class PublicProfileTests(APITestCase):
    def setUp(self):
        self.a_token = register_and_login(self.client, "amara")
        self.b_token = register_and_login(self.client, "bishal")
        self.a = User.objects.get(username="amara")
        self.b = User.objects.get(username="bishal")

        profile = self.a.profile
        profile.bio = "Quietly getting on with it."
        profile.location = "Kathmandu"
        profile.save()

    def test_public_profile_shows_the_body(self):
        response = self.client.get("/api/v1/profile/amara/", **auth(self.b_token))
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["bio"], "Quietly getting on with it.")

    def test_private_profile_is_a_404_not_a_403(self):
        profile = self.a.profile
        profile.profile_visibility = "private"
        profile.save()

        response = self.client.get("/api/v1/profile/amara/", **auth(self.b_token))
        self.assertEqual(response.status_code, 404)

    def test_connections_only_profile_shows_identity_but_not_the_body(self):
        profile = self.a.profile
        profile.profile_visibility = "connections"
        profile.save()

        restricted = self.client.get("/api/v1/profile/amara/", **auth(self.b_token))
        self.assertEqual(restricted.status_code, 200)
        self.assertTrue(restricted.data["restricted"])
        self.assertNotIn("bio", restricted.data)

        Connection.objects.create(requester=self.a, addressee=self.b, status=Connection.ACCEPTED)
        full = self.client.get("/api/v1/profile/amara/", **auth(self.b_token))
        self.assertFalse(full.data["restricted"])
        self.assertEqual(full.data["bio"], "Quietly getting on with it.")

    def test_contact_details_are_absent_not_blank_when_not_shared(self):
        """Absent, so a client can't render an empty row that implies there
        is a value being withheld."""
        response = self.client.get("/api/v1/profile/amara/", **auth(self.b_token))
        self.assertNotIn("email", response.data)
        self.assertNotIn("phone", response.data)

        profile = self.a.profile
        profile.show_email = True
        profile.save()

        response = self.client.get("/api/v1/profile/amara/", **auth(self.b_token))
        self.assertEqual(response.data["email"], "amara@example.com")

    def test_blocked_viewer_gets_a_404(self):
        self.client.post(f"/api/v1/social/block/{self.b.id}/", **auth(self.a_token))
        response = self.client.get("/api/v1/profile/amara/", **auth(self.b_token))
        self.assertEqual(response.status_code, 404)

    def test_relationship_state_drives_the_button(self):
        response = self.client.get("/api/v1/profile/amara/", **auth(self.b_token))
        self.assertEqual(response.data["relationship"]["state"], "none")

        self.client.post("/api/v1/social/requests/create/", {"username": "amara"},
                          format="json", **auth(self.b_token))
        response = self.client.get("/api/v1/profile/amara/", **auth(self.b_token))
        self.assertEqual(response.data["relationship"]["state"], "pending")
        self.assertEqual(response.data["relationship"]["direction"], "outgoing")

    def test_a_blocked_person_does_not_learn_they_were_blocked(self):
        self.client.post(f"/api/v1/social/block/{self.b.id}/", **auth(self.a_token))
        from users.public import PublicUserSerializer

        data = PublicUserSerializer(self.a, context={"viewer": self.b}).data
        self.assertEqual(data["relationship"]["state"], "none")

    def test_mentor_directory_lists_only_those_who_opted_in(self):
        response = self.client.get("/api/v1/profile/mentors/", **auth(self.b_token))
        self.assertEqual(len(response.data), 0)

        profile = self.a.profile
        profile.mentor_available = True
        profile.save()

        response = self.client.get("/api/v1/profile/mentors/", **auth(self.b_token))
        self.assertEqual([row["username"] for row in response.data], ["amara"])


class SharedEntryFeedTests(APITestCase):
    def setUp(self):
        self.a_token = register_and_login(self.client, "amara")
        self.b_token = register_and_login(self.client, "bishal")
        self.a = User.objects.get(username="amara")

    def test_anonymous_sharing_withholds_the_author_entirely(self):
        """Not 'returned but please don't render it' — the author id isn't
        in the payload at all. Otherwise the setting is a UI convention
        rather than a guarantee."""
        from journal.models import JournalEntry

        JournalEntry.objects.create(
            owner=self.a, title="t", content="c",
            visibility="community", identity="anonymous",
        )
        response = self.client.get("/api/v1/journal/shared/", **auth(self.b_token))
        entry = response.data["entries"][0]

        self.assertEqual(entry["author"]["name"], "Someone")
        self.assertIsNone(entry["author"]["id"])

    def test_include_mood_off_withholds_the_mood(self):
        from journal.models import JournalEntry

        JournalEntry.objects.create(
            owner=self.a, title="t", content="c", mood="Anxious",
            visibility="community", include_mood=False,
        )
        response = self.client.get("/api/v1/journal/shared/", **auth(self.b_token))
        self.assertEqual(response.data["entries"][0]["mood"], "")

    def test_private_entries_never_appear(self):
        from journal.models import JournalEntry

        JournalEntry.objects.create(owner=self.a, title="t", content="secret")
        response = self.client.get("/api/v1/journal/shared/", **auth(self.b_token))
        self.assertEqual(response.data["entries"], [])
