# Field Mapping Service - Service Module

import logging
from typing import Dict, List, Any, Optional, Tuple
from dataclasses import dataclass
from difflib import SequenceMatcher
from datetime import datetime
import re

# Import shared constants from Milestone 3
from ..utils.form_analysis.constants import ENGINE_VERSION, ENGINE_NAME

logger = logging.getLogger(__name__)


@dataclass
class FieldMappingResult:
    """Result of field mapping operation."""
    form_field_name: str
    form_field_type: str
    profile_field_name: str
    confidence_score: float
    match_type: str  # exact, alias, partial, fuzzy, autocomplete, placeholder, aria
    mapped_value: Optional[Any] = None
    alternative_matches: List[Dict[str, Any]] = None


class FieldMappingService:
    """Service for mapping form fields to candidate profile fields."""
    
    # Autocomplete attribute to profile field mapping
    AUTOCOMPLETE_MAPPING = {
        'email': 'email',
        'tel': 'phone',
        'telephone': 'phone',
        'tel-national': 'phone',
        'tel-country-code': 'phone',
        'tel-area-code': 'phone',
        'tel-local': 'phone',
        'tel-local-prefix': 'phone',
        'tel-local-suffix': 'phone',
        'tel-extension': 'phone',
        'given-name': 'first_name',
        'additional-name': 'middle_name',
        'family-name': 'last_name',
        'name': 'full_name',
        'honorific-prefix': 'full_name',
        'honorific-suffix': 'full_name',
        'nickname': 'full_name',
        'username': 'full_name',
        'organization': 'company',
        'organization-title': 'job_title',
        'street-address': 'address',
        'address-line1': 'address',
        'address-line2': 'address',
        'address-line3': 'address',
        'address-level4': 'city',
        'address-level3': 'city',
        'address-level2': 'state',
        'address-level1': 'state',
        'postal-code': 'zip_code',
        'country': 'country',
        'country-name': 'country',
        'cc-name': 'full_name',
        'cc-given-name': 'first_name',
        'cc-additional-name': 'middle_name',
        'cc-family-name': 'last_name',
        'cc-number': 'credit_card',
        'cc-exp': 'credit_card_expiry',
        'cc-exp-month': 'credit_card_expiry',
        'cc-exp-year': 'credit_card_expiry',
        'cc-csc': 'credit_card_cvv',
        'cc-type': 'credit_card_type',
        'transaction-currency': 'currency',
        'transaction-amount': 'amount',
        'language': 'language',
        'bday': 'birthdate',
        'bday-day': 'birthdate',
        'bday-month': 'birthdate',
        'bday-year': 'birthdate',
        'sex': 'gender',
        'url': 'website',
        'photo': 'photo',
    }

    def __init__(self):
        self.logger = logging.getLogger(__name__ + '.FieldMappingService')
        # Define field aliases for common variations
        self.field_aliases = {
            # Name variations
            'full_name': ['name', 'fullname', 'client_name', 'applicant_name', 'customer_name'],
            'first_name': ['firstname', 'fname', 'given_name', 'first'],
            'last_name': ['lastname', 'lname', 'surname', 'family_name'],
            'middle_name': ['middlename', 'mname', 'middle_initial'],
            
            # Contact information
            'email': ['email_address', 'e_mail', 'electronic_mail'],
            'phone': ['phone_number', 'telephone', 'mobile', 'cell', 'contact_number'],
            'address': ['street_address', 'mailing_address', 'home_address'],
            'city': ['town', 'locality', 'location', 'city_name'],
            'state': ['province', 'region'],
            'zip_code': ['postal_code', 'zip'],
            'country': ['nation'],
            
            # Professional information
            'company': ['employer', 'organization', 'firm', 'company_name'],
            'job_title': ['position', 'title', 'role', 'occupation'],
            'experience_years': ['years_experience', 'experience', 'work_experience'],
            'salary': ['compensation', 'wage', 'pay', 'salary_expected'],
            
            # Education
            'school': ['university', 'college', 'institution', 'educational_institution'],
            'degree': ['qualification', 'certification', 'educational_level'],
            'graduation_year': ['year_of_graduation', 'graduate_year'],
            
            # Skills and experience
            'skills': ['competencies', 'expertise', 'proficiencies'],
            'resume': ['cv', 'curriculum_vitae', 'bio', 'biography'],
            'cover_letter': ['application_letter', 'motivation_letter'],
            
            # Links and profiles
            'linkedin': ['linkedin_profile', 'linkedin_url'],
            'github': ['github_profile', 'github_url', 'git'],
            'portfolio': ['personal_website', 'website', 'portfolio_url'],
            
            # Availability
            'availability': ['start_date', 'available_from', 'date_available'],
            'notice_period': ['notice_period_days', 'notice']
        }
        
        # Reverse lookup for faster matching
        self.reverse_aliases = {}
        for canonical, aliases in self.field_aliases.items():
            for alias in aliases:
                self.reverse_aliases[alias.lower()] = canonical
    
    def normalize_field_name(self, field_name: str) -> str:
        """Normalize field names by removing brackets, array notation, etc."""
        if not field_name:
            return ''
        
        # Remove array notation like job_application[first_name] -> first_name
        # Also handle candidate[email] -> email
        bracket_match = re.search(r'\[([^\]]+)\]', field_name)
        if bracket_match:
            return bracket_match.group(1)
        
        # Remove common prefixes
        prefixes_to_remove = ['job_application', 'candidate', 'application', 'user', 'profile']
        for prefix in prefixes_to_remove:
            if field_name.startswith(prefix + '_'):
                return field_name[len(prefix) + 1:]
            if field_name.startswith(prefix + '['):
                return field_name[len(prefix) + 1:]
        
        return field_name
    
    def normalize_label(self, label: str) -> str:
        """Normalize labels by removing punctuation, symbols, and converting to underscores."""
        if not label:
            return ''
        
        # Remove punctuation and symbols (*, brackets, etc.)
        normalized = re.sub(r'[^\w\s]', '', label)
        
        # Convert spaces to underscores
        normalized = normalized.replace(' ', '_')
        
        # Convert to lowercase
        normalized = normalized.lower()
        
        return normalized
    
    def map_form_to_profile(self, form_analysis_data: Dict[str, Any], 
                           profile_data: Dict[str, Any]) -> Dict[str, Any]:
        """
        Map form fields to profile fields based on field names and types.
        
        Args:
            form_analysis_data: Output from form analysis service
            profile_data: Candidate profile data from database/Supabase
            
        Returns:
            Dictionary containing mapping results and unmapped fields
        """
        self.logger.info("Starting field mapping process")
        
        # Extract form fields from analysis
        form_fields = self._extract_form_fields(form_analysis_data)
        
        # Extract profile fields
        profile_fields = self._extract_profile_fields(profile_data)
        
        # Log profile fields for debugging
        self.logger.info(f"Profile fields available: {list(profile_fields.keys())}")
        
        # Log form fields for debugging
        self.logger.info(f"Form fields detected: {len(form_fields)}")
        for f in form_fields:
            self.logger.info(f"  Form field: name='{f['name']}', label='{f.get('label', '')}', type='{f.get('type', '')}'")
        
        # Perform mapping
        mappings = []
        unmapped_form_fields = []
        unmapped_profile_fields = list(profile_fields.keys())
        
        # Track used profile fields to prevent duplicates
        used_profile_fields = {}  # profile_field -> (form_field_name, confidence)
        ambiguous_fields = []  # Track fields that couldn't be uniquely mapped
        
        for form_field in form_fields:
            best_match = self._find_best_match(form_field, profile_fields, used_profile_fields)
            
            if best_match:
                profile_field_name, confidence, match_type, matched_value = best_match
                
                # Check for duplicate profile field mapping
                if profile_field_name in used_profile_fields:
                    existing_form_field, existing_confidence = used_profile_fields[profile_field_name]
                    # Only replace if new match has significantly higher confidence (> 0.05 difference)
                    if confidence > existing_confidence + 0.05:
                        # Replace the existing mapping
                        for i, mapping in enumerate(mappings):
                            if mapping['profile_field_name'] == profile_field_name:
                                # Mark old form field as ambiguous
                                ambiguous_fields.append({
                                    'form_field_name': existing_form_field,
                                    'profile_field_name': profile_field_name,
                                    'confidence_score': existing_confidence,
                                    'match_type': mapping['match_type'],
                                    'reason': 'replaced_by_higher_confidence_match'
                                })
                                # Update the mapping
                                mappings[i] = {
                                    'form_field_name': form_field['name'],
                                    'form_field_type': form_field['type'],
                                    'form_field_id': form_field.get('id', ''),
                                    'profile_field_name': profile_field_name,
                                    'confidence_score': confidence,
                                    'match_type': match_type,
                                    'mapped_value': matched_value,
                                    'form_field_label': form_field.get('label', ''),
                                    'form_field_placeholder': form_field.get('placeholder', '')
                                }
                                used_profile_fields[profile_field_name] = (form_field['name'], confidence)
                                break
                    else:
                        # Add current form field to ambiguous fields
                        ambiguous_fields.append({
                            'form_field_name': form_field['name'],
                            'profile_field_name': profile_field_name,
                            'confidence_score': confidence,
                            'match_type': match_type,
                            'reason': 'duplicate_profile_field'
                        })
                        # Don't add to mappings, treat as unmapped
                        unmapped_form_fields.append(form_field)
                        continue
                else:
                    # First time mapping this profile field
                    used_profile_fields[profile_field_name] = (form_field['name'], confidence)
                
                mappings.append({
                    'form_field_name': form_field['name'],
                    'form_field_type': form_field['type'],
                    'form_field_id': form_field.get('id', ''),
                    'profile_field_name': profile_field_name,
                    'confidence_score': confidence,
                    'match_type': match_type,
                    'mapped_value': matched_value,
                    'form_field_label': form_field.get('label', ''),
                    'form_field_placeholder': form_field.get('placeholder', '')
                })
                
                # Remove matched profile field from available pool
                if profile_field_name in unmapped_profile_fields:
                    unmapped_profile_fields.remove(profile_field_name)
            else:
                unmapped_form_fields.append(form_field)
        
        # Prepare result
        result = {
            'mappings': mappings,
            'unmapped_form_fields': [{
                'name': f['name'],
                'type': f['type'],
                'label': f.get('label', ''),
                'placeholder': f.get('placeholder', '')
            } for f in unmapped_form_fields],
            'unmapped_profile_fields': unmapped_profile_fields,
            'ambiguous_fields': ambiguous_fields,
            'mapping_statistics': {
                'total_form_fields': len(form_fields),
                'total_profile_fields': len(profile_fields),
                'mapped_pairs': len(mappings),
                'unmapped_form_count': len(unmapped_form_fields),
                'unmapped_profile_count': len(unmapped_profile_fields),
                'ambiguous_field_count': len(ambiguous_fields),
                'mapping_percentage': round((len(mappings) / len(form_fields)) * 100, 2) if form_fields else 0
            }
        }
        
        # Log generated mappings for debugging
        self.logger.info(f"Generated {len(mappings)} mappings")
        for m in mappings:
            self.logger.info(f"  Mapping: form_field='{m['form_field_name']}' -> profile_field='{m['profile_field_name']}', confidence={m['confidence_score']:.2f}, match_type='{m['match_type']}'")
        
        self.logger.info(f"Field mapping completed. {len(mappings)} mappings found, {len(ambiguous_fields)} ambiguous.")
        return result
    
    def _extract_form_fields(self, form_analysis_data: Dict[str, Any]) -> List[Dict[str, Any]]:
        """Extract form field information from analysis data."""
        form_fields = []
        
        for form in form_analysis_data.get('forms', []):
            for element in form.get('elements', []):
                # Skip non-input elements like buttons, labels, etc. for mapping
                if element.get('tag_name') in ['button', 'label', 'fieldset', 'legend']:
                    continue
                
                # Extract label - handle both dict (from label resolver) and string cases
                label_text = ''
                label_info = element.get('label', {})
                if isinstance(label_info, dict):
                    label_text = label_info.get('text', '')
                elif isinstance(label_info, str):
                    label_text = label_info
                
                field_info = {
                    'name': element.get('element_name', ''),
                    'type': element.get('type', element.get('tag_name', '')),
                    'id': element.get('element_id', ''),
                    'label': label_text,
                    'placeholder': element.get('placeholder', ''),
                    'autocomplete': element.get('autocomplete', ''),
                    'aria_label': element.get('aria-label', ''),
                    'aria_labelledby': element.get('aria-labelledby', ''),
                    'required': element.get('required', False),
                    'validation': element.get('validation', {}),
                    'form_index': form.get('form_index', 0),
                    'form_id': form.get('form_id', '')
                }
                
                # Only include fields that have a name or ID for mapping
                if field_info['name'] or field_info['id']:
                    form_fields.append(field_info)
        
        return form_fields
    
    def _extract_field_label(self, element: Dict[str, Any]) -> str:
        """Extract label information from element."""
        # Check for explicit label
        label_info = element.get('label', {})
        if label_info and isinstance(label_info, dict):
            return label_info.get('text', '')
        
        # Check for aria-label
        aria_label = element.get('aria-label')
        if aria_label:
            return aria_label
            
        # Check for aria-labelledby (would need resolution, simplified here)
        aria_labelledby = element.get('aria-labelledby')
        if aria_labelledby:
            return f"[aria-labelledby:{aria_labelledby}]"
            
        return ''
    
    def _extract_profile_fields(self, profile_data: Dict[str, Any]) -> Dict[str, Any]:
        """Extract and normalize profile fields."""
        # Flatten nested profile structure if needed
        flattened = {}
        
        def _flatten_dict(d, parent_key='', sep='_'):
            items = []
            for k, v in d.items():
                new_key = f"{parent_key}{sep}{k}" if parent_key else k
                if isinstance(v, dict):
                    items.extend(_flatten_dict(v, new_key, sep=sep).items())
                else:
                    items.append((new_key, v))
            return dict(items)
        
        flattened = _flatten_dict(profile_data)
        
        # Also include original keys for exact matches
        for key, value in profile_data.items():
            if key not in flattened:
                flattened[key] = value
        
        # Preserve leaf keys from nested structures for better matching
        def _extract_leaf_keys(d, parent_key=''):
            leaf_keys = {}
            if isinstance(d, dict):
                for k, v in d.items():
                    current_key = f"{parent_key}_{k}" if parent_key else k
                    if isinstance(v, dict):
                        # Recurse into nested dict
                        leaf_keys.update(_extract_leaf_keys(v, current_key))
                    else:
                        # This is a leaf node - preserve both full path and leaf key
                        leaf_keys[current_key] = v
                        leaf_keys[k] = v  # Also preserve just the leaf key
            return leaf_keys
        
        leaf_keys = _extract_leaf_keys(profile_data)
        flattened.update(leaf_keys)
        
        return flattened
    
    def _find_best_match(self, form_field: Dict[str, Any], 
                        profile_fields: Dict[str, Any], 
                        used_profile_fields: Dict[str, Tuple[str, float]]) -> Optional[Tuple[str, float, str, Any]]:
        """
        Find the best matching profile field for a form field.
        
        Returns:
            Tuple of (profile_field_name, confidence_score, match_type, matched_value) or None
        """
        form_name = form_field['name'].lower().strip()
        form_id = form_field['id'].lower().strip()
        form_label = form_field.get('label', '').lower().strip()
        form_placeholder = form_field.get('placeholder', '').lower().strip()
        form_autocomplete = form_field.get('autocomplete', '').lower().strip()
        form_aria_label = form_field.get('aria_label', '').lower().strip()
        form_aria_labelledby = form_field.get('aria_labelledby', '').lower().strip()
        form_type = form_field.get('type', '').lower()
        
        # Normalize field names for Greenhouse-style names
        normalized_form_name = self.normalize_field_name(form_name).lower()
        normalized_form_id = self.normalize_field_name(form_id).lower()
        normalized_form_label = self.normalize_label(form_label).lower()
        normalized_form_placeholder = self.normalize_label(form_placeholder).lower()
        
        # Skip fields without identifiable names
        if not form_name and not form_id and not form_label and not form_placeholder:
            return None
        
        # Restrict candidate profile fields based on field type
        candidate_fields = self._get_candidate_fields_by_type(form_type, profile_fields)
        
        best_match = None
        best_score = 0.0
        best_match_type = ''
        best_value = None
        
        # Check each candidate profile field
        for profile_field_name, profile_value in candidate_fields.items():
            profile_field_lower = profile_field_name.lower()
            
            # Calculate match score
            score, match_type = self._calculate_match_score(
                normalized_form_name, normalized_form_id, normalized_form_label, normalized_form_placeholder,
                form_autocomplete, form_aria_label, form_aria_labelledby,
                profile_field_lower, profile_value
            )
            
            if score > best_score and score > 0.3:  # Minimum threshold
                best_score = score
                best_match = profile_field_name
                best_match_type = match_type
                best_value = profile_value
        
        if best_match:
            return (best_match, best_score, best_match_type, best_value)
        
        return None
    
    def _get_candidate_fields_by_type(self, field_type: str, profile_fields: Dict[str, Any]) -> Dict[str, Any]:
        """Restrict candidate profile fields based on field type for better matching."""
        # Field type to profile field keywords mapping
        type_keywords = {
            'email': ['email', 'mail', 'contact'],
            'tel': ['phone', 'mobile', 'telephone', 'contact'],
            'url': ['website', 'portfolio', 'linkedin', 'github', 'url', 'link'],
            'date': ['birthdate', 'birth', 'date', 'graduation', 'start'],
            'number': ['years', 'experience', 'salary', 'zip', 'postal', 'phone'],
            'text': ['name', 'first', 'last', 'full', 'address', 'city', 'state', 'country'],
            'textarea': ['description', 'summary', 'bio', 'about', 'skills'],
            'select': ['country', 'state', 'city', 'gender', 'education', 'degree'],
        }
        
        # Get keywords for this field type
        keywords = type_keywords.get(field_type, [])
        
        # If no specific keywords or field type is generic, return all fields
        if not keywords or field_type in ['text', 'hidden']:
            return profile_fields
        
        # Filter profile fields that match keywords
        candidate_fields = {}
        for field_name, field_value in profile_fields.items():
            field_lower = field_name.lower()
            # Check if field name contains any of the keywords
            if any(keyword in field_lower for keyword in keywords):
                candidate_fields[field_name] = field_value
        
        # If no matches found, return all fields as fallback
        return candidate_fields if candidate_fields else profile_fields
    
    def _calculate_match_score(self, form_name: str, form_id: str, form_label: str, form_placeholder: str,
                              form_autocomplete: str, form_aria_label: str, form_aria_labelledby: str,
                              profile_field: str, profile_value: Any) -> Tuple[float, str]:
        """Calculate match score between form field and profile field."""
        
        # Autocomplete matching (HIGH PRIORITY - confidence 0.98)
        if form_autocomplete:
            # Handle space-separated autocomplete values (e.g., "shipping email")
            autocomplete_parts = form_autocomplete.split()
            for part in autocomplete_parts:
                if part in self.AUTOCOMPLETE_MAPPING:
                    target_field = self.AUTOCOMPLETE_MAPPING[part]
                    if target_field == profile_field:
                        return (0.98, 'autocomplete')
                    # Also check if it's an alias of the profile field
                    if target_field in self.reverse_aliases:
                        canonical = self.reverse_aliases[target_field]
                        if canonical == profile_field:
                            return (0.98, 'autocomplete')
                    if profile_field in self.reverse_aliases:
                        canonical = self.reverse_aliases[profile_field]
                        if canonical == target_field:
                            return (0.98, 'autocomplete')
        
        # ARIA label matching (confidence 0.92)
        if form_aria_label:
            # Normalize aria-label to underscore_case for matching
            # e.g. "First Name" -> "first_name" to match profile field "first_name"
            norm_aria = form_aria_label.lower().replace(' ', '_').replace('-', '_')
            norm_aria = re.sub(r'[^a-z0-9_]', '', norm_aria)

            # Direct exact match after normalization
            if norm_aria == profile_field:
                return (0.95, 'aria_label_exact')

            # Direct match (original)
            if form_aria_label == profile_field:
                return (0.92, 'aria_label_exact')

            # Check if normalized aria-label matches an alias
            for check in (norm_aria, form_aria_label):
                if check in self.reverse_aliases:
                    canonical = self.reverse_aliases[check]
                    if canonical == profile_field:
                        return (0.92, 'aria_label_alias')

            # Check if profile field matches an alias of aria_label
            if profile_field in self.reverse_aliases:
                canonical = self.reverse_aliases[profile_field]
                if canonical in (norm_aria, form_aria_label):
                    return (0.92, 'aria_label_alias')

            # Fuzzy match on normalized aria-label
            ratio = SequenceMatcher(None, norm_aria, profile_field).ratio()
            if ratio >= 0.9:
                return (0.92 * ratio, 'aria_label_fuzzy')
            elif ratio >= 0.8:
                return (0.88 * ratio, 'aria_label_strong')
            elif ratio >= 0.7:
                return (0.82 * ratio, 'aria_label_medium')
            elif ratio >= 0.6:
                return (0.78 * ratio, 'aria_label_weak')
        
        # aria-labelledby matching (confidence 0.92)
        if form_aria_labelledby:
            # The aria-labelledby value is an ID reference, we use it as matching signal
            if form_aria_labelledby == profile_field:
                return (0.92, 'aria_labelledby_exact')
            
            if form_aria_labelledby in self.reverse_aliases:
                canonical = self.reverse_aliases[form_aria_labelledby]
                if canonical == profile_field:
                    return (0.92, 'aria_labelledby_alias')
            
            if profile_field in self.reverse_aliases:
                canonical = self.reverse_aliases[profile_field]
                if canonical == form_aria_labelledby:
                    return (0.92, 'aria_labelledby_alias')
            
            ratio = SequenceMatcher(None, form_aria_labelledby, profile_field).ratio()
            if ratio >= 0.9:
                return (0.92 * ratio, 'aria_labelledby_fuzzy')
            elif ratio >= 0.8:
                return (0.88 * ratio, 'aria_labelledby_strong')
            elif ratio >= 0.7:
                return (0.82 * ratio, 'aria_labelledby_medium')
            elif ratio >= 0.6:
                return (0.78 * ratio, 'aria_labelledby_weak')
        
        # Exact match (1.0)
        if form_name == profile_field or form_id == profile_field:
            return (1.0, 'exact')
        
        # Alias matching (0.95)
        if form_name in self.reverse_aliases:
            canonical_form = self.reverse_aliases[form_name]
            if canonical_form == profile_field:
                return (0.95, 'alias')
        
        if form_id in self.reverse_aliases:
            canonical_id = self.reverse_aliases[form_id]
            if canonical_id == profile_field:
                return (0.9, 'alias')
        
        # Check if form field matches any alias of profile field
        if profile_field in self.reverse_aliases:
            # This means profile_field is an alias, check if it matches our form field
            canonical_profile = self.reverse_aliases[profile_field]
            if form_name == canonical_profile or form_id == canonical_profile:
                return (0.9, 'alias')
        
        # Label matching — raised scores since labels are the most reliable signal
        # on modern ATS platforms (Greenhouse, Lever, Ashby)
        if form_label:
            # Normalize label the same way we normalize field names
            norm_label = form_label.lower().replace(' ', '_').replace('-', '_')
            norm_label = re.sub(r'[^a-z0-9_]', '', norm_label)

            # Exact match after normalization (e.g. "first_name" == "first_name")
            if norm_label == profile_field:
                return (0.95, 'label_exact')

            # Raw exact match
            if form_label == profile_field:
                return (0.92, 'label_exact')

            # Normalized label matches an alias (e.g. "full_name" → canonical "full_name")
            for check in (norm_label, form_label):
                if check in self.reverse_aliases:
                    canonical_label = self.reverse_aliases[check]
                    if canonical_label == profile_field:
                        return (0.92, 'label_alias')

            # Profile field is an alias → check if canonical matches label
            if profile_field in self.reverse_aliases:
                canonical_profile = self.reverse_aliases[profile_field]
                if canonical_profile in (norm_label, form_label):
                    return (0.92, 'label_alias')

            # Fuzzy match on normalized label
            ratio = SequenceMatcher(None, norm_label, profile_field).ratio()
            if ratio >= 0.9:
                return (0.92 * ratio, 'label_fuzzy')
            elif ratio >= 0.8:
                return (0.88 * ratio, 'label_strong')
            elif ratio >= 0.7:
                return (0.82 * ratio, 'label_medium')
            elif ratio >= 0.6:
                return (0.76 * ratio, 'label_weak')
        
        # Placeholder matching (confidence 0.88)
        if form_placeholder:
            # Check exact match
            if form_placeholder == profile_field:
                return (0.88, 'placeholder_exact')
            
            # Check if placeholder matches an alias
            if form_placeholder in self.reverse_aliases:
                canonical_placeholder = self.reverse_aliases[form_placeholder]
                if canonical_placeholder == profile_field:
                    return (0.88, 'placeholder_alias')
            
            # Check if profile field is an alias of placeholder
            if profile_field in self.reverse_aliases:
                canonical_profile = self.reverse_aliases[profile_field]
                if canonical_profile == form_placeholder:
                    return (0.88, 'placeholder_alias')
            
            # Fuzzy match on placeholder
            ratio = SequenceMatcher(None, form_placeholder, profile_field).ratio()
            if ratio >= 0.9:
                return (0.88 * ratio, 'placeholder_fuzzy')
            elif ratio >= 0.8:
                return (0.82 * ratio, 'placeholder_strong')
            elif ratio >= 0.7:
                return (0.75 * ratio, 'placeholder_medium')
            elif ratio >= 0.6:
                return (0.7 * ratio, 'placeholder_weak')
        
        # Partial match (contains) - improved with SequenceMatcher
        if form_name in profile_field or profile_field in form_name:
            shorter_len = min(len(form_name), len(profile_field))
            longer_len = max(len(form_name), len(profile_field))
            if longer_len > 0:
                ratio = shorter_len / longer_len
                if ratio > 0.6:
                    return (0.7 * ratio, 'partial')
        
        if form_id in profile_field or profile_field in form_id:
            shorter_len = min(len(form_id), len(profile_field))
            longer_len = max(len(form_id), len(profile_field))
            if longer_len > 0:
                ratio = shorter_len / longer_len
                if ratio > 0.6:
                    return (0.65 * ratio, 'partial_id')
        
        # Improved fuzzy matching using SequenceMatcher
        form_words = set(form_name.replace('_', ' ').split())
        profile_words = set(profile_field.replace('_', ' ').split())
        
        if form_words and profile_words:
            common_words = form_words.intersection(profile_words)
            if common_words:
                # Jaccard similarity
                jaccard_sim = len(common_words) / len(form_words.union(profile_words))
                
                # Also use SequenceMatcher for better fuzzy matching
                seq_ratio = SequenceMatcher(None, form_name, profile_field).ratio()
                
                # Use the better of the two similarity measures
                combined_sim = max(jaccard_sim, seq_ratio)
                
                if combined_sim >= 0.9:
                    return (0.8 * combined_sim, 'fuzzy_exact')
                elif combined_sim >= 0.8:
                    return (0.75 * combined_sim, 'fuzzy_strong')
                elif combined_sim >= 0.7:
                    return (0.7 * combined_sim, 'fuzzy_medium')
                elif combined_sim >= 0.6:
                    return (0.65 * combined_sim, 'fuzzy_weak')
        
        return (0.0, 'none')
    
    def get_supported_field_types(self) -> List[str]:
        """Return list of supported field types for mapping."""
        return [
            'text', 'email', 'tel', 'number', 'date', 'textarea', 'select',
            'checkbox', 'radio', 'file', 'hidden', 'password', 'url'
        ]
    
    def get_field_aliases(self) -> Dict[str, List[str]]:
        """Return the field aliases mapping."""
        return self.field_aliases.copy()


# Convenience function for easy usage
def map_form_to_profile(form_analysis_data: Dict[str, Any], 
                       profile_data: Dict[str, Any]) -> Dict[str, Any]:
    """
    Convenience function to map form fields to profile fields.
    
    Args:
        form_analysis_data: Output from form analysis service
        profile_data: Candidate profile data
        
    Returns:
        Dictionary containing mapping results
    """
    service = FieldMappingService()
    return service.map_form_to_profile(form_analysis_data, profile_data)