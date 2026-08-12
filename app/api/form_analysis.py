# Form Analysis Engine - API Module

from datetime import datetime
from flask import Blueprint, request, jsonify
from ..services.form_analysis_service import analyze_form, FormAnalysisService
from ..utils.form_analysis.constants import ENGINE_NAME, ENGINE_VERSION
import logging

logger = logging.getLogger(__name__)

# Create the blueprint
# NOTE: url_prefix is set only in app/__init__.py (url_prefix='/api/form').
# Do NOT set it here — setting it in both places doubles the path to /api/form/api/form/...
form_analysis_bp = Blueprint('form_analysis', __name__)

@form_analysis_bp.route('/analyze', methods=['POST'])
def analyze_form_endpoint():
    """
    Analyze an HTML form and return structured metadata.
    
    Expected JSON payload:
    {
        "html": "<form>...</form>",
        "source_url": "https://example.com/page",  // optional
        "metadata": {...},  // optional additional metadata
        "resume": {...}  // optional resume/profile data for field mapping
    }
    
    Returns:
    {
        "success": true,
        "form_analysis": {
            // Complete form analysis results
        }
    }
    """
    try:
        # Validate request content type FIRST before parsing
        if not request.is_json:
            return jsonify({
                "success": False,
                "error": "Content-Type must be application/json"
            }), 400

        data = request.get_json(silent=True)
        
        # Validate required fields
        if not data or 'html' not in data:
            return jsonify({
                "success": False,
                "error": "Missing required field: 'html'"
            }), 400
            
        html_content = data['html']
        source_url = data.get('source_url')
        additional_metadata = data.get('metadata', {})
        resume_data = data.get('resume')  # Optional resume data for field mapping
        
        # Validate HTML content
        if not isinstance(html_content, str):
            return jsonify({
                "success": False,
                "error": "Field 'html' must be a string"
            }), 400
            
        if not html_content.strip():
            return jsonify({
                "success": False,
                "error": "Field 'html' cannot be empty"
            }), 400
            
        # Size limit check (5MB)
        if len(html_content) > 5 * 1024 * 1024:
            return jsonify({
                "success": False,
                "error": "HTML content too large (maximum 5MB)"
            }), 413
            
        # Perform analysis
        try:
            result = analyze_form(
                html_content=html_content,
                source_url=source_url,
                metadata=additional_metadata,
                resume_data=resume_data
            )
            
            # Extract mappings and confidence
            mappings   = result.get('mappings', [])   if isinstance(result, dict) else []
            confidence = result.get('confidence', 0.85) if isinstance(result, dict) else 0.85

            logger.info(
                "Form analysis completed — forms: %d, mappings: %d, confidence: %.2f",
                len(result.get('forms', []) if isinstance(result, dict) else []),
                len(mappings),
                confidence
            )
            
            return jsonify({
                "success":      True,
                "form_analysis": result,
                "mappings":     mappings,
                "confidence":   confidence
            }), 200
            
        except ValueError as ve:
            # Validation errors
            return jsonify({
                "success": False,
                "error": str(ve)
            }), 400
            
        except Exception as e:
            logger.exception(f"Error in form analysis: {e}")
            return jsonify({
                "success": False,
                "error": "Internal server error during form analysis"
            }), 500
            
    except Exception as e:
        logger.exception(f"Unexpected error in form analysis endpoint: {e}")
        return jsonify({
            "success": False,
            "error": "Internal server error"
        }), 500


@form_analysis_bp.route('/analyze/fields', methods=['POST'])
def analyze_fields_endpoint():
    """
    Analyze form fields and return field mappings for autofill.

    Schema (UNIFIED with autoFill.js expectations — form_field_name,
    profile_field_name, mapped_value, confidence_score, match_type):
    {
        "resume": {...},  // Resume data
        "forms": [...]   // Form data from content script
    }

    Returns:
    {
        "success": true,
        "mappings": [
          {
            "form_field_name": "first_name",
            "profile_field_name": "firstName",
            "mapped_value": "John",
            "confidence_score": 0.92,
            "match_type": "exact"
          }, ...
        ],
        "confidence": 0.85,
        "missing": 2
    }
    """
    try:
        if not request.is_json:
            return jsonify({
                "success": False,
                "error": "Content-Type must be application/json"
            }), 400

        data = request.get_json()

        if not data:
            return jsonify({
                "success": False,
                "error": "Missing request body"
            }), 400

        resume = data.get('resume') or {}
        forms = data.get('forms') or []

        RULE_MAP = [     # ── Put multi-word / specific patterns FIRST so they match before shorter ones ──
            ('work_authorization',   'professional.work_authorization', 'exact', 'Yes'),
            ('work_auth',            'professional.work_authorization', 'exact', 'Yes'),
            ('workauthorization',    'professional.work_authorization', 'exact', 'Yes'),
            ('requires_sponsorship', 'visa_sponsorship',               'exact', 'No'),
            ('visa_sponsorship',     'visa_sponsorship',               'exact', 'No'),
            ('require_sponsorship',  'visa_sponsorship',               'exact', 'No'),
            ('willing_to_relocate',  'professional.willing_to_relocate', 'exact', 'Yes'),
            ('willing_relocate',     'professional.willing_to_relocate', 'exact', 'Yes'),

            # ── Personal info ─────────────────────────────────────────────────
            ('first_name',    'personal.first_name',  'fuzzy',  None),
            ('firstname',     'personal.first_name',  'fuzzy',  None),
            ('given_name',    'personal.first_name',  'fuzzy',  None),
            ('last_name',     'personal.last_name',   'fuzzy',  None),
            ('lastname',      'personal.last_name',   'fuzzy',  None),
            ('family_name',   'personal.last_name',   'fuzzy',  None),
            ('surname',       'personal.last_name',   'fuzzy',  None),
            ('middle_name',   'personal.middle_name', 'fuzzy',  None),
            ('name',          'personal.full_name',   'fuzzy',  None),
            ('fullname',      'personal.full_name',   'fuzzy',  None),
            ('full_name',     'personal.full_name',   'fuzzy',  None),
            ('dob',           'personal.dob',         'exact',  None),
            ('date_of_birth', 'personal.dob',         'fuzzy',  None),
            ('birth_date',    'personal.dob',         'fuzzy',  None),
            ('birthdate',     'personal.dob',         'fuzzy',  None),
            ('gender',        'personal.gender',      'exact',  None),
            ('sex',           'personal.gender',      'fuzzy',  None),
            ('nationality',   'personal.nationality', 'exact',  None),
            ('citizenship',   'personal.nationality', 'fuzzy',  None),

            # ── Contact ───────────────────────────────────────────────────────
            ('email',         'contact.email',        'exact',  None),
            ('email_address', 'contact.email',        'fuzzy',  None),
            ('phone',         'contact.phone',        'exact',  None),
            ('phone_number',  'contact.phone',        'fuzzy',  None),
            ('telephone',     'contact.phone',        'fuzzy',  None),
            ('mobile',        'contact.phone',        'fuzzy',  None),
            ('cell',          'contact.phone',        'fuzzy',  None),

            # ── Location ──────────────────────────────────────────────────────
            ('address',       'contact.address',      'fuzzy',  None),
            ('street',        'contact.address',      'fuzzy',  None),
            ('city',          'contact.city',         'fuzzy',  None),
            ('location',      'contact.city',         'fuzzy',  None),
            ('town',          'contact.city',         'fuzzy',  None),
            ('state',         'contact.state',        'fuzzy',  None),
            ('province',      'contact.state',        'fuzzy',  None),
            ('region',        'contact.state',        'fuzzy',  None),
            ('zip',           'contact.zip_code',     'fuzzy',  None),
            ('postal',        'contact.zip_code',     'fuzzy',  None),
            ('postcode',      'contact.zip_code',     'fuzzy',  None),
            ('country',       'contact.country',      'fuzzy',  None),
            ('nation',        'contact.country',      'fuzzy',  None),

            # ── Social / Links ────────────────────────────────────────────────
            ('linkedin',      'social.linkedin',      'fuzzy',  None),
            ('github',        'social.github',        'fuzzy',  None),
            ('portfolio',     'social.portfolio',     'fuzzy',  None),
            ('website',       'social.portfolio',     'fuzzy',  None),
            ('twitter',       'social.twitter',       'fuzzy',  None),

            # ── Professional ──────────────────────────────────────────────────
            ('current_title', 'professional.current_title',   'fuzzy', None),
            ('job_title',     'professional.current_title',   'fuzzy', None),
            ('position',      'professional.current_title',   'fuzzy', None),
            ('role',          'professional.current_title',   'fuzzy', None),
            ('current_company', 'professional.current_company', 'fuzzy', None),
            ('employer',      'professional.current_company', 'fuzzy', None),
            ('organization',  'professional.current_company', 'fuzzy', None),
            ('years_experience', 'professional.years_experience', 'exact', None),
            ('experience',    'professional.years_experience', 'fuzzy', None),
            ('years',         'professional.years_experience', 'fuzzy', None),
            ('notice_period', 'professional.notice_period',   'exact', None),
            ('notice',        'professional.notice_period',   'fuzzy', None),
            ('salary',        'professional.salary_expectation', 'fuzzy', None),
            ('compensation',  'professional.salary_expectation', 'fuzzy', None),
            ('expected_ctc',  'professional.salary_expectation', 'fuzzy', None),
            ('ctc',           'professional.salary_expectation', 'fuzzy', None),
            ('package',       'professional.salary_expectation', 'fuzzy', None),

            # ── Yes/No questions — these come AFTER specific ones above ────────
            # work_authorization entries already at top
            ('authorized',       'professional.work_authorization', 'fuzzy', 'Yes'),
            ('legally_authorized', 'professional.work_authorization', 'fuzzy', 'Yes'),
            ('eligible_to_work', 'professional.work_authorization', 'fuzzy', 'Yes'),
            ('work_permit',      'professional.work_authorization', 'fuzzy', 'Yes'),
            ('visa_status',      'professional.work_authorization', 'fuzzy', None),
            ('visa_type',        'professional.work_authorization', 'fuzzy', None),
            ('sponsorship',      'visa_sponsorship',               'fuzzy', 'No'),
            ('relocation',       'professional.willing_to_relocate', 'fuzzy', 'Yes'),
            ('remote',           'remote_preference',               'fuzzy', 'Yes'),
            ('remote_work',      'remote_preference',               'fuzzy', 'Yes'),
            ('disability',       'disability_status',               'fuzzy', 'No'),
            ('veteran',          'veteran_status',                  'fuzzy', 'No'),
            ('ethnicity',        'ethnicity',                       'fuzzy', None),
            ('race',             'ethnicity',                       'fuzzy', None),

            # ── Education ─────────────────────────────────────────────────────
            ('degree',           'education.degree',              'fuzzy', None),
            ('qualification',    'education.degree',              'fuzzy', None),
            ('major',            'education.major',               'fuzzy', None),
            ('field_of_study',   'education.major',               'fuzzy', None),
            ('university',       'education.institution',         'fuzzy', None),
            ('college',          'education.institution',         'fuzzy', None),
            ('school',           'education.institution',         'fuzzy', None),
            ('institution',      'education.institution',         'fuzzy', None),
            ('graduation_year',  'education.graduation_year',     'fuzzy', None),
            ('gpa',              'education.gpa',                 'fuzzy', None),

            # ── Cover letter / open-ended ─────────────────────────────────────
            ('cover_letter',     'cover_letter',                  'fuzzy', None),
            ('cover letter',     'cover_letter',                  'exact', None),
            ('covering_letter',  'cover_letter',                  'fuzzy', None),
            ('message',          'cover_letter',                  'fuzzy', None),
            ('additional_info',  'additional_info',               'fuzzy', None),
            ('comments',         'additional_info',               'fuzzy', None),
            ('how_did_you_hear', 'how_did_you_hear',              'fuzzy', None),
            ('hear_about',       'how_did_you_hear',              'fuzzy', None),
            ('referral',         'how_did_you_hear',              'fuzzy', None),

            # ── Skills ────────────────────────────────────────────────────────
            ('skills',           'skills',                        'fuzzy', None),
            ('technical_skills', 'skills',                        'fuzzy', None),
            ('resume',           'resume.filename',               'exact', None),
        ]

        # ── Helper: resolve dot-path or flat key from resume object ─────────
        def _resolve_value(resume_obj, profile_key):
            if not isinstance(resume_obj, dict):
                return None
            # Dot-path traversal e.g. "personal.first_name"
            parts = profile_key.split('.')
            node = resume_obj
            for part in parts:
                if not isinstance(node, dict):
                    node = None; break
                node = node.get(part)
            if node and str(node).strip():
                return node
            # Flat scan by leaf key
            leaf = parts[-1]
            aliases = {
                'first_name':  ['first_name','firstName','given_name'],
                'last_name':   ['last_name','lastName','surname','family_name'],
                'full_name':   ['full_name','fullName','name'],
                'email':       ['email','email_address','emailAddress'],
                'phone':       ['phone','phone_number','phoneNumber','telephone','mobile'],
                'city':        ['city','location','locality'],
                'state':       ['state','province','region'],
                'address':     ['address','street','street_address'],
                'zip_code':    ['zip_code','zip','postal_code','postcode'],
                'country':     ['country','nation'],
                'linkedin':    ['linkedin','linkedin_url'],
                'github':      ['github','github_url'],
                'portfolio':   ['portfolio','website'],
                'dob':         ['dob','date_of_birth','birthdate'],
                'gender':      ['gender','sex'],
                'nationality': ['nationality','citizenship'],
                'work_authorization': ['work_authorization','work_auth'],
                'notice_period':      ['notice_period','notice'],
                'salary_expectation': ['salary_expectation','salary','ctc','compensation'],
                'willing_to_relocate': ['willing_to_relocate','relocation'],
                'current_title':  ['current_title','job_title'],
                'current_company': ['current_company','company','employer'],
                'years_experience': ['years_experience','experience'],
            }
            for alias in aliases.get(leaf, [leaf]):
                # Check top-level and nested 'professional', 'contact', 'personal', 'social'
                if alias in resume_obj and resume_obj[alias]:
                    return resume_obj[alias]
                for nested_key in ('professional', 'contact', 'personal', 'social'):
                    nested = resume_obj.get(nested_key, {})
                    if isinstance(nested, dict) and alias in nested and nested[alias]:
                        return nested[alias]
            # Case-insensitive flat scan
            target = leaf.lower().replace('_', '').replace(' ', '')
            for rk, rv in resume_obj.items():
                if isinstance(rv, (str, int, float)) and rk.lower().replace('_','').replace(' ','') == target:
                    return rv
            return None

        # ── Helper: resolve education fields from first education entry ───────
        def _resolve_education_value(resume_obj, edu_key):
            edu_list = resume_obj.get('education', [])
            if edu_list and isinstance(edu_list, list) and len(edu_list) > 0:
                e = edu_list[0]
                if isinstance(e, dict):
                    return e.get(edu_key, '')
            return None

        # ── Build field identifier tokens for matching ─────────────────────────
        def _get_field_tokens(element):
            """Return a lowercase combined string of all identifying attributes."""
            parts = [
                element.get('name', ''),
                element.get('id', '') or element.get('element_id', ''),
                element.get('label', ''),
                element.get('aria-label', '') or element.get('aria_label', ''),
                element.get('placeholder', ''),
                element.get('autocomplete', ''),
            ]
            return ' '.join(p.lower().replace('-', '_') for p in parts if p)

        mappings = []
        confidence_sum = 0.0
        matched_count = 0

        if forms:
            form = forms[0]
            elements = form.get('elements', []) or []
            for element in elements:
                if not element: continue
                tokens = _get_field_tokens(element)
                if not tokens:
                    continue

                field_name = element.get('name') or element.get('id') or element.get('element_id') or 'unknown'
                field_type = (element.get('type') or 'text').lower()

                # Find best matching rule — use word-boundary token matching
                # to avoid 'location' matching inside 'relocation'
                matched = None
                for pattern, profile_key, match_type, default_answer in RULE_MAP:
                    pattern_clean = pattern.lower().replace('-', '_').replace(' ', '_')
                    tokens_clean  = tokens.replace('-', '_').replace(' ', '_')
                    # Use word boundary: pattern must match as a whole token
                    import re as _re
                    # Split tokens into individual words and check exact word match
                    token_words = set(_re.split(r'[\s_\[\]\(\)\.]+', tokens_clean))
                    pattern_words = set(_re.split(r'[\s_\[\]\(\)\.]+', pattern_clean))
                    # All words in pattern must appear as exact tokens
                    if pattern_words and pattern_words.issubset(token_words):
                        # Resolve value
                        if profile_key.startswith('education.'):
                            edu_field = profile_key.split('.', 1)[1]
                            mapped_value = _resolve_education_value(resume, edu_field)
                        elif profile_key in ('cover_letter', 'additional_info', 'how_did_you_hear',
                                             'visa_sponsorship', 'remote_preference',
                                             'disability_status', 'veteran_status', 'ethnicity', 'skills'):
                            # Special: non-profile keys — use default or AI-generated
                            mapped_value = default_answer or ''
                        else:
                            mapped_value = _resolve_value(resume, profile_key)
                            # For yes/no fields with no direct value, use default
                            if not mapped_value and default_answer and field_type in ('radio', 'checkbox', 'select', 'select-one'):
                                mapped_value = default_answer

                        matched = {
                            'form_field_name':    field_name,
                            'profile_field_name': profile_key,
                            'mapped_value':       mapped_value,
                            'confidence_score':   0.95 if match_type == 'exact' else 0.88,
                            'match_type':         match_type,
                            'selector':           element.get('id') or element.get('name') or field_name,
                            'field_type':         field_type,
                            'is_yes_no':          element.get('is_yes_no', False),
                            'options':            element.get('options', []),
                        }
                        break

                if matched:
                    matched_count += 1
                    confidence_sum += matched['confidence_score']
                    if matched['mapped_value'] is None or matched['mapped_value'] == '':
                        continue  # No value to fill
                    matched['mapped_value'] = str(matched['mapped_value'])
                    mappings.append(matched)

        overall_confidence = (confidence_sum / matched_count) if matched_count else 0.0

        return jsonify({
            "success": True,
            "mappings": mappings,
            "confidence": round(overall_confidence, 3),
            "missing": 0
        }), 200

    except Exception as e:
        logger.exception(f"Error in field analysis: {e}")
        return jsonify({
            "success": False,
            "error": "Internal server error"
        }), 500


@form_analysis_bp.route('/analyze/url', methods=['POST'])
def analyze_form_from_url():
    """
    Analyze a form from a URL (placeholder for future implementation).
    
    This endpoint would fetch HTML from a URL and analyze it.
    For security and complexity reasons, this is marked as future work.
    """
    return jsonify({
        "success": False,
        "error": "URL-based form analysis is not yet implemented",
        "message": "Please use the /analyze endpoint with HTML content directly"
    }), 501


@form_analysis_bp.route('/health', methods=['GET'])
def form_analysis_health():
    """Health check endpoint for the form analysis service."""
    try:
        # Test that the service can be instantiated
        service = FormAnalysisService()
        
        # Check that dependencies are available by verifying the service was created
        # We don't perform a full analysis to keep this lightweight
        
        return jsonify({
            "status": "healthy",
            "service": "form_analysis",
            "version": ENGINE_VERSION,
            "timestamp": datetime.utcnow().isoformat() + 'Z',  # Dynamically generated timestamp
            "capabilities": [
                "html_parsing",
                "label_resolution", 
                "validation_extraction",
                "data_normalization",
                "uuid_generation",
                "accessibility_attribute_extraction",
                "relationship_detection",
                "comprehensive_metadata_extraction"
            ]
        }), 200
        
    except Exception as e:
        logger.exception(f"Form analysis health check failed: {e}")
        return jsonify({
            "status": "unhealthy",
            "service": "form_analysis",
            "error": str(e)
        }), 503


# Error handlers for the blueprint
@form_analysis_bp.errorhandler(404)
def not_found(error):
    return jsonify({
        "success": False,
        "error": "Endpoint not found"
    }), 404


@form_analysis_bp.errorhandler(405)
def method_not_allowed(error):
    return jsonify({
        "success": False,
        "error": "Method not allowed"
    }), 405


# Export the blueprint
__all__ = ['form_analysis_bp']