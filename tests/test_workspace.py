import unittest
import uuid
from datetime import datetime, timedelta
from unittest.mock import patch

from app import app, db
from model.user import User
from model.workspace import ChatConversation, ChatMessage, Reminder


class WorkspaceApiTests(unittest.TestCase):
    def setUp(self):
        self.client = app.test_client()
        self.user_ids = []
        self.user = self.create_user()
        self.login(self.user)

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
                Reminder.query.filter_by(user_id=user_id).delete(synchronize_session=False)
                User.query.filter_by(id=user_id).delete(synchronize_session=False)
            db.session.commit()
            db.session.remove()

    def create_user(self):
        user = User(
            name="Workspace Test",
            email="workspace-" + uuid.uuid4().hex + "@example.test",
        )
        user.set_password("test-password")
        with app.app_context():
            db.session.add(user)
            db.session.commit()
            self.user_ids.append(user.id)
        return {"id": user.id, "email": user.email}

    def login(self, user):
        response = self.client.post(
            "/login",
            data={"email": user["email"], "password": "test-password"},
        )
        self.assertEqual(response.status_code, 302)

    @patch("app.generate_chat_response", return_value="A clear, short answer.")
    def test_chat_is_saved_reopened_and_renamed(self, _generate_response):
        response = self.client.post("/api/chat", json={"message": "Plan a study session"})
        self.assertEqual(response.status_code, 200)
        conversation_id = response.get_json()["conversation_id"]

        history = self.client.get("/api/chats").get_json()["conversations"]
        self.assertEqual(len(history), 1)
        self.assertEqual(history[0]["title"], "Plan a study session")

        reopened = self.client.get(f"/api/chats/{conversation_id}").get_json()["conversation"]
        self.assertEqual([item["role"] for item in reopened["messages"]], ["user", "assistant"])

        renamed = self.client.patch(
            f"/api/chats/{conversation_id}",
            json={"title": "Study plan"},
        )
        self.assertEqual(renamed.status_code, 200)
        self.assertEqual(renamed.get_json()["conversation"]["title"], "Study plan")

        deleted = self.client.delete(f"/api/chats/{conversation_id}")
        self.assertEqual(deleted.status_code, 200)
        self.assertTrue(deleted.get_json()["success"])
        self.assertEqual(self.client.get(f"/api/chats/{conversation_id}").status_code, 404)

    @patch("app.generate_chat_response", return_value="Voice reply.")
    def test_voice_endpoint_uses_chat_response_and_persists(self, _generate_response):
        response = self.client.post("/api/voice", json={"message": "Hello Nexus"})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_json()["response"], "Voice reply.")
        self.assertIsNotNone(response.get_json()["conversation_id"])

    def test_reminders_can_be_completed_deleted_and_briefed(self):
        due_at = (datetime.now() + timedelta(hours=2)).isoformat(timespec="minutes")
        created = self.client.post(
            "/api/reminders",
            json={"text": "Review the project", "due_at": due_at},
        )
        self.assertEqual(created.status_code, 201)
        reminder_id = created.get_json()["reminder"]["id"]
        self.assertEqual(created.get_json()["reminder"]["text"], "Review the project")

        completed = self.client.patch(
            f"/api/reminders/{reminder_id}",
            json={"completed": True},
        )
        self.assertTrue(completed.get_json()["reminder"]["completed"])
        briefing = self.client.get("/api/briefing").get_json()
        self.assertEqual(briefing["pending_count"], 0)

        deleted = self.client.delete(f"/api/reminders/{reminder_id}")
        self.assertTrue(deleted.get_json()["success"])

    @patch("app.generate_chat_response", return_value="Private answer.")
    def test_conversations_are_isolated_between_users(self, _generate_response):
        created = self.client.post("/api/chat", json={"message": "Private question"})
        conversation_id = created.get_json()["conversation_id"]
        other_user = self.create_user()
        self.client.get("/logout")
        self.login(other_user)

        history = self.client.get("/api/chats").get_json()["conversations"]
        self.assertEqual(history, [])
        self.assertEqual(self.client.get(f"/api/chats/{conversation_id}").status_code, 404)
        self.assertEqual(self.client.delete(f"/api/chats/{conversation_id}").status_code, 404)


if __name__ == "__main__":
    unittest.main()