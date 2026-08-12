from flask import Blueprint, jsonify, current_app
import datetime
import platform
import sys

health_bp = Blueprint('health', __name__)

@health_bp.route('/health', methods=['GET'])
def health_check():
    """Health check endpoint."""
    return jsonify({
        'status': 'healthy',
        'timestamp': datetime.datetime.utcnow().isoformat() + 'Z',
        'service': 'Tauzand Intelligence Internship Project Backend',
        'version': '1.0.0',
        'environment': current_app.config.get('FLASK_ENV', 'development'),
        'python_version': sys.version,
        'platform': platform.platform()
    }), 200

@health_bp.route('/ping', methods=['GET'])
def ping():
    """Simple ping endpoint."""
    return jsonify({'message': 'pong'}), 200

@health_bp.route('/version', methods=['GET'])
def version():
    """Version endpoint."""
    return jsonify({
        'project_name': 'Tauzand Intelligence Internship Project',
        'version': '1.0.0',
        'environment': current_app.config.get('FLASK_ENV', 'development'),
        'build_timestamp': datetime.datetime.utcnow().isoformat() + 'Z'
    }), 200