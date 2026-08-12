import os
from flask import Flask
from flask_cors import CORS
from app.core.config import config
from app.core.logging import init_logging
from app.core.exceptions import register_error_handlers
from app.api.health import health_bp
from app.api.profile import profile_bp
from app.api.form_analysis import form_analysis_bp
from app.api.field_mapping import field_mapping_bp
from app.api.ai_integration import register_ai_routes
from app.api.ai_answers import ai_answers_bp
from flasgger import Swagger
from app.core.supabase import get_supabase_client

def create_app(config_name=None):
    """Application factory function."""
    if config_name is None:
        config_name = os.environ.get('FLASK_ENV', 'default')
    
    app = Flask(__name__)
    app.config.from_object(config[config_name])
    
    # Validate configuration
    config_instance = config[config_name]()
    config_instance.validate()
    
    # Initialize extensions
    config[config_name].init_app(app)
    
    # Initialize logging
    init_logging(app)
    
    # Enable CORS for all routes
    CORS(app, resources={r"/*": {"origins": "*"}})
    
    # Register error handlers
    register_error_handlers(app)
    
    # Initialize Supabase client (skip in testing if not configured)
    if config_name != 'testing':
        try:
            supabase_client = get_supabase_client()
            app.supabase = supabase_client
            app.logger.info("Supabase client initialized successfully")
        except ValueError as e:
            # In development, we might not have Supabase set up yet, so we log a warning
            # but we don't fail the app creation. However, for production, we should fail.
            app.logger.warning(f"Supabase client not initialized: {e}")
            # We can set app.supabase to None and then check in the routes
            app.supabase = None
    else:
        app.supabase = None
    
    # Initialize Swagger
    swagger = Swagger(app)
    
    # Register blueprints
    app.register_blueprint(health_bp, url_prefix='/api')
    app.register_blueprint(profile_bp, url_prefix='/api/profile')
    app.register_blueprint(form_analysis_bp, url_prefix='/api/form')
    app.register_blueprint(field_mapping_bp, url_prefix='/api/v1')
    # ai_answers_bp owns /api/v1/ai — register it once here.
    # ai_bp (ai_integration) shares the same prefix; register its routes
    # via register_ai_routes which registers ai_bp directly.
    # To avoid URL collisions, ai_answers_bp is registered first so its
    # routes (/answer-question, /answer-questions-batch) take precedence,
    # and ai_bp provides the remaining routes (/health, /field-mapping, etc.).
    app.register_blueprint(ai_answers_bp)
    register_ai_routes(app)
    
    # Root endpoint
    @app.route('/')
    def index():
        return {
            'message': 'Tauzand Intelligence Internship Project Backend',
            'version': '1.0.0',
            'status': 'running'
        }
    
    return app