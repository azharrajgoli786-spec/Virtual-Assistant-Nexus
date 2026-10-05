import re
import unittest
import uuid
from unittest.mock import patch

from app import app, db
from model.user import User
from model.workspace import ChatConversation, ChatMessage, MemoryEntry


def csrf_token_for(client, path):
    page = client.get(path).data.decode("utf-8")
    match = re.search(r'name="csrf_token" value="([^"]+)"', page)
    assert match, f"CSRF token not found on {path}"
    return match.group(1)


class FoundationTests(unittest.TestCase):
    def setUp(self):
        self.client = app.test_client()
        self.user_ids = []
        self.password = "test-password"
        self.user = self.create_user()
        self.login(self.user["email"])

    def tearDown(self):
        with app.app_context():
            for user_id in self.user_ids:
                conversation_ids = [
                    item.id for item in ChatConversation.query.filter_by(user_id=user_id).all()
                ]
                if conversation_ids:
                    ChatMessage.query.filter(
                        ChatMessage.conversation_id.in_(conversation_ids)
                    ).delete(synchronize_session=False)
                    ChatConversation.query.filter(
                        ChatConversation.id.in_(conversation_ids)
                    ).delete(synchronize_session=False)
                MemoryEntry.query.filter_by(user_id=user_id).delete(
                    synchronize_session=False
                )
                User.query.filter_by(id=user_id).delete(synchronize_session=False)
            db.session.commit()
            db.session.remove()

    def create_user(self, email=None):
        address = email or ("foundation-" + uuid.uuid4().hex + "@example.test")
        user = User(name="Foundation Test", email=address)
        user.set_password(self.password)
        with app.app_context():
            db.session.add(user)
            db.session.commit()
            self.user_ids.append(user.id)
            return {"id": user.id, "email": user.email}

    def login(self, email):
        response = self.client.post(
            "/login",
            data={
                "email": email,
                "password": self.password,
                "csrf_token": csrf_token_for(self.client, "/login"),
            },
        )
        self.assertEqual(response.status_code, 302)

    def test_form_posts_require_csrf_token(self):
        anonymous = app.test_client()
        denied = anonymous.post(
            "/login",
            data={"email": "nobody@example.test", "password": "x"},
            follow_redirects=False,
        )
        self.assertEqual(denied.status_code, 400)

    def test_json_chat_api_still_works_without_form_token(self):
        with patch("app.generate_chat_response", return_value="API answer."):
            response = self.client.post("/api/chat", json={"message": "hi"})
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.get_json()["success"])

    def test_memory_is_private_per_user(self):
        saved = self.client.post("/api/memory", json={"text": "Private note"})
        self.assertEqual(saved.status_code, 200)

        mine = self.client.get("/api/memory").get_json()["memory"]
        self.assertIn("Private note", mine)

        other = self.create_user()
        self.client.get("/logout")
        self.login(other["email"])
        theirs = self.client.get("/api/memory").get_json()["memory"]
        self.assertNotIn("Private note", theirs)
        self.assertEqual(theirs, [])

    def test_anonymous_memory_is_empty_and_cannot_save(self):
        anonymous = app.test_client()
        listed = anonymous.get("/api/memory")
        self.assertEqual(listed.status_code, 200)
        self.assertEqual(listed.get_json()["memory"], [])

        denied = anonymous.post("/api/memory", json={"text": "nope"})
        self.assertEqual(denied.status_code, 401)
        self.assertFalse(denied.get_json()["success"])

    def test_memory_rejects_blank_and_oversized_text(self):
        blank = self.client.post("/api/memory", json={"text": "   "})
        self.assertEqual(blank.status_code, 400)

        oversized = self.client.post("/api/memory", json={"text": "x" * 501})
        self.assertEqual(oversized.status_code, 400)

    def test_password_reset_flow_updates_password(self):
        self.client.get("/logout")
        with app.app_context():
            user = User.query.filter_by(email=self.user["email"]).first()
            token = user.get_reset_token()

        reset_page = self.client.get(f"/reset-password/{token}")
        self.assertEqual(reset_page.status_code, 200)
        self.assertIn(b"Choose a new password", reset_page.data)

        weak = self.client.post(
            f"/reset-password/{token}",
            data={
                "password": "short",
                "csrf_token": csrf_token_for(
                    self.client, f"/reset-password/{token}"
                ),
            },
            follow_redirects=True,
        )
        self.assertIn(b"at least 8 characters", weak.data)

        updated = self.client.post(
            f"/reset-password/{token}",
            data={
                "password": "brand-new-password",
                "csrf_token": csrf_token_for(
                    self.client, f"/reset-password/{token}"
                ),
            },
            follow_redirects=True,
        )
        self.assertIn(b"Password updated", updated.data)

        with app.app_context():
            user = User.query.filter_by(email=self.user["email"]).first()
            self.assertTrue(user.check_password("brand-new-password"))

    def test_invalid_reset_token_redirects_to_forgot(self):
        self.client.get("/logout")
        response = self.client.get("/reset-password/broken-token", follow_redirects=True)
        self.assertIn(b"invalid or expired", response.data)

    def test_forgot_password_does_not_reveal_unknown_email(self):
        self.client.get("/logout")
        response = self.client.post(
            "/forgot-password",
            data={
                "email": "unknown-" + uuid.uuid4().hex + "@example.test",
                "csrf_token": csrf_token_for(self.client, "/forgot-password"),
            },
            follow_redirects=True,
        )
        self.assertIn(b"reset link", response.data.lower())


if __name__ == "__main__":
    unittest.main()
