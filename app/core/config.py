import os
from datetime import timedelta
from dotenv import load_dotenv

basedir = os.path.abspath(os.path.dirname(__file__))
load_dotenv(os.path.join(basedir, '..', '..', '.env'))

class Config:
    """Base configuration."""
    SECRET_KEY = os.environ.get('SECRET_KEY')
    JWT_SECRET_KEY = os.environ.get('JWT_SECRET_KEY')
    JWT_ACCESS_TOKEN_EXPIRES = timedelta(hours=1)
    # Database configuration (to be used in later milestones)
    SQLALCHEMY_DATABASE_URI = os.environ.get('DATABASE_URL') or \
        'sqlite:///' + os.path.join(basedir, '..', '..', 'app.db')
    SQLALCHEMY_TRACK_MODIFICATIONS = False
    # Supabase configuration (to be used in later milestones)
    SUPABASE_URL = os.environ.get('SUPABASE_URL')
    SUPABASE_KEY = os.environ.get('SUPABASE_KEY')
    # Logging configuration
    LOG_LEVEL = os.environ.get('LOG_LEVEL') or 'INFO'
    LOG_FILE = os.environ.get('LOG_FILE')  # Optional, e.g., 'logs/app.log'

    def validate(self):
        """Validate configuration to ensure required settings are present.
        In development/testing, Supabase keys are optional — the app degrades gracefully
        (app.supabase = None) when they are absent.  Only SECRET_KEY and JWT_SECRET_KEY
        are truly required because they protect sessions.
        """
        errors = []
        if not self.SECRET_KEY:
            errors.append("SECRET_KEY environment variable is not set")
        if not self.JWT_SECRET_KEY:
            errors.append("JWT_SECRET_KEY environment variable is not set")
        # Supabase is required in production but optional in development / testing.
        # Missing Supabase keys are handled gracefully in create_app() (app.supabase = None).
        if errors:
            raise RuntimeError(f"Configuration errors: {', '.join(errors)}")
    
    @staticmethod
    def init_app(app):
        pass

class DevelopmentConfig(Config):
    """Development configuration."""
    DEBUG = True
    TESTING = False
    # Provide default values for development
    SECRET_KEY = os.environ.get('SECRET_KEY') or 'dev-secret-key-change-in-production'
    JWT_SECRET_KEY = os.environ.get('JWT_SECRET_KEY') or 'dev-jwt-secret-change-in-production'

class TestingConfig(Config):
    """Testing configuration."""
    TESTING = True
    DEBUG = False
    SQLALCHEMY_DATABASE_URI = 'sqlite:///:memory:'
    # Provide default values for testing
    SECRET_KEY = os.environ.get('SECRET_KEY') or 'test-secret-key'
    JWT_SECRET_KEY = os.environ.get('JWT_SECRET_KEY') or 'test-jwt-secret'

class ProductionConfig(Config):
    """Production configuration."""
    DEBUG = False
    TESTING = False
    # Use production database
    SQLALCHEMY_DATABASE_URI = os.environ.get('DATABASE_URL') or \
        'sqlite:///' + os.path.join(basedir, '..', '..', 'prod_app.db')

config = {
    'development': DevelopmentConfig,
    'testing': TestingConfig,
    'production': ProductionConfig,
    'default': DevelopmentConfig
}