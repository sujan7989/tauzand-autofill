from flask import jsonify
from werkzeug.exceptions import HTTPException

class APIException(Exception):
    """Base class for API exceptions."""
    status_code = 500
    message = 'An unexpected error occurred.'
    
    def __init__(self, message=None, status_code=None, payload=None):
        super().__init__()
        if message is not None:
            self.message = message
        if status_code is not None:
            self.status_code = status_code
        self.payload = payload
    
    def to_dict(self):
        """Convert exception to dictionary."""
        rv = dict(self.payload or ())
        rv['message'] = self.message
        rv['status_code'] = self.status_code
        return rv


class AIServiceError(APIException):
    """Exception raised when AI service encounters an error."""
    status_code = 500
    message = 'AI service error occurred.'


class ValidationError(APIException):
    """Exception raised for validation errors."""
    status_code = 400
    message = 'Validation error.'

def register_error_handlers(app):
    """Register error handlers for the Flask application."""
    
    @app.errorhandler(APIException)
    def handle_api_exception(error):
        """Handle custom API exceptions."""
        response = jsonify(error.to_dict())
        response.status_code = error.status_code
        return response
    
    @app.errorhandler(HTTPException)
    def handle_http_exception(error):
        """Handle HTTP exceptions."""
        response = jsonify({
            'message': error.description,
            'status_code': error.code
        })
        response.status_code = error.code
        return response
    
    @app.errorhandler(Exception)
    def handle_unexpected_error(error):
        """Handle unexpected errors."""
        app.logger.exception(f'Unhandled exception: {error}')
        response = jsonify({
            'message': 'An internal server error occurred.',
            'status_code': 500
        })
        response.status_code = 500
        return response