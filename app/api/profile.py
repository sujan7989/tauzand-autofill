from flask import Blueprint, jsonify, request, current_app
from werkzeug.utils import secure_filename
import os

profile_bp = Blueprint('profile', __name__)

# Allowed file extensions
ALLOWED_EXTENSIONS = {'pdf', 'docx', 'doc'}

def allowed_file(filename):
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS

@profile_bp.route('/upload', methods=['POST'])
def upload_resume():
    """Upload and parse a resume file."""
    if 'resume' not in request.files:
        return jsonify({"error": "No file part"}), 400

    file = request.files['resume']

    if file.filename == '':
        return jsonify({"error": "No selected file"}), 400

    if file and allowed_file(file.filename):
        try:
            filename = secure_filename(file.filename)

            # Read file bytes for parsing
            file_bytes = file.read()

            # Use real resume parser
            from app.services.resume_parser import ResumeParser
            parser = ResumeParser()
            parsed_data = parser.parse(file_bytes, filename, file.content_type or '')

            current_app.logger.info(
                "Resume parsed: file=%s fields=%s",
                filename,
                [k for k in parsed_data.keys() if k != 'raw_text']
            )

            # Ensure first_name / last_name are always present at top level
            # (some parse paths only return 'name')
            if not parsed_data.get('first_name') and parsed_data.get('name'):
                parts = parsed_data['name'].split()
                parsed_data['first_name'] = parts[0] if parts else ''
                parsed_data['last_name']  = ' '.join(parts[1:]) if len(parts) > 1 else ''

            # Ensure email is always at top level (may be nested in contact)
            if not parsed_data.get('email'):
                contact = parsed_data.get('contact', {})
                if contact.get('email'):
                    parsed_data['email'] = contact['email']

            return jsonify({
                "success": True,
                "data": parsed_data
            }), 200

        except Exception as e:
            current_app.logger.exception(f"Error uploading resume: {e}")
            return jsonify({"error": "Failed to process resume"}), 500

    return jsonify({"error": "Invalid file type. Allowed: pdf, docx, doc"}), 400

@profile_bp.route('/', methods=['GET'])
def get_profile():
    """Get the candidate profile."""
    try:
        from app.services.profile_service import ProfileService
        service = ProfileService()
        profile = service.get_profile()
        if profile:
            return jsonify(profile), 200
        else:
            return jsonify({"message": "Profile not found"}), 404
    except Exception as e:
        current_app.logger.exception(f"Error retrieving profile: {e}")
        return jsonify({"error": "Internal server error"}), 500

@profile_bp.route('/', methods=['POST'])
def create_profile():
    """Create a new candidate profile."""
    if not request.is_json:
        return jsonify({"error": "Request must be JSON"}), 400
    
    data = request.get_json()
    
    try:
        from app.services.profile_service import ProfileService
        service = ProfileService()
        profile = service.create_profile(data)
        if profile:
            return jsonify(profile), 201
        else:
            return jsonify({"error": "Failed to create profile"}), 500
    except ValueError as e:
        return jsonify({"error": str(e)}), 400
    except Exception as e:
        current_app.logger.exception(f"Error creating profile: {e}")
        return jsonify({"error": "Internal server error"}), 500

@profile_bp.route('/', methods=['PUT'])
def update_profile():
    """Update the candidate profile (update the first one found)."""
    if not request.is_json:
        return jsonify({"error": "Request must be JSON"}), 400
    
    data = request.get_json()
    
    try:
        from app.services.profile_service import ProfileService
        service = ProfileService()
        # We'll update the first profile we find (assuming there is only one)
        profile = service.update_profile(None, data)  # We'll adjust the service to handle None as the first profile
        if profile:
            return jsonify(profile), 200
        else:
            return jsonify({"error": "Profile not found or not updated"}), 404
    except Exception as e:
        current_app.logger.exception(f"Error updating profile: {e}")
        return jsonify({"error": "Internal server error"}), 500