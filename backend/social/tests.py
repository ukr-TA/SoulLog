"""
Connections: the relationship state machine, and the rules that protect
people from each other.

The block tests are the important ones. A block that can be lifted by the
person who was blocked, or that leaves a follow in place, is worse than no
block at all — it looks like protection and isn't.
"""

from rest_framework.test import APITestCase

from users.models import User

from .models import Connection, Follow
from .relations import are_connected, can_message, mutual_connection_count


def register_and_login(client, username):
    client.post("/api/v1/auth/register", {
        "fullname": username.title(), "username": username,
        "email": f"{username}@example.com", "password": "SuperSecure123",
    })
    response = client.post("/api/v1/auth/login", {"username": username, "password": "SuperSecure123"})
    return response.data["access_token"]


def auth(token):
    return {"HTTP_AUTHORIZATION": f"Bearer {token}"}


class ConnectionFlowTests(APITestCase):
    def setUp(self):
        self.a_token = register_and_login(self.client, "amara")
        self.b_token = register_and_login(self.client, "bishal")
        self.a = User.objects.get(username="amara")
        self.b = User.objects.get(username="bishal")

    def test_request_accept_round_trip(self):
        sent = self.client.post("/api/v1/social/requests/create/", {"username": "bishal"},
                                 format="json", **auth(self.a_token))
        self.assertEqual(sent.status_code, 201)
        self.assertEqual(sent.data["status"], "pending")

        incoming = self.client.get("/api/v1/social/requests/", **auth(self.b_token))
        self.assertEqual(len(incoming.data), 1)
        self.assertEqual(incoming.data[0]["username"], "amara")

        accepted = self.client.post(
            f"/api/v1/social/requests/{sent.data['connection_id']}/respond/",
            {"action": "accept"}, format="json", **auth(self.b_token)
        )
        self.assertEqual(accepted.status_code, 200)
        self.assertTrue(are_connected(self.a, self.b))

    def test_requester_cannot_accept_their_own_request(self):
        sent = self.client.post("/api/v1/social/requests/create/", {"username": "bishal"},
                                 format="json", **auth(self.a_token))
        response = self.client.post(
            f"/api/v1/social/requests/{sent.data['connection_id']}/respond/",
            {"action": "accept"}, format="json", **auth(self.a_token)
        )
        self.assertEqual(response.status_code, 404)
        self.assertFalse(are_connected(self.a, self.b))

    def test_crossing_requests_become_one_accepted_connection(self):
        """B asking after A already asked accepts A's request rather than
        creating a second, competing row."""
        self.client.post("/api/v1/social/requests/create/", {"username": "bishal"},
                          format="json", **auth(self.a_token))
        self.client.post("/api/v1/social/requests/create/", {"username": "amara"},
                          format="json", **auth(self.b_token))

        self.assertEqual(Connection.objects.count(), 1)
        self.assertTrue(are_connected(self.a, self.b))

    def test_cannot_connect_with_self(self):
        response = self.client.post("/api/v1/social/requests/create/", {"username": "amara"},
                                     format="json", **auth(self.a_token))
        self.assertEqual(response.status_code, 400)

    def test_decline_then_resend_reuses_the_same_row(self):
        sent = self.client.post("/api/v1/social/requests/create/", {"username": "bishal"},
                                 format="json", **auth(self.a_token))
        self.client.post(f"/api/v1/social/requests/{sent.data['connection_id']}/respond/",
                          {"action": "decline"}, format="json", **auth(self.b_token))

        self.client.post("/api/v1/social/requests/create/", {"username": "bishal"},
                          format="json", **auth(self.a_token))
        self.assertEqual(Connection.objects.count(), 1)

    def test_removing_a_connection_deletes_it(self):
        Connection.objects.create(requester=self.a, addressee=self.b, status=Connection.ACCEPTED)
        response = self.client.delete(f"/api/v1/social/connections/{self.b.id}/", **auth(self.a_token))
        self.assertEqual(response.status_code, 200)
        self.assertFalse(are_connected(self.a, self.b))


class BlockTests(APITestCase):
    def setUp(self):
        self.a_token = register_and_login(self.client, "amara")
        self.b_token = register_and_login(self.client, "bishal")
        self.a = User.objects.get(username="amara")
        self.b = User.objects.get(username="bishal")

    def test_block_supersedes_connection_and_drops_follows(self):
        Connection.objects.create(requester=self.a, addressee=self.b, status=Connection.ACCEPTED)
        Follow.objects.create(follower=self.b, following=self.a)

        self.client.post(f"/api/v1/social/block/{self.b.id}/", **auth(self.a_token))

        self.assertFalse(are_connected(self.a, self.b))
        self.assertFalse(Follow.objects.filter(follower=self.b, following=self.a).exists())

    def test_blocked_user_cannot_unblock_themselves(self):
        self.client.post(f"/api/v1/social/block/{self.b.id}/", **auth(self.a_token))
        response = self.client.delete(f"/api/v1/social/block/{self.a.id}/", **auth(self.b_token))
        self.assertEqual(response.status_code, 403)
        self.assertTrue(
            Connection.objects.filter(status=Connection.BLOCKED).between(self.a, self.b).exists()
        )

    def test_blocker_can_unblock(self):
        self.client.post(f"/api/v1/social/block/{self.b.id}/", **auth(self.a_token))
        response = self.client.delete(f"/api/v1/social/block/{self.b.id}/", **auth(self.a_token))
        self.assertEqual(response.status_code, 200)

    def test_block_prevents_messaging_in_both_directions(self):
        self.client.post(f"/api/v1/social/block/{self.b.id}/", **auth(self.a_token))
        self.assertFalse(can_message(self.a, self.b)[0])
        self.assertFalse(can_message(self.b, self.a)[0])

    def test_blocked_user_does_not_appear_in_search(self):
        self.client.post(f"/api/v1/social/block/{self.b.id}/", **auth(self.a_token))
        results = self.client.get("/api/v1/social/search/?q=bishal", **auth(self.a_token))
        self.assertEqual(len(results.data), 0)


class MessagePermissionTests(APITestCase):
    def setUp(self):
        register_and_login(self.client, "amara")
        register_and_login(self.client, "bishal")
        self.a = User.objects.get(username="amara")
        self.b = User.objects.get(username="bishal")

    def test_everyone_is_the_default(self):
        self.assertTrue(can_message(self.a, self.b)[0])

    def test_nobody_refuses_everyone(self):
        self.b.profile.allow_messages = "nobody"
        self.b.profile.save()
        self.assertFalse(can_message(self.a, self.b)[0])

    def test_connections_only_refuses_strangers_and_allows_connections(self):
        self.b.profile.allow_messages = "connections"
        self.b.profile.save()
        self.assertFalse(can_message(self.a, self.b)[0])

        Connection.objects.create(requester=self.a, addressee=self.b, status=Connection.ACCEPTED)
        self.assertTrue(can_message(self.a, self.b)[0])

    def test_refusal_reason_does_not_reveal_a_block(self):
        """A blocked sender and a 'nobody' setting must be indistinguishable
        from the sender's side — otherwise the refusal message tells them
        something the blocker chose not to."""
        self.b.profile.allow_messages = "nobody"
        self.b.profile.save()
        nobody_reason = can_message(self.a, self.b)[1]

        self.b.profile.allow_messages = "everyone"
        self.b.profile.save()
        Connection.objects.create(
            requester=self.b, addressee=self.a, status=Connection.BLOCKED, blocked_by=self.b
        )
        blocked_reason = can_message(self.a, self.b)[1]

        self.assertEqual(nobody_reason, blocked_reason)


class SuggestionTests(APITestCase):
    def setUp(self):
        self.a_token = register_and_login(self.client, "amara")
        register_and_login(self.client, "bishal")
        register_and_login(self.client, "chandra")
        self.a = User.objects.get(username="amara")
        self.b = User.objects.get(username="bishal")
        self.c = User.objects.get(username="chandra")

    def test_no_shared_signal_means_no_suggestion(self):
        """SoulLog does not pad the grid. A stranger with nothing in common
        simply isn't suggested."""
        response = self.client.get("/api/v1/social/suggestions/", **auth(self.a_token))
        self.assertEqual(response.data, [])

    def test_shared_interests_produce_a_suggestion_with_a_true_reason(self):
        for user in (self.a, self.c):
            user.profile.favorite_topics = ["mindfulness"]
            user.profile.save()

        response = self.client.get("/api/v1/social/suggestions/", **auth(self.a_token))
        usernames = [row["username"] for row in response.data]
        self.assertIn("chandra", usernames)

        suggestion = next(row for row in response.data if row["username"] == "chandra")
        self.assertEqual(suggestion["reason"], "Similar interests")

    def test_existing_connections_are_never_suggested(self):
        self.c.profile.favorite_topics = ["mindfulness"]
        self.c.profile.save()
        self.a.profile.favorite_topics = ["mindfulness"]
        self.a.profile.save()
        Connection.objects.create(requester=self.a, addressee=self.c, status=Connection.ACCEPTED)

        response = self.client.get("/api/v1/social/suggestions/", **auth(self.a_token))
        self.assertNotIn("chandra", [row["username"] for row in response.data])

    def test_mutual_count_is_real(self):
        Connection.objects.create(requester=self.a, addressee=self.b, status=Connection.ACCEPTED)
        Connection.objects.create(requester=self.c, addressee=self.b, status=Connection.ACCEPTED)
        self.assertEqual(mutual_connection_count(self.a, self.c), 1)
