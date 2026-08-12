# Form Analysis Engine - Utility Module: Validator

import re
import logging
from typing import Dict, List, Any, Optional, Union

logger = logging.getLogger(__name__)


class FormValidator:
    """Extracts and normalizes validation attributes from form elements."""
    
    def __init__(self):
        # Compile regex patterns for performance
        self.email_regex = re.compile(r'^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$')
        self.url_regex = re.compile(r'^https?://(?:[-\w.])+(?:[:\d]+)?(?:/(?:[\w/_.])*(?:\?(?:[\w&=%.])?)?(?:#(?:[\w.])+)?)?$')
        
    def extract_validation_attributes(self, form_data: Dict[str, Any]) -> Dict[str, Any]:
        """
        Extract validation attributes from form elements.
        
        Args:
            form_data: Form data with parsed elements
            
        Returns:
            Form data with validation attributes extracted and normalized
        """
        for form in form_data.get('forms', []):
            for element in form.get('elements', []):
                element['validation'] = self._extract_element_validation(element)
                
        return form_data
        
    def _extract_element_validation(self, element: Dict[str, Any]) -> Dict[str, Any]:
        """Extract validation attributes from a single element."""
        validation = {}
        
        # Standard HTML5 validation attributes
        std_attrs = ['required', 'readonly', 'disabled']
        for attr in std_attrs:
            if element.get(attr):
                validation[attr] = True
                
        # Constraint validation attributes
        constraint_attrs = {
            'pattern': 'pattern',
            'min': 'min',
            'max': 'max',
            'step': 'step',
            'minlength': 'minlength',
            'maxlength': 'maxlength'
        }
        
        for attr, json_key in constraint_attrs.items():
            value = element.get(attr)
            if value is not None and value != '':
                try:
                    # Try to convert to appropriate type
                    if attr in ['min', 'max', 'step']:
                        # Try float first, then int
                        try:
                            validation[json_key] = float(value)
                        except ValueError:
                            try:
                                validation[json_key] = int(value)
                            except ValueError:
                                validation[json_key] = str(value)
                    elif attr in ['minlength', 'maxlength']:
                        validation[json_key] = int(value)
                    else:
                        validation[json_key] = value
                except (ValueError, TypeError):
                    # Keep as string if conversion fails
                    validation[json_key] = str(value)
                    
        # Input-type specific validation
        input_type = element.get('type', '').lower()
        tag_name = element.get('tag_name', '').lower()

        if tag_name == 'input' or input_type:
            validation.update(self._extract_input_specific_validation(element))
        elif tag_name == 'select':
            validation.update(self._extract_select_specific_validation(element))
        elif tag_name == 'textarea':
            validation.update(self._extract_textarea_specific_validation(element))
            
        # ARIA validation and accessibility
        validation['aria'] = self._extract_aria_attributes(element)
        
        # Custom validation patterns (data-* attributes)
        validation['custom'] = self._extract_custom_validation(element)
        
        return validation
        
    def _extract_input_specific_validation(self, element: Dict[str, Any]) -> Dict[str, Any]:
        """Extract validation specific to input types."""
        validation = {}
        input_type = element.get('type', '').lower()
        
        # File input specific
        if input_type == 'file':
            accept = element.get('accept', '')
            if accept:
                # Parse accept attribute (comma-separated MIME types or file extensions)
                mime_types = []
                extensions = []
                for part in [p.strip() for p in str(accept).split(',') if p.strip()]:
                    if part.startswith('.'):
                        extensions.append(part)
                    elif '*' in part or '/' in part:
                        mime_types.append(part)
                    else:
                        # Could be either, treat as extension if it looks like one
                        if '.' in part and not ('/' in part or '\\' in part):
                            extensions.append(part)
                        else:
                            mime_types.append(part)
                            
                if mime_types:
                    validation['accept_mime_types'] = mime_types
                if extensions:
                    validation['accept_extensions'] = extensions
                    
            # Multiple files
            validation['multiple'] = element.get('multiple', False)
            
            # Capture attribute
            capture = element.get('capture')
            if capture is not None:
                if isinstance(capture, bool):
                    validation['capture'] = capture
                else:
                    # String values like "user", "environment" are truthy
                    validation['capture'] = bool(capture) and str(capture).lower() not in ['false', '0', '']
                    
        # Image input specific
        elif input_type == 'image':
            width = self._safe_int(element.get('width'))
            height = self._safe_int(element.get('height'))
            if width is not None:
                validation['width'] = width
            if height is not None:
                validation['height'] = height
            
        # Range/number inputs already handled in general constraints
        
        # Email/URL/tel/color types have implicit validation
        elif input_type in ['email', 'url', 'tel', 'color']:
            validation['type_specific_validation'] = True
            if input_type == 'email':
                validation['validation_type'] = 'email'
                # Also try to validate the current value if present
                current_value = element.get('value', '')
                if current_value and isinstance(current_value, str):
                    validation['value_valid_email'] = bool(self.email_regex.match(current_value.strip()))
            elif input_type == 'url':
                validation['validation_type'] = 'url'
                current_value = element.get('value', '')
                if current_value and isinstance(current_value, str):
                    validation['value_valid_url'] = bool(self.url_regex.match(current_value.strip()))
            elif input_type == 'tel':
                validation['validation_type'] = 'telephone'
            elif input_type == 'color':
                validation['validation_type'] = 'hex_color'
                current_value = element.get('value', '')
                if current_value and isinstance(current_value, str):
                    # Simple hex color check
                    val = current_value.strip().lower()
                    validation['value_valid_hex_color'] = bool(
                        re.match(r'^#([a-f0-9]{3}|[a-f0-9]{6})$', val)
                    )
                
        return validation
        
    def _extract_select_specific_validation(self, element: Dict[str, Any]) -> Dict[str, Any]:
        """Extract validation specific to select elements."""
        validation = {}
        
        # Multiple selection
        validation['multiple'] = element.get('multiple', False)
        
        # Size (number of visible options)
        size = self._safe_int(element.get('size'))
        if size is not None:
            validation['size'] = size
                
        return validation
        
    def _extract_textarea_specific_validation(self, element: Dict[str, Any]) -> Dict[str, Any]:
        """Extract validation specific to textarea elements."""
        validation = {}
        
        # Wrap attribute
        wrap = element.get('wrap', '').lower()
        if wrap in ['soft', 'hard', 'off']:
            validation['wrap'] = wrap
            
        return validation
        
    def _extract_aria_attributes(self, element: Dict[str, Any]) -> Dict[str, Any]:
        """Extract ARIA (Accessible Rich Internet Applications) attributes."""
        aria = {}
        
        # Common ARIA attributes for form elements
        aria_attrs = [
            'aria-label', 'aria-labelledby', 'aria-describedby',
            'aria-required', 'aria-readonly', 'aria-disabled',
            'aria-invalid', 'aria-errormessage',
            'aria-activedescendant', 'aria-controls', 'aria-expanded',
            'aria-haspopup', 'aria-live', 'aria-atomic',
            'aria-relevant', 'aria-busy', 'aria-dropeffect',
            'aria-grabbed', 'aria-keyshortcuts', 'aria-roledescription'
        ]
        
        for attr in aria_attrs:
            value = element.get(attr)
            if value is not None and value != '':
                aria[attr] = str(value)
                
        # Special handling for boolean ARIA attributes
        bool_aria_attrs = ['aria-required', 'aria-readonly', 'aria-disabled', 'aria-invalid', 'aria-busy']
        for attr in bool_aria_attrs:
            value = element.get(attr)
            if value is not None:
                # Convert common truthy/falsy values
                if isinstance(value, str):
                    aria[attr] = value.lower() in ['true', 'yes', '1']
                else:
                    aria[attr] = bool(value)
                    
        return aria
        
    def _extract_custom_validation(self, element: Dict[str, Any]) -> Dict[str, Any]:
        """Extract custom validation from data-* attributes."""
        custom = {}
        
        # Look for data-validation-* or similar patterns
        # This is framework-specific but common patterns exist
        for key, value in element.items():
            if isinstance(key, str) and key.startswith('data-'):
                # Custom validation attributes
                key_lower = key.lower()
                if 'validation' in key_lower or 'validate' in key_lower:
                    # Extract the validation rule name
                    # Remove data- prefix and validation-related terms
                    clean_key = key_lower
                    for prefix in ['data-validation-', 'data-validate-', 'data-val-']:
                        if key_lower.startswith(prefix):
                            clean_key = key[len(prefix):]
                            break
                    # If no prefix matched, try to extract after the first hyphen after data-
                    if clean_key == key_lower:
                        parts = key.split('-')
                        if len(parts) >= 3:  # data-*-*
                            # Take everything after the second part (data-)
                            clean_key = '-'.join(parts[2:])
                        else:
                            # Fallback: remove data- prefix
                            clean_key = key[5:]  # Remove 'data-'
                    
                    if clean_key:  # Only add if we got a meaningful key
                        custom[clean_key] = value
                    
        return custom
        
    def _safe_int(self, value) -> Optional[int]:
        """Safely convert value to int."""
        if value is None:
            return None
        try:
            return int(value)
        except (ValueError, TypeError):
            return None
            
    def _safe_float(self, value) -> Optional[float]:
        """Safely convert value to float."""
        if value is None:
            return None
        try:
            return float(value)
        except (ValueError, TypeError):
            return None


def extract_validation_attributes(form_data: Dict[str, Any]) -> Dict[str, Any]:
    """
    Convenience function to extract validation attributes.
    
    Args:
        form_data: Form data
        
    Returns:
        Form data with validation attributes
    """
    validator = FormValidator()
    return validator.extract_validation_attributes(form_data)


# Export the main function
__all__ = ['extract_validation_attributes', 'FormValidator']