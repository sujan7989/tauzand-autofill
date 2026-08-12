# Field Mapping API - API Module

from flask import Blueprint, request, jsonify, current_app
from ..services.field_mapping_service import map_form_to_profile, FieldMappingService
from ..services.ai_field_mapping_service import AIFieldMappingService
from ..utils.form_analysis.constants import ENGINE_VERSION, ENGINE_NAME
from datetime import datetime
import logging

logger = logging.getLogger(__name__)

# Create the blueprint
field_mapping_bp = Blueprint('field_mapping', __name__, url_prefix='/api/v1')

@field_mapping_bp.route('/field-mapping', methods=['POST'])
def map_fields():
    """
    Map form fields to candidate profile fields.
    
    Expected JSON payload:
    {
        "form_analysis": {
            // Output from form analysis service
        },
        "profile": {
            // Candidate profile data
        },
        "options": {
            "use_ai": true,
            "confidence_threshold": 0.7,
            "fallback_to_rule_based": true
        }
    }
    
    Returns:
    {
        "success": true,
        "mapping_result": {
            "mappings": [...],
            "unmapped_form_fields": [...],
            "unmapped_profile_fields": [...],
            "mapping_statistics": {...},
            "used_ai": true,
            "tokens_used": 123,
            "latency_ms": 456
        }
    }
    """
    try:
        # Validate request
        if not request.is_json:
            return jsonify({
                "success": False,
                "error": "Content-Type must be application/json"
            }), 400
        
        data = request.get_json()
        
        if not data:
            return jsonify({
                "success": False,
                "error": "Request body is empty"
            }), 400
        
        # Extract form analysis and profile data
        form_analysis_data = data.get('form_analysis')
        profile_data = data.get('profile')
        options = data.get('options', {})
        
        # Debug logging
        logger.debug(f"Received form_analysis_data: {type(form_analysis_data)}")
        logger.debug(f"Received profile_data: {type(profile_data)}")
        logger.debug(f"Received options: {options}")
        
        if form_analysis_data is None:
            return jsonify({
                "success": False,
                "error": "Missing required field: 'form_analysis'"
            }), 400
        
        if profile_data is None:
            return jsonify({
                "success": False,
                "error": "Missing required field: 'profile'"
            }), 400
        
        # Validate form analysis data structure
        if not isinstance(form_analysis_data, dict):
            return jsonify({
                "success": False,
                "error": "Field 'form_analysis' must be a dictionary"
            }), 400
        
        if not isinstance(profile_data, dict):
            return jsonify({
                "success": False,
                "error": "Field 'profile' must be a dictionary"
            }), 400
        
        # Extract options
        use_ai = options.get('use_ai', True)
        confidence_threshold = options.get('confidence_threshold', 0.7)
        fallback_to_rule_based = options.get('fallback_to_rule_based', True)
        
        # Perform field mapping with AI
        ai_service = AIFieldMappingService()
        mapping_result = ai_service.map_fields_with_ai(
            form_analysis=form_analysis_data,
            profile=profile_data,
            use_ai=use_ai,
            confidence_threshold=confidence_threshold,
            fallback_to_rule_based=fallback_to_rule_based
        )
        
        return jsonify({
            "success": True,
            "mapping_result": mapping_result
        }), 200
        
    except Exception as e:
        logger.exception(f"Error in field mapping: {e}")
        return jsonify({
            "success": False,
            "error": "Internal server error during field mapping"
        }), 500

@field_mapping_bp.route('/field-mapping/health', methods=['GET'])
def field_mapping_health():
    """Health check endpoint for the field mapping service."""
    try:
        # Test that the service can be instantiated
        from ..services.field_mapping_service import FieldMappingService
        from ..services.ai_field_mapping_service import AIFieldMappingService
        service = FieldMappingService()
        ai_service = AIFieldMappingService()
        
        # Check AI health
        ai_health = ai_service.health_check()
        
        return jsonify({
            "status": "healthy",
            "service": "field_mapping",
            "version": ENGINE_VERSION,
            "timestamp": datetime.utcnow().isoformat() + "Z",
            "capabilities": [
                "exact_matching",
                "alias_matching", 
                "label_matching",
                "autocomplete_matching",
                "placeholder_matching",
                "aria_matching",
                "fuzzy_matching",
                "confidence_scoring",
                "ai_assisted_mapping",
                "semantic_analysis"
            ],
            "ai_health": ai_health
        }), 200
        
    except Exception as e:
        logger.exception(f"Field mapping health check failed: {e}")
        return jsonify({
            "status": "unhealthy",
            "service": "field_mapping",
            "error": str(e)
        }), 503

# Export the blueprint
__all__ = ['field_mapping_bp']