from rest_framework.test import APITestCase

from .models import MoodCheckIn


def register_and_login(client, username="moodtester"):
    client.post("/api/v1/auth/register", {
        "fullname": username, "username": username,
        "email": f"{username}@example.com", "password": "SuperSecure123",
    })
    response = client.post("/api/v1/auth/login", {"username": username, "password": "SuperSecure123"})
    return response.data["access_token"]


def auth_header(token):
    return {"HTTP_AUTHORIZATION": f"Bearer {token}"}


class MoodCheckInTests(APITestCase):
    def setUp(self):
        self.token = register_and_login(self.client)

    def test_create_with_real_frontend_mood_values(self):
        # These are the exact 12 values MoodCheckin.tsx's `moods` array
        # uses — this test exists because Milestone 4 found a real bug
        # where an earlier, invented mood list rejected all of them.
        real_moods = [
            "Happy", "Sad", "Angry", "Excited", "Anxious", "Calm",
            "Frustrated", "Content", "Lonely", "Grateful", "Stressed", "Hopeful",
        ]
        for mood in real_moods:
            response = self.client.post("/api/v1/mood/", {
                "mood": mood, "reason": "test", "intensity": 5, "description": "",
            }, format="json", **auth_header(self.token))
            self.assertEqual(response.status_code, 201, f"mood '{mood}' was rejected")

    def test_invalid_mood_rejected(self):
        response = self.client.post("/api/v1/mood/", {
            "mood": "NotARealMood", "reason": "", "intensity": 5, "description": "",
        }, format="json", **auth_header(self.token))
        self.assertEqual(response.status_code, 400)

    def test_list_only_shows_own_checkins(self):
        other_token = register_and_login(self.client, "otheruser")
        MoodCheckIn.objects.create(
            owner_id=self._user_id("otheruser"), mood="Happy", intensity=5
        )
        response = self.client.get("/api/v1/mood/", **auth_header(self.token))
        self.assertEqual(len(response.data), 0)

    def _user_id(self, username):
        from users.models import User
        return User.objects.get(username=username).id
