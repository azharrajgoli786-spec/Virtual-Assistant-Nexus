import unittest
import uuid
from unittest.mock import patch

from sqlalchemy.exc import IntegrityError

from app import app, db
from model.user import User


class RegistrationTests(unittest.TestCase):
    def setUp(self):
        self.client = app.test_client()
        self.email = "registration-" + uuid.uuid4().hex + "@example.test"

    def tearDown(self):
        with app.app_context():
            db.session.rollback()
            User.query.filter_by(email=self.email).delete(synchronize_session=False)
            db.session.commit()
            db.session.remove()

    def register(self):
        return self.client.post(
            "/register",
            data={
                "name": "Registration Test",
                "email": self.email,
                "password": "test-password",
            },
            follow_redirects=True,
        )

    def test_duplicate_email_shows_friendly_message(self):
        first = self.register()
        duplicate = self.register()

        self.assertEqual(first.status_code, 200)
        self.assertIn(b"Account created successfully", first.data)
        self.assertEqual(duplicate.status_code, 200)
        self.assertIn(b"already registered", duplicate.data.lower())
        self.assertIn(b'id="email"', duplicate.data)
        self.assertIn(b'value=""', duplicate.data)
        self.assertNotIn(b"Internal server error", duplicate.data)

    def test_existing_email_can_log_in_and_password_is_never_returned(self):
        self.register()

        with app.app_context():
            user = User.query.filter_by(email=self.email).first()
            self.assertIsNotNone(user)
            self.assertNotEqual(user.password, "test-password")
            self.assertTrue(user.check_password("test-password"))

        invalid = self.client.post(
            "/login",
            data={"email": self.email, "password": "wrong-password"},
            follow_redirects=True,
        )
        self.assertIn(b'value=""', invalid.data)
        self.assertNotIn(b'value="wrong-password"', invalid.data)

        valid = self.client.post(
            "/login",
            data={"email": self.email.upper(), "password": "test-password"},
            follow_redirects=True,
        )
        self.assertEqual(valid.status_code, 200)
        self.assertIn(b"Welcome back, Registration Test", valid.data)
        self.assertNotIn(b"test-password", valid.data)

    def test_password_visibility_controls_are_attached_to_each_form(self):
        login_page = self.client.get("/login").data
        register_page = self.client.get("/register").data

        self.assertIn(b'onclick="togglePassword(this)"', login_page)
        self.assertIn(b'onclick="togglePassword(this)"', register_page)
        self.assertIn(b'autocomplete="off"', login_page)
        self.assertIn(b'autocomplete="new-password"', register_page)
        self.assertIn(b"clearLoginFields", login_page)

    def test_insert_conflict_rolls_back_without_server_error(self):
        conflict = IntegrityError("insert", {}, Exception("unique constraint"))
        with patch("app.db.session.commit", side_effect=conflict):
            response = self.register()

        self.assertEqual(response.status_code, 200)
        self.assertIn(b"already registered", response.data.lower())
        self.assertNotIn(b"Internal server error", response.data)


if __name__ == "__main__":
    unittest.main()