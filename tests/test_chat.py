import unittest

from app import app


class ChatEndpointTests(unittest.TestCase):
    def setUp(self):
        self.client = app.test_client()

    def test_chat_handles_login_question(self):
        response = self.client.post(
            "/api/chat",
            json={"message": "How do I login to the dashboard?"},
        )
        data = response.get_json()
        self.assertEqual(response.status_code, 200)
        self.assertTrue(data["success"])
        text = data["response"].lower()
        self.assertIn("dashboard", text)
        self.assertTrue(
            "login" in text or "log in" in text,
            f"'login' or 'log in' not found in response: {text}",
        )

    def test_chat_handles_general_question(self):
        response = self.client.post(
            "/api/chat",
            json={"message": "What can you do for me?"},
        )
        data = response.get_json()
        self.assertEqual(response.status_code, 200)
        self.assertTrue(data["success"])
        text = data["response"].lower()
        self.assertIn("help", text)


if __name__ == "__main__":
    unittest.main()
