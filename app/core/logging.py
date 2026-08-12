import logging
import logging.handlers
import os
from flask import Flask, has_request_context, request

class RequestFormatter(logging.Formatter):
    """Custom formatter to include request information."""
    def format(self, record):
        if has_request_context():
            record.url = request.url
            record.remote_addr = request.remote_addr
        else:
            record.url = None
            record.remote_addr = None
        return super().format(record)

def init_logging(app: Flask):
    """Initialize logging for the Flask application."""
    # Clear any existing handlers
    for handler in app.logger.handlers[:]:
        app.logger.removeHandler(handler)
    
    # Set log level
    log_level = getattr(logging, app.config['LOG_LEVEL'].upper())
    app.logger.setLevel(log_level)
    
    # Create formatter
    formatter = RequestFormatter(
        '[%(asctime)s] %(levelname)s in %(module)s: %(message)s'
    )
    
    # Console handler
    console_handler = logging.StreamHandler()
    console_handler.setFormatter(formatter)
    app.logger.addHandler(console_handler)
    
    # File handler (if log file is specified)
    log_file = app.config.get('LOG_FILE')
    if log_file:
        # Ensure logs directory exists
        log_dir = os.path.dirname(log_file)
        if log_dir and not os.path.exists(log_dir):
            os.makedirs(log_dir)
        
        file_handler = logging.handlers.RotatingFileHandler(
            log_file,
            maxBytes=10240000,  # 10MB
            backupCount=10
        )
        file_handler.setFormatter(formatter)
        app.logger.addHandler(file_handler)
    
    # Prevent propagation to root logger
    app.logger.propagate = False
    
    app.logger.info('Logging initialized')