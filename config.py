import os


class Config:

    BASE_DIR = os.path.abspath(
        os.path.dirname(__file__)
    )

    SECRET_KEY = os.environ.get(
        "SECRET_KEY",
        "dev-key-change-me"
    )

    SQLALCHEMY_DATABASE_URI = (
        "sqlite:///"
        + os.path.join(
            BASE_DIR,
            "database",
            "nexus.db"
        )
    )

    SQLALCHEMY_TRACK_MODIFICATIONS = False

    UPLOAD_FOLDER = os.path.join(
        BASE_DIR,
        "static",
        "images"
    )

    AUDIO_FOLDER = os.path.join(
        BASE_DIR,
        "static",
        "audio"
    )

    MAX_CONTENT_LENGTH = 16 * 1024 * 1024

    SESSION_PERMANENT = False

    GROQ_API_KEY = os.environ.get(
        "GROQ_API_KEY",
        ""
    )

    GROQ_MODEL = "openai/gpt-oss-120b"

    GOOGLE_API_KEY = ""

    TWILIO_ACCOUNT_SID = ""

    TWILIO_AUTH_TOKEN = ""

    TWILIO_PHONE = ""