"""
Tests for authentication, password reset, settings, and account
management (spec §78-79). Every test here corresponds to a check that
was previously done by hand with curl in earlier milestones — this
locks those guarantees in permanently.
"""

from django.core import mail
from rest_framework.test import APITestCase

from .models import User


def register(client, username="alice", password="SuperSecure123", email=None):
    return client.post("/api/v1/auth/register", {
        "fullname": "Alice Test",
        "username": username,
        "email": email or f"{username}@example.com",
        "password": password,
    })


def login(client, username="alice", password="SuperSecure123"):
    return client.post("/api/v1/auth/login", {"username": username, "password": password})


def auth_header(token):
    return {"HTTP_AUTHORIZATION": f"Bearer {token}"}


class RegistrationTests(APITestCase):
    def test_register_creates_user(self):
        response = register(self.client)
        self.assertEqual(response.status_code, 201)
        self.assertTrue(User.objects.filter(username="alice").exists())

    def test_register_creates_profile_and_settings_automatically(self):
        register(self.client)
        user = User.objects.get(username="alice")
        self.assertTrue(hasattr(user, "profile"))
        self.assertTrue(hasattr(user, "app_settings"))

    def test_duplicate_username_rejected(self):
        register(self.client)
        response = register(self.client, email="different@example.com")
        self.assertEqual(response.status_code, 400)

    def test_duplicate_email_rejected(self):
        register(self.client, username="alice")
        response = register(self.client, username="someoneelse", email="alice@example.com")
        self.assertEqual(response.status_code, 400)

    def test_weak_password_rejected(self):
        response = self.client.post("/api/v1/auth/register", {
            "fullname": "Bob", "username": "bob", "email": "bob@example.com", "password": "1234567",
        })
        self.assertEqual(response.status_code, 400)


class LoginTests(APITestCase):
    def setUp(self):
        register(self.client)

    def test_login_returns_expected_token_shape(self):
        response = login(self.client)
        self.assertEqual(response.status_code, 200)
        for key in ("access_token", "refresh_token", "token_type", "expires_in"):
            self.assertIn(key, response.data)
        self.assertEqual(response.data["token_type"], "bearer")

    def test_wrong_password_rejected(self):
        response = login(self.client, password="WrongPassword123")
        self.assertEqual(response.status_code, 401)

    def test_me_requires_authentication(self):
        response = self.client.get("/api/v1/auth/me")
        self.assertEqual(response.status_code, 401)

    def test_me_returns_safe_fields_only(self):
        token = login(self.client).data["access_token"]
        response = self.client.get("/api/v1/auth/me", **auth_header(token))
        self.assertEqual(response.status_code, 200)
        self.assertNotIn("password", response.data)

    def test_token_refresh_works(self):
        refresh = login(self.client).data["refresh_token"]
        response = self.client.post("/api/v1/auth/refresh", {"refresh": refresh})
        self.assertEqual(response.status_code, 200)
        self.assertIn("access", response.data)


class PasswordResetTests(APITestCase):
    def setUp(self):
        register(self.client)

    def test_request_returns_same_response_for_real_and_fake_username(self):
        real = self.client.post("/api/v1/auth/password-reset/request/", {"username": "alice"})
        fake = self.client.post("/api/v1/auth/password-reset/request/", {"username": "nobody_at_all"})
        self.assertEqual(real.status_code, 200)
        self.assertEqual(fake.status_code, 200)
        self.assertEqual(real.data, fake.data)

    def test_request_only_emails_real_users(self):
        mail.outbox = []
        self.client.post("/api/v1/auth/password-reset/request/", {"username": "nobody_at_all"})
        self.assertEqual(len(mail.outbox), 0)
        self.client.post("/api/v1/auth/password-reset/request/", {"username": "alice"})
        self.assertEqual(len(mail.outbox), 1)

    def _get_uid_and_token(self):
        mail.outbox = []
        self.client.post("/api/v1/auth/password-reset/request/", {"username": "alice"})
        body = mail.outbox[0].body
        uid = [line.split(": ")[1] for line in body.splitlines() if line.startswith("uid:")][0]
        token = [line.split(": ")[1] for line in body.splitlines() if line.startswith("token:")][0]
        return uid, token

    def test_wrong_token_rejected(self):
        uid, _ = self._get_uid_and_token()
        response = self.client.post("/api/v1/auth/password-reset/confirm/", {
            "uid": uid, "token": "garbage", "new_password": "BrandNewPass123",
        })
        self.assertEqual(response.status_code, 400)

    def test_correct_token_resets_password_and_invalidates_itself(self):
        uid, token = self._get_uid_and_token()
        response = self.client.post("/api/v1/auth/password-reset/confirm/", {
            "uid": uid, "token": token, "new_password": "BrandNewPass123",
        })
        self.assertEqual(response.status_code, 200)

        self.assertEqual(login(self.client, password="SuperSecure123").status_code, 401)
        self.assertEqual(login(self.client, password="BrandNewPass123").status_code, 200)

        # Replay of the same token must now fail — it was single-use.
        replay = self.client.post("/api/v1/auth/password-reset/confirm/", {
            "uid": uid, "token": token, "new_password": "AnotherPass123",
        })
        self.assertEqual(replay.status_code, 400)


class ChangePasswordTests(APITestCase):
    def setUp(self):
        register(self.client)
        self.token = login(self.client).data["access_token"]

    def test_wrong_current_password_rejected(self):
        response = self.client.post("/api/v1/auth/change-password/", {
            "current_password": "WrongOne", "new_password": "NewStrongPass123",
        }, **auth_header(self.token))
        self.assertEqual(response.status_code, 400)

    def test_correct_current_password_changes_it(self):
        response = self.client.post("/api/v1/auth/change-password/", {
            "current_password": "SuperSecure123", "new_password": "NewStrongPass123",
        }, **auth_header(self.token))
        self.assertEqual(response.status_code, 200)
        self.assertEqual(login(self.client, password="NewStrongPass123").status_code, 200)

    def test_requires_authentication(self):
        response = self.client.post("/api/v1/auth/change-password/", {
            "current_password": "x", "new_password": "NewStrongPass123",
        })
        self.assertEqual(response.status_code, 401)


class SettingsTests(APITestCase):
    def setUp(self):
        register(self.client)
        self.token = login(self.client).data["access_token"]

    def test_get_settings_requires_auth(self):
        self.assertEqual(self.client.get("/api/v1/settings/").status_code, 401)

    def test_get_returns_all_expected_groups(self):
        response = self.client.get("/api/v1/settings/", **auth_header(self.token))
        self.assertEqual(response.status_code, 200)
        for group in ("profile", "privacy", "notifications", "journaling", "social", "appearance"):
            self.assertIn(group, response.data)

    def test_patch_persists_across_requests(self):
        self.client.patch("/api/v1/settings/", {"appearance": {"fontSize": "large"}},
                           format="json", **auth_header(self.token))
        response = self.client.get("/api/v1/settings/", **auth_header(self.token))
        self.assertEqual(response.data["appearance"]["fontSize"], "large")

    def test_journal_visibility_friends_maps_to_connections_and_back(self):
        self.client.patch("/api/v1/settings/", {"privacy": {"journalVisibility": "friends"}},
                           format="json", **auth_header(self.token))
        user = User.objects.get(username="alice")
        user.refresh_from_db()
        self.assertEqual(user.profile.journal_visibility, "connections")

        response = self.client.get("/api/v1/settings/", **auth_header(self.token))
        self.assertEqual(response.data["privacy"]["journalVisibility"], "friends")

    def test_profile_views_toggle_round_trips(self):
        """
        The Settings screen's Profile Views switch.

        It is off by default and it is reciprocal — turning it on is what
        starts any recording, both of who looks at you and of your looking
        at other people. The switch therefore has to be reachable from
        Settings, not only from the profile screen, which is what this
        checks.
        """
        response = self.client.get("/api/v1/settings/", **auth_header(self.token))
        self.assertFalse(response.data["privacy"]["showProfileViews"])

        self.client.patch("/api/v1/settings/", {"privacy": {"showProfileViews": True}},
                           format="json", **auth_header(self.token))

        user = User.objects.get(username="alice")
        self.assertTrue(user.profile.show_profile_views)

        response = self.client.get("/api/v1/settings/", **auth_header(self.token))
        self.assertTrue(response.data["privacy"]["showProfileViews"])

    def test_email_cannot_be_changed_via_settings(self):
        original_email = User.objects.get(username="alice").email
        self.client.patch("/api/v1/settings/", {"profile": {"email": "hijacked@example.com"}},
                           format="json", **auth_header(self.token))
        user = User.objects.get(username="alice")
        self.assertEqual(user.email, original_email)


class DeleteAccountTests(APITestCase):
    def setUp(self):
        register(self.client)
        self.token = login(self.client).data["access_token"]

    def test_wrong_password_rejected(self):
        response = self.client.delete("/api/v1/auth/account/", {"password": "wrong"},
                                       format="json", **auth_header(self.token))
        self.assertEqual(response.status_code, 400)
        self.assertTrue(User.objects.filter(username="alice").exists())

    def test_correct_password_deletes_account_and_cascades(self):
        from journal.models import JournalEntry

        self.client.post("/api/v1/journal/", {"title": "t", "content": "c", "entry_type": "text"},
                          format="json", **auth_header(self.token))
        self.assertEqual(JournalEntry.objects.count(), 1)

        response = self.client.delete("/api/v1/auth/account/", {"password": "SuperSecure123"},
                                       format="json", **auth_header(self.token))
        self.assertEqual(response.status_code, 200)
        self.assertFalse(User.objects.filter(username="alice").exists())
        # CASCADE must have taken the journal entry with it — nothing orphaned.
        self.assertEqual(JournalEntry.objects.count(), 0)
