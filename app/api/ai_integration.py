"""
AI Integration API Endpoints
Provides REST API for AI-assisted field mapping
"""
from flask import Blueprint, request, jsonify
import json
import logging
from typing import Dict, Optional

from app.services.ai_field_mapping_service import AIFieldMappingService
from app.services.nvidia_nim_client import get_nim_client
from app.core.exceptions import AIServiceError, ValidationError

logger = logging.getLogger(__name__)

ai_bp = Blueprint('ai_integration', __name__, url_prefix='/api/v1/ai')

# NOTE: ai_answers_bp (ai_answers.py) also uses /api/v1/ai.
# Both blueprints are registered in app/__init__.py — ai_answers_bp first
# (owns /answer-question and /answer-questions-batch), then ai_bp for the
# remaining routes (/health, /field-mapping, /semantic-analysis, etc.).
# Flask allows multiple blueprints on the same prefix as long as their
# endpoint names are unique, which they are (different blueprint names).

# Initialize service
ai_service = AIFieldMappingService()


@ai_bp.route('/health', methods=['GET'])
def health_check():
    """Health check for AI service"""
    try:
        client = get_nim_client()
        usage = client.get_usage_stats()
        return jsonify({
            'status': 'healthy',
            'service': 'ai_integration',
            'model': usage.get('model'),
            'cache_size': usage.get('cache_size'),
            'total_tokens': usage.get('total_tokens_used'),
            'total_cost_usd': usage.get('total_cost_usd'),
            'nim_configured': True
        }), 200
    except ValueError as e:
        # Handle missing API key gracefully
        return jsonify({
            'status': 'degraded',
            'service': 'ai_integration',
            'message': 'NVIDIA NIM API key not configured',
            'error': str(e),
            'nim_configured': False
        }), 200
    except Exception as e:
        logger.error(f"AI health check failed: {e}")
        return jsonify({
            'status': 'unhealthy',
            'service': 'ai_integration',
            'error': str(e),
            'nim_configured': False
        }), 503


@ai_bp.route('/field-mapping', methods=['POST'])
def ai_field_mapping():
    """
    AI-assisted field mapping endpoint
    
    Request:
    {
        "form_analysis": {...},
        "profile": {...},
        "options": {
            "use_ai": true,
            "confidence_threshold": 0.7,
            "fallback_to_rule_based": true
        }
    }
    
    Response:
    {
        "success": true,
        "mappings": [...],
        "confidence_scores": {...},
        "used_ai": true,
        "tokens_used": 123,
        "latency_ms": 456
    }
    """
    try:
        data = request.get_json()
        if not data:
            raise ValidationError("Request body is required")
        
        # Support both new format (form_analysis/profile) and legacy format (form_fields)
        if 'form_analysis' in data and 'profile' in data:
            # New format
            form_analysis = data.get('form_analysis')
            profile = data.get('profile')
            options = data.get('options', {})
        else:
            # Legacy format - convert to new format
            form_fields = data.get('form_fields', [])
            profile = data.get('profile', {})
            options = data.get('options', {})
            
            # Convert form_fields to form_analysis format
            form_analysis = {
                'forms': [{
                    'elements': [
                        {
                            'element_id': field.get('element_id', field.get('id', '')),
                            'element_name': field.get('name', ''),
                            'label': field.get('label', ''),
                            'type': field.get('type', 'text'),
                            'placeholder': field.get('placeholder', ''),
                            'required': field.get('required', False),
                            'options': field.get('options', []),
                            'attributes': field.get('attributes', {})
                        }
                        for field in form_fields
                    ]
                }]
            }
        
        if not form_analysis:
            raise ValidationError("form_analysis or form_fields is required")
        if not profile:
            raise ValidationError("profile is required")
        
        # Execute AI field mapping
        result = ai_service.map_fields_with_ai(
            form_analysis=form_analysis,
            profile=profile,
            use_ai=options.get('use_ai', True),
            confidence_threshold=options.get('confidence_threshold', 0.7),
            fallback_to_rule_based=options.get('fallback_to_rule_based', True)
        )
        
        return jsonify(result), 200
        
    except ValidationError as e:
        logger.warning(f"Validation error in ai_field_mapping: {e}")
        return jsonify({'success': False, 'error': str(e), 'code': 'VALIDATION_ERROR'}), 400
    except AIServiceError as e:
        logger.error(f"AI service error in ai_field_mapping: {e}")
        return jsonify({'success': False, 'error': str(e), 'code': 'AI_SERVICE_ERROR'}), 500
    except Exception as e:
        logger.error(f"Unexpected error in ai_field_mapping: {e}")
        return jsonify({'success': False, 'error': 'Internal server error', 'code': 'INTERNAL_ERROR'}), 500


@ai_bp.route('/semantic-analysis', methods=['POST'])
def semantic_analysis():
    """
    Semantic analysis of form fields
    
    Request:
    {
        "fields": [
            {"name": "field1", "label": "Email", "type": "email", ...},
            ...
        ],
        "context": "job_application"
    }
    
    Response:
    {
        "success": true,
        "analysis": [...],
        "tokens_used": 123
    }
    """
    try:
        data = request.get_json()
        if not data:
            raise ValidationError("Request body is required")
        
        fields = data.get('fields', [])
        context = data.get('context', 'job_application')
        
        if not fields:
            raise ValidationError("fields array is required")
        
        # For now, use the existing form analysis service
        # This can be extended with dedicated AI semantic analysis
        result = ai_service.analyze_fields_semantically(fields, context)
        
        return jsonify(result), 200
        
    except ValidationError as e:
        return jsonify({'success': False, 'error': str(e), 'code': 'VALIDATION_ERROR'}), 400
    except Exception as e:
        logger.error(f"Error in semantic_analysis: {e}")
        return jsonify({'success': False, 'error': 'Internal server error', 'code': 'INTERNAL_ERROR'}), 500


@ai_bp.route('/cache/clear', methods=['POST'])
def clear_cache():
    """Clear AI response cache"""
    try:
        client = get_nim_client()
        client.clear_cache()
        return jsonify({'success': True, 'message': 'Cache cleared'}), 200
    except ValueError as e:
        # Handle missing API key gracefully
        return jsonify({'success': True, 'message': 'Cache cleared (no AI configured)', 'nim_configured': False}), 200
    except Exception as e:
        logger.error(f"Error clearing cache: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500


@ai_bp.route('/usage', methods=['GET'])
def get_usage():
    """Get AI usage statistics"""
    try:
        client = get_nim_client()
        usage = client.get_usage_stats()
        return jsonify({
            'success': True,
            'usage': usage,
            'nim_configured': True
        }), 200
    except ValueError as e:
        # Handle missing API key gracefully
        return jsonify({
            'success': True,
            'usage': {
                'total_tokens_used': 0,
                'total_cost_usd': 0.0,
                'cache_size': 0,
                'model': 'mistralai/mistral-small-4-119b-2603'
            },
            'nim_configured': False,
            'message': 'NVIDIA NIM API key not configured'
        }), 200
    except Exception as e:
        logger.error(f"Error getting usage: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500


# Register blueprint function
def register_ai_routes(app):
    """Register AI routes with Flask app"""
    app.register_blueprint(ai_bp)