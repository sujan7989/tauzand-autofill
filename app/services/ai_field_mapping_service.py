"""
AI Field Mapping Service
Integrates NVIDIA NIM (Mistral) with rule-based fallback for intelligent field mapping
"""
import json
import logging
from typing import Dict, List, Any, Optional, Tuple
from dataclasses import dataclass, field
from datetime import datetime

# Default confidence threshold for AI mappings
DEFAULT_CONFIDENCE_THRESHOLD = 0.7


class TokenOptimizer:
    """
    Optimizes token usage by batching and truncating form fields
    """
    
    def __init__(self):
        self.max_tokens_per_batch = 3000  # Conservative estimate
        self.max_fields_per_batch = 30    # Limit to avoid context overflow
        self.system_prompt_tokens = 1000  # Estimate for system prompt
        self.user_prompt_overhead = 300   # Estimate for user prompt structure
        self.json_schema_tokens = 100     # Estimate for JSON schema
    
    def calculate_batch_size(self, total_fields: int, max_tokens_per_batch: int = None) -> int:
        """
        Calculate optimal batch size based on token limits
        
        Args:
            total_fields: Total number of form fields to process
            max_tokens_per_batch: Maximum tokens per batch (optional)
            
        Returns:
            Optimal batch size
        """
        max_tokens = max_tokens_per_batch or self.max_tokens_per_batch
        
        # Account for prompt overhead
        available_tokens = max_tokens - self.system_prompt_tokens - self.user_prompt_overhead - self.json_schema_tokens
        
        # Calculate max fields based on available tokens
        if available_tokens > 0:
            max_fields_by_tokens = int(available_tokens / 50)  # Estimate ~50 tokens per field
        else:
            max_fields_by_tokens = 0
        
        # Use the minimum of token-based and field-based limits
        return min(max_fields_by_tokens, self.max_fields_per_batch, total_fields)
    
    def calculate_total_batches(self, total_fields: int, batch_size: int = None) -> int:
        """
        Calculate total number of batches needed
        
        Args:
            total_fields: Total number of form fields
            batch_size: Batch size (optional)
            
        Returns:
            Total number of batches
        """
        if batch_size is None:
            batch_size = self.calculate_batch_size(total_fields)
        
        if batch_size <= 0:
            return 0
        
        return (total_fields + batch_size - 1) // batch_size  # Ceiling division


from app.services.nvidia_nim_client import get_nim_client, AIResponse
from app.services.field_mapping_service import FieldMappingService
from app.core.exceptions import AIServiceError, ValidationError

logger = logging.getLogger(__name__)


# JSON Schema for AI field mapping response
FIELD_MAPPING_SCHEMA = {
    "type": "object",
    "properties": {
        "mappings": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "form_field_id": {"type": "string"},
                    "form_field_name": {"type": "string"},
                    "form_field_label": {"type": "string"},
                    "form_field_type": {"type": "string"},
                    "profile_field": {"type": "string"},
                    "profile_value": {"type": "string"},
                    "confidence": {"type": "number", "minimum": 0, "maximum": 1},
                    "match_reason": {"type": "string"},
                    "method": {"type": "string", "enum": ["ai", "rule_based", "hybrid"]}
                },
                "required": ["form_field_id", "form_field_name", "profile_field", "confidence", "method"]
            }
        },
        "unmapped_form_fields": {
            "type": "array",
            "items": {"type": "string"}
        },
        "unmapped_profile_fields": {
            "type": "array",
            "items": {"type": "string"}
        },
        "summary": {
            "type": "object",
            "properties": {
                "total_form_fields": {"type": "integer"},
                "mapped_fields": {"type": "integer"},
                "mapping_percentage": {"type": "number"},
                "average_confidence": {"type": "number"},
                "ai_mappings": {"type": "integer"},
                "rule_based_mappings": {"type": "integer"}
            }
        }
    },
    "required": ["mappings", "unmapped_form_fields", "unmapped_profile_fields", "summary"]
}


# System prompt for AI field mapping
SYSTEM_PROMPT = """You are an expert at mapping job application form fields to candidate profile data.

Your task: Given a list of form fields (with their labels, types, placeholders, and attributes) and a candidate profile, map each form field to the most appropriate profile field.

Rules:
1. Analyze field labels, placeholders, types, and surrounding context
2. Match to profile fields semantically, not just by exact name
3. Consider field types (email, tel, url, date, select, etc.)
4. Return confidence score (0.0-1.0) for each mapping
5. Only map fields where you have reasonable confidence (>0.5)
6. Use "ai" as method for AI-based mappings
7. Return valid JSON matching the provided schema

Common profile fields:
- personal_info: full_name, first_name, last_name, email, phone, address, city, state, zip_code, country, linkedin, portfolio, website
- professional: current_title, current_company, years_experience, desired_salary, notice_period, willing_to_relocate, visa_status
- education: degree, major, university, graduation_year, gpa
- skills: technical_skills, soft_skills, certifications, languages
- work_auth: work_authorization, citizenship, visa_type
- preferences: remote_preference, travel_percentage, shift_preference

Field matching examples:
- "Email Address", "email", "e-mail", type=email -> profile.email
- "Phone Number", "phone", "mobile", "telephone", type=tel -> profile.phone
- "Full Name", "name", "first name" + "last name" -> profile.full_name or first/last
- "Current Title", "position", "role" -> profile.current_title
- "Years of Experience", "experience" -> profile.years_experience
- "LinkedIn Profile", "linkedin" -> profile.linkedin
- "GitHub", "github", "portfolio" -> profile.portfolio
- "Salary Expectation", "desired salary" -> profile.desired_salary
- "Notice Period" -> profile.notice_period
- "Willing to Relocate" -> profile.willing_to_relocate
- "Visa Status", "work authorization" -> profile.visa_status
- "Degree", "education" -> profile.degree
- "University", "college" -> profile.university
- "Graduation Year" -> profile.graduation_year
- "Skills", "technical skills" -> profile.technical_skills
"""


# User prompt template
USER_PROMPT_TEMPLATE = """Form Fields to Map:
{form_fields_json}

Candidate Profile:
{profile_json}

Context: Job application form for {context}

Map each form field to the best matching profile field. Return JSON with mappings, confidence scores, and reasoning."""


@dataclass
class FieldMappingResult:
    """Result of field mapping operation"""
    form_field_id: str
    form_field_name: str
    form_field_label: str
    form_field_type: str
    profile_field: str
    profile_value: str
    confidence: float
    match_reason: str
    method: str  # "ai", "rule_based", "hybrid"


@dataclass
class MappingSummary:
    """Summary statistics for mapping"""
    total_form_fields: int = 0
    mapped_fields: int = 0
    mapping_percentage: float = 0.0
    average_confidence: float = 0.0
    ai_mappings: int = 0
    rule_based_mappings: int = 0


class AIFieldMappingService:
    """
    AI-powered field mapping with rule-based fallback
    """
    
    def __init__(self):
        self._nim_client = None
        self.rule_based_service = FieldMappingService()
        self.confidence_threshold = 0.7
    
    @property
    def nim_client(self):
        """Lazy initialization of NIM client"""
        if self._nim_client is None:
            try:
                self._nim_client = get_nim_client()
            except Exception as e:
                logger.warning(f"Failed to initialize NIM client: {e}")
                self._nim_client = None
        return self._nim_client
    
    @property
    def token_optimizer(self):
        """Lazy initialization of token optimizer"""
        return TokenOptimizer()
    
    def map_fields_with_ai(
        self,
        form_analysis: Dict[str, Any],
        profile: Dict[str, Any],
        use_ai: bool = True,
        confidence_threshold: float = 0.7,
        fallback_to_rule_based: bool = True
    ) -> Dict[str, Any]:
        """
        Main entry point for AI-assisted field mapping
        
        Args:
            form_analysis: Form analysis from form_analysis_service
            profile: Candidate profile data
            use_ai: Whether to use AI (default True)
            confidence_threshold: Minimum confidence for AI mappings
            fallback_to_rule_based: Whether to use rule-based for low confidence
            
        Returns:
            Mapping result with mappings, stats, and metadata
        """
        self.confidence_threshold = confidence_threshold
        
        # Extract form fields from analysis
        form_fields = self._extract_form_fields(form_analysis)
        
        if not form_fields:
            return self._empty_result("No form fields found")
        
        # Prepare profile data
        flat_profile = self._flatten_profile(profile)
        
        if not flat_profile:
            return self._empty_result("No profile data available")
        
        # Step 1: Try AI mapping if enabled
        ai_mappings = []
        ai_tokens_used = 0
        ai_latency = 0
        used_ai = False
        
        if use_ai:
            try:
                ai_result = self._map_with_ai(form_fields, flat_profile)
                if ai_result and ai_result.get('mappings'):
                    ai_mappings = ai_result['mappings']
                    ai_tokens_used = ai_result.get('tokens_used', 0)
                    ai_latency = ai_result.get('latency_ms', 0)
                    used_ai = True
                    logger.info(f"AI mapping successful: {len(ai_mappings)} mappings, {ai_tokens_used} tokens")
            except Exception as e:
                logger.warning(f"AI mapping failed, falling back to rule-based: {e}")
                ai_mappings = []
        
        # Step 2: Rule-based mapping for all fields
        rule_based_result = self.rule_based_service.map_form_to_profile(form_analysis, profile)
        rule_mappings = rule_based_result.get('mappings', [])
        
        # Step 3: Combine results - prefer AI for high confidence, rule-based for rest
        combined_mappings = self._combine_mappings(
            ai_mappings=ai_mappings,
            rule_mappings=rule_mappings,
            form_fields=form_fields,
            flat_profile=flat_profile,
            confidence_threshold=confidence_threshold,
            fallback_to_rule_based=fallback_to_rule_based
        )
        
        # Step 4: Calculate summary
        summary = self._calculate_summary(combined_mappings, len(form_fields))
        
        # Find unmapped fields
        mapped_field_ids = {m['form_field_id'] for m in combined_mappings}
        all_field_ids = {f['id'] for f in form_fields}
        unmapped_form_fields = list(all_field_ids - mapped_field_ids)
        
        mapped_profile_fields = {m['profile_field'] for m in combined_mappings}
        all_profile_fields = set(flat_profile.keys())
        unmapped_profile_fields = list(all_profile_fields - mapped_profile_fields)
        
        return {
            'success': True,
            'mappings': combined_mappings,
            'unmapped_form_fields': unmapped_form_fields,
            'unmapped_profile_fields': unmapped_profile_fields,
            'summary': summary,
            'used_ai': used_ai,
            'tokens_used': ai_tokens_used,
            'latency_ms': ai_latency,
            'timestamp': datetime.utcnow().isoformat()
        }
    
    def _map_with_ai(
        self,
        form_fields: List[Dict[str, Any]],
        flat_profile: Dict[str, Any]
    ) -> Optional[Dict[str, Any]]:
        """Execute AI mapping using NVIDIA NIM."""

        # Prepare form fields for prompt (limit to avoid token overflow)
        limited_fields = form_fields[:30]  # Limit for token budget

        form_fields_json = json.dumps(limited_fields, indent=2)
        profile_json = json.dumps(flat_profile, indent=2)

        user_prompt = USER_PROMPT_TEMPLATE.format(
            form_fields_json=form_fields_json,
            profile_json=profile_json,
            context="job application"
        )

        # Execute structured completion — bridge to async NIM client
        if self.nim_client is None:
            logger.warning("NIM client not available, skipping AI mapping")
            return None

        try:
            import asyncio
            # Flask runs synchronously — there is no running event loop.
            # asyncio.run() creates its own loop, runs the coroutine, and
            # tears the loop down cleanly. This is the correct pattern.
            response = asyncio.run(
                self.nim_client.structured_completion(
                    system_prompt=SYSTEM_PROMPT,
                    user_prompt=user_prompt,
                    schema=FIELD_MAPPING_SCHEMA,
                    max_tokens=4096
                )
            )
        except RuntimeError as e:
            # asyncio.run() raises RuntimeError if called from inside a running loop.
            # This can happen in test environments. Fall back to creating a new loop.
            logger.warning(f"asyncio.run() not available (running loop?), trying new loop: {e}")
            try:
                import asyncio
                loop = asyncio.new_event_loop()
                try:
                    response = loop.run_until_complete(
                        self.nim_client.structured_completion(
                            system_prompt=SYSTEM_PROMPT,
                            user_prompt=user_prompt,
                            schema=FIELD_MAPPING_SCHEMA,
                            max_tokens=4096
                        )
                    )
                finally:
                    loop.close()
            except Exception as inner_e:
                logger.error(f"AI NIM call failed (fallback loop): {inner_e}")
                return None
        except Exception as e:
            logger.error(f"AI NIM call failed: {e}")
            return None
        
        if not response.success:
            logger.error(f"AI mapping failed: {response.error}")
            return None
        
        try:
            result = json.loads(response.content)
            
            # Convert to our format
            mappings = []
            for m in result.get('mappings', []):
                # Find the form field to get full details
                form_field = next((f for f in limited_fields if f['id'] == m.get('form_field_id')), {})
                
                mappings.append({
                    'form_field_id': m.get('form_field_id'),
                    'form_field_name': m.get('form_field_name', form_field.get('name', '')),
                    'form_field_label': m.get('form_field_label', form_field.get('label', '')),
                    'form_field_type': m.get('form_field_type', form_field.get('type', '')),
                    'profile_field': m.get('profile_field'),
                    'profile_value': flat_profile.get(m.get('profile_field'), ''),
                    'confidence': m.get('confidence', 0.0),
                    'match_reason': m.get('match_reason', 'AI semantic matching'),
                    'method': 'ai'
                })
            
            return {
                'mappings': mappings,
                'tokens_used': response.tokens_used,
                'latency_ms': response.latency_ms
            }
            
        except json.JSONDecodeError as e:
            logger.error(f"Failed to parse AI response: {e}")
            return None
    
    def _combine_mappings(
        self,
        ai_mappings: List[Dict[str, Any]],
        rule_mappings: List[Dict[str, Any]],
        form_fields: List[Dict[str, Any]],
        flat_profile: Dict[str, Any],
        confidence_threshold: float,
        fallback_to_rule_based: bool
    ) -> List[Dict[str, Any]]:
        """Combine AI and rule-based mappings intelligently"""
        
        # Create lookup for rule-based mappings by form_field_id
        rule_by_id = {m.get('form_field_id') or m.get('form_field_name'): m for m in rule_mappings}
        
        # Create lookup for AI mappings by form_field_id
        ai_by_id = {m['form_field_id']: m for m in ai_mappings}
        
        combined = []
        processed_ids = set()
        
        # First pass: Use AI mappings with high confidence
        for ai_map in ai_mappings:
            field_id = ai_map['form_field_id']
            if ai_map['confidence'] >= confidence_threshold:
                combined.append(ai_map)
                processed_ids.add(field_id)
        
        # Second pass: For remaining fields, use rule-based if available
        if fallback_to_rule_based:
            for field in form_fields:
                field_id = field['id']
                if field_id in processed_ids:
                    continue
                
                # Check rule-based
                rule_key = field_id if field_id in rule_by_id else field['name']
                if rule_key in rule_by_id:
                    rule_map = rule_by_id[rule_key].copy()
                    rule_map['method'] = 'rule_based'
                    # Ensure all required fields
                    rule_map.setdefault('form_field_id', field_id)
                    rule_map.setdefault('form_field_name', field['name'])
                    rule_map.setdefault('form_field_label', field.get('label', ''))
                    rule_map.setdefault('form_field_type', field.get('type', ''))
                    # Get the profile field name from the rule mapping (could be 'profile_field_name' or similar)
                    profile_field_name = rule_map.get('profile_field_name') or rule_map.get('profile_field')
                    if profile_field_name:
                        rule_map['profile_field'] = profile_field_name
                        rule_map.setdefault('profile_value', flat_profile.get(profile_field_name, ''))
                    else:
                        rule_map.setdefault('profile_value', '')
                    rule_map.setdefault('match_reason', 'Rule-based matching')
                    combined.append(rule_map)
                    processed_ids.add(field_id)
        
        return combined
    
    def _extract_form_fields(self, form_analysis: Dict[str, Any]) -> List[Dict[str, Any]]:
        """Extract standardized form fields from analysis result — ALL types including radio/checkbox."""
        fields = []

        forms = form_analysis.get('forms', [])
        for form in forms:
            for element in form.get('elements', []):
                field_type = element.get('type', 'text').lower()
                tag_name   = element.get('tag_name', element.get('tagName', 'input')).lower()

                # Include ALL fillable field types
                ALLOWED = {
                    'text', 'email', 'tel', 'url', 'textarea', 'select', 'select-one',
                    'select-multiple', 'number', 'date', 'hidden', 'password', 'search',
                    'radio', 'checkbox',   # ← was missing — breaks yes/no, work auth
                }
                if field_type not in ALLOWED and tag_name not in ('select', 'textarea'):
                    continue

                field = {
                    'id':          element.get('element_id', element.get('id', f'field_{len(fields)}')),
                    'name':        element.get('element_name', element.get('name', '')),
                    'label':       element.get('label', ''),
                    'type':        field_type,
                    'tag_name':    tag_name,
                    'placeholder': element.get('placeholder', ''),
                    'required':    element.get('required', False),
                    'options':     element.get('options', []),
                    'is_yes_no':   element.get('is_yes_no', False),
                    'attributes':  element.get('attributes', {}),
                    'aria_label':  element.get('aria-label', ''),
                    'autocomplete': element.get('autocomplete', ''),
                }
                fields.append(field)

        return fields
    
    def _flatten_profile(self, profile: Dict[str, Any]) -> Dict[str, str]:
        """Flatten nested profile structure"""
        flat = {}
        
        def flatten(obj: Any, prefix: str = ''):
            if isinstance(obj, dict):
                for k, v in obj.items():
                    new_prefix = f"{prefix}_{k}" if prefix else k
                    flatten(v, new_prefix)
            elif isinstance(obj, list):
                # Convert list to comma-separated string
                flat[prefix] = ', '.join(str(item) for item in obj)
            else:
                flat[prefix] = str(obj) if obj is not None else ''
        
        flatten(profile)
        return flat
    
    def _calculate_summary(
        self,
        mappings: List[Dict[str, Any]],
        total_fields: int
    ) -> Dict[str, Any]:
        """Calculate mapping summary statistics"""
        if not mappings:
            return {
                'total_form_fields': total_fields,
                'mapped_fields': 0,
                'mapping_percentage': 0.0,
                'average_confidence': 0.0,
                'ai_mappings': 0,
                'rule_based_mappings': 0
            }
        
        mapped = len(mappings)
        avg_conf = sum(m.get('confidence', 0) for m in mappings) / mapped
        ai_count = sum(1 for m in mappings if m.get('method') == 'ai')
        rule_count = sum(1 for m in mappings if m.get('method') == 'rule_based')
        
        return {
            'total_form_fields': total_fields,
            'mapped_fields': mapped,
            'mapping_percentage': round((mapped / total_fields) * 100, 1) if total_fields > 0 else 0.0,
            'average_confidence': round(avg_conf, 2),
            'ai_mappings': ai_count,
            'rule_based_mappings': rule_count
        }
    
    def health_check(self) -> Dict[str, Any]:
        """Health check for AI field mapping service"""
        nim_available = False
        nim_error = None
        
        try:
            client = self.nim_client
            if client is not None:
                # Try a simple health check on the client
                nim_available = True
        except Exception as e:
            nim_error = str(e)
        
        return {
            'service': 'AIFieldMappingService',
            'status': 'healthy' if nim_available else 'degraded',
            'nim_available': nim_available,
            'nim_error': nim_error,
            'rule_based_available': True,
            'timestamp': datetime.utcnow().isoformat()
        }
    
    def _empty_result(self, message: str) -> Dict[str, Any]:
        """Return empty result structure"""
        return {
            'success': True,
            'mappings': [],
            'unmapped_form_fields': [],
            'unmapped_profile_fields': [],
            'summary': {
                'total_form_fields': 0,
                'mapped_fields': 0,
                'mapping_percentage': 0.0,
                'average_confidence': 0.0,
                'ai_mappings': 0,
                'rule_based_mappings': 0
            },
            'used_ai': False,
            'tokens_used': 0,
            'latency_ms': 0,
            'message': message,
            'timestamp': datetime.utcnow().isoformat()
        }
    
    def analyze_fields_semantically(
        self,
        fields: List[Dict[str, Any]],
        context: str = 'job_application'
    ) -> Dict[str, Any]:
        """
        Analyze form fields semantically using AI
        """
        # For now, return basic analysis
        # Can be extended with dedicated AI semantic analysis
        analysis = []
        for field in fields:
            field_type = field.get('type', 'text')
            label = field.get('label', '').lower()
            name = field.get('name', '').lower()
            placeholder = field.get('placeholder', '').lower()
            
            # Determine semantic type
            semantic_type = 'unknown'
            if field_type == 'email' or 'email' in label or 'email' in name:
                semantic_type = 'email'
            elif field_type == 'tel' or 'phone' in label or 'phone' in name or 'mobile' in label:
                semantic_type = 'phone'
            elif field_type == 'url' or 'linkedin' in label or 'github' in label or 'portfolio' in label:
                semantic_type = 'url'
            elif 'name' in label and 'first' in label:
                semantic_type = 'first_name'
            elif 'name' in label and 'last' in label:
                semantic_type = 'last_name'
            elif 'name' in label or 'name' in name:
                semantic_type = 'full_name'
            elif 'address' in label or 'address' in name:
                semantic_type = 'address'
            elif 'city' in label:
                semantic_type = 'city'
            elif 'state' in label or 'province' in label:
                semantic_type = 'state'
            elif 'zip' in label or 'postal' in label:
                semantic_type = 'zip_code'
            elif 'country' in label:
                semantic_type = 'country'
            elif 'title' in label or 'position' in label or 'role' in label:
                semantic_type = 'job_title'
            elif 'company' in label or 'employer' in label:
                semantic_type = 'company'
            elif 'experience' in label or 'years' in label:
                semantic_type = 'years_experience'
            elif 'salary' in label or 'compensation' in label or 'pay' in label:
                semantic_type = 'salary'
            elif 'skill' in label or 'technology' in label or 'tech stack' in label:
                semantic_type = 'skills'
            elif 'degree' in label or 'education' in label:
                semantic_type = 'education'
            elif 'university' in label or 'college' in label or 'school' in label:
                semantic_type = 'university'
            elif 'graduat' in label:
                semantic_type = 'graduation_year'
            elif 'certification' in label or 'certificate' in label:
                semantic_type = 'certifications'
            elif 'language' in label:
                semantic_type = 'languages'
            elif 'visa' in label or 'work authoriz' in label or 'citizenship' in label:
                semantic_type = 'work_authorization'
            elif 'relocat' in label:
                semantic_type = 'relocation'
            elif 'notice' in label:
                semantic_type = 'notice_period'
            elif 'remote' in label:
                semantic_type = 'remote_preference'
            elif 'travel' in label:
                semantic_type = 'travel_percentage'
            elif 'shift' in label:
                semantic_type = 'shift_preference'
            
            analysis.append({
                'field_id': field.get('id', ''),
                'field_name': field.get('name', ''),
                'field_label': field.get('label', ''),
                'field_type': field_type,
                'semantic_type': semantic_type,
                'confidence': 0.9 if semantic_type != 'unknown' else 0.3
            })
        
        return {
            'success': True,
            'analysis': analysis,
            'context': context
        }