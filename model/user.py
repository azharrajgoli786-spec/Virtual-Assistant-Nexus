from flask_login import UserMixin
from werkzeug.security import check_password_hash, generate_password_hash
from extensions import db


class User(UserMixin, db.Model):

    __tablename__ = "users"

    id = db.Column(
        db.Integer,
        primary_key=True
    )

    name = db.Column(
        db.String(100),
        nullable=False
    )

    email = db.Column(
        db.String(120),
        unique=True,
        nullable=False
    )

    password = db.Column(
        db.String(255),
        nullable=False
    )


    def set_password(self, password):

        self.password = generate_password_hash(
            password
        )


    def check_password(self, password):

        return check_password_hash(
            self.password,
            password
        )


    def get_reset_token(self, expires_sec=3600):
        from flask import current_app
        from itsdangerous import URLSafeTimedSerializer

        serializer = URLSafeTimedSerializer(
            current_app.config["SECRET_KEY"],
            salt="password-reset",
        )

        return serializer.dumps({"user_id": self.id})


    @staticmethod
    def verify_reset_token(token, expires_sec=3600):
        from flask import current_app
        from itsdangerous import BadSignature, SignatureExpired, URLSafeTimedSerializer

        serializer = URLSafeTimedSerializer(
            current_app.config["SECRET_KEY"],
            salt="password-reset",
        )

        try:
            data = serializer.loads(
                token,
                max_age=expires_sec,
            )
        except (BadSignature, SignatureExpired):
            return None

        return db.session.get(User, data.get("user_id"))


    def __repr__(self):

        return f"<User {self.email}>"