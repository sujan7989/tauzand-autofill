# Form Analysis Engine - Utility Module: Normalizer

import uuid
import hashlib
from typing import Dict, List, Any, Optional
from datetime import datetime
import logging

from .constants import ENGINE_VERSION, ENGINE_NAME

logger = logging.getLogger(__name__)


class FormNormalizer:
    """Normalizes form data and generates stable identifiers."""
    
    def __init__(self):
        self.element_signatures = {}  # Cache for consistent UUID generation
        
    def normalize_form_data(self, form_data: Dict[str, Any]) -> Dict[str, Any]:
        """
        Normalize form data by adding UUIDs, timestamps, and standardizing format.
        
        Args:
            form_data: Raw form data from parser and label resolver
            
        Returns:
            Normalized form data
        """
        # Create a copy to avoid modifying original
        normalized = self._deep_copy(form_data)
        
        # Add analysis metadata
        normalized['analysis_metadata'] = {
            'analysis_id': self._generate_analysis_id(form_data),
            'timestamp': datetime.utcnow().isoformat() + 'Z',
            'version': ENGINE_VERSION,
            'analyzer': ENGINE_NAME
        }
        
        # Normalize each form
        for form in normalized.get('forms', []):
            form['form_id'] = self._generate_form_id(form)
            form['normalized_at'] = datetime.utcnow().isoformat() + 'Z'
            
            # Normalize form-level attributes
            form = self._normalize_form_attributes(form)
            
            # Normalize each element
            for element in form.get('elements', []):
                element = self._normalize_element(element)
                
        return normalized
        
    def _generate_analysis_id(self, form_data: Dict[str, Any]) -> str:
        """Generate a unique ID for this analysis session."""
        # Use hash of form content + timestamp for consistency
        content_hash = self._hash_form_content(form_data)
        timestamp = datetime.utcnow().strftime('%Y%m%d%H%M%S')
        return f"fa_{content_hash[:8]}_{timestamp}"
        
    def _hash_form_content(self, form_data: Dict[str, Any]) -> str:
        """Create a hash of the form content for consistent IDs."""
        # Extract key identifying characteristics
        hash_parts = []
        
        for form in form_data.get('forms', []):
            # Hash form action/method/fields
            action = form.get('action', '')
            method = form.get('method', '')
            
            field_info = []
            for element in form.get('elements', []):
                name = element.get('name', '')
                etype = element.get('type', '')
                req = element.get('required', False)
                field_info.append(f"{name}:{etype}:{req}")
                
            field_info.sort()  # Consistent ordering
            hash_parts.append(f"{action}|{method}|{'|'.join(field_info)}")
            
        combined = '||'.join(hash_parts)
        # Use SHA-256 instead of MD5 for better security
        return hashlib.sha256(combined.encode()).hexdigest()[:8]
        
    def _generate_form_id(self, form: Dict[str, Any]) -> str:
        """Generate a stable ID for a form."""
        form_key = f"{form.get('action', '')}|{form.get('method', '')}"
        
        if form_key in self.element_signatures:
            return self.element_signatures[form_key]
            
        # Generate UUID based on form characteristics
        namespace = uuid.NAMESPACE_DNS
        form_string = f"{form.get('action', '')}{form.get('method', '')}"
        
        # Add field signatures for uniqueness
        field_signatures = []
        for element in form.get('elements', []):
            sig = f"{element.get('name', '')}{element.get('type', '')}{element.get('required', False)}"
            field_signatures.append(sig)
        field_signatures.sort()
        
        form_string += '|'.join(field_signatures)
        form_id = str(uuid.uuid5(namespace, form_string))
        
        # Cache for consistency
        self.element_signatures[form_key] = form_id
        return form_id
        
    def _normalize_form_attributes(self, form: Dict[str, Any]) -> Dict[str, Any]:
        """Normalize form-level attributes."""
        # Ensure standard values
        form['method'] = form.get('method', 'get').lower()
        form['enctype'] = form.get('enctype', 'application/x-www-form-urlencoded')
        form['autocomplete'] = form.get('autocomplete', 'on')
        form['novalidate'] = bool(form.get('novalidate', False))
        
        # Normalize action URL (relative vs absolute handling would be done elsewhere)
        form['action'] = form.get('action', '')
        
        return form
        
    def _normalize_element(self, element: Dict[str, Any]) -> Dict[str, Any]:
        """Normalize a single form element."""
        # Generate stable element ID
        element['element_uuid'] = self._generate_element_id(element)
        
        # Normalize common attributes
        element = self._normalize_common_attributes(element)
        
        # Normalize based on element type
        element_type = element.get('type', '').lower()
        tag_name = element.get('tag_name', '').lower()
        
        if tag_name == 'input' or element_type:
            element = self._normalize_input_element(element)
        elif tag_name == 'select':
            element = self._normalize_select_element(element)
        elif tag_name == 'textarea':
            element = self._normalize_textarea_element(element)
        elif tag_name == 'button':
            element = self._normalize_button_element(element)
        elif tag_name in ['output', 'progress', 'meter']:
            element = self._normalize_output_element(element)
        elif tag_name in ['fieldset', 'legend']:
            element = self._normalize_grouping_element(element)
            
        return element
        
    def _generate_element_id(self, element: Dict[str, Any]) -> str:
        """Generate a stable UUID for an element based on its characteristics."""
        # Create a deterministic string from element properties
        id_parts = [
            element.get('form_id', ''),
            element.get('tag_name', ''),
            element.get('type', ''),
            element.get('name', ''),
            element.get('element_id', ''),  # The original HTML id attribute
            str(element.get('element_index', 0))  # Position in form
        ]
        
        # Filter out empty parts and join
        id_string = '|'.join([part for part in id_parts if part])
        
        if not id_string:
            # Fallback to random UUID if we have no identifying information
            return str(uuid.uuid4())
            
        # Use UUID5 (namespace-based) for deterministic generation
        namespace = uuid.NAMESPACE_URL
        return str(uuid.uuid5(namespace, id_string))
        
    def _normalize_common_attributes(self, element: Dict[str, Any]) -> Dict[str, Any]:
        """Normalize attributes common to many element types."""
        # Boolean attributes
        bool_attrs = ['required', 'readonly', 'disabled', 'multiple', 'autofocus']
        for attr in bool_attrs:
            if attr in element:
                element[attr] = bool(element[attr])
                
        # Numeric attributes
        numeric_attrs = ['min', 'max', 'step', 'minlength', 'maxlength', 'size', 'cols', 'rows']
        for attr in numeric_attrs:
            if attr in element:
                try:
                    # Try to convert to appropriate numeric type
                    value = element[attr]
                    if '.' in str(value):
                        element[attr] = float(value)
                    else:
                        element[attr] = int(value)
                except (ValueError, TypeError):
                    # Keep as string if conversion fails
                    pass
                    
        # String attributes - ensure they're strings
        string_attrs = ['name', 'id', 'type', 'value', 'placeholder', 'accept', 
                       'autocomplete', 'dirname', 'form', 'formaction',
                       'formenctype', 'formmethod', 'formtarget', 'height', 'width']
        for attr in string_attrs:
            if attr in element:
                element[attr] = str(element[attr]) if element[attr] is not None else ''
                
        return element
        
    def _normalize_input_element(self, element: Dict[str, Any]) -> Dict[str, Any]:
        """Normalize input-specific attributes."""
        input_type = element.get('type', 'text').lower()
        element['type'] = input_type
        
        # Type-specific normalizations
        if input_type in ['checkbox', 'radio']:
            # Ensure value is string
            if 'value' in element:
                element['value'] = str(element['value'])
                
        elif input_type in ['number', 'range']:
            # Ensure numeric attributes are numbers
            for attr in ['min', 'max', 'step']:
                if attr in element:
                    try:
                        element[attr] = float(element[attr])
                    except (ValueError, TypeError):
                        pass
                        
        elif input_type in ['date', 'datetime-local', 'month', 'week', 'time']:
            # Date/time types - value should be string in correct format
            if 'value' in element:
                element['value'] = str(element['value'])
                
        elif input_type == 'email':
            # Email type - value should be string
            if 'value' in element:
                element['value'] = str(element['value'])
                
        elif input_type == 'url':
            # URL type - value should be string
            if 'value' in element:
                element['value'] = str(element['value'])
                
        elif input_type == 'tel':
            # Telephone type - value should be string
            if 'value' in element:
                element['value'] = str(element['value'])
                
        elif input_type == 'color':
            # Color type - should be hex color
            if 'value' in element:
                element['value'] = str(element['value']).lower()
                
        elif input_type == 'file':
            # File type - handle accept, multiple, capture
            if 'accept' in element:
                # Normalize accept attribute (comma-separated MIME types)
                accept = element['accept']
                if isinstance(accept, str):
                    # Split by comma and clean up
                    if ',' in accept:
                        element['accept'] = [mime.strip() for mime in accept.split(',') if mime.strip()]
                    else:
                        element['accept'] = [accept.strip()] if accept.strip() else []
                elif isinstance(accept, list):
                    # Already a list
                    element['accept'] = [str(mime).strip() for mime in accept]
                    
            element['multiple'] = bool(element.get('multiple', False))
            
            # Handle capture attribute
            capture = element.get('capture')
            if capture is not None:
                if isinstance(capture, bool):
                    element['capture'] = capture
                elif isinstance(capture, str):
                    # Can be "user", "environment", or just True
                    element['capture'] = bool(capture) and capture.lower() not in ['false', '0', '']
                else:
                    element['capture'] = bool(capture)
                    
        return element
        
    def _normalize_select_element(self, element: Dict[str, Any]) -> Dict[str, Any]:
        """Normalize select-specific attributes."""
        # Normalize options
        if 'options' in element:
            normalized_options = []
            for option in element['options']:
                if isinstance(option, dict):
                    normalized_option = {
                        'value': str(option.get('value', '')),
                        'label': str(option.get('label', option.get('value', ''))),
                        'selected': bool(option.get('selected', False)),
                        'disabled': bool(option.get('disabled', False))
                    }
                    if 'disabled' not in option:  # Only add if not already present
                        pass  # Already handled above
                    elif 'disabled' in option:
                        normalized_option['disabled'] = bool(option['disabled'])
                    else:
                        # This shouldn't happen, but just in case
                        pass
                    normalized_options.append(normalized_option)
                else:
                    # Handle simple string options
                    normalized_options.append({
                        'value': str(option),
                        'label': str(option),
                        'selected': False,
                        'disabled': False
                    })
            element['options'] = normalized_options
            
        # Ensure multiple is boolean
        element['multiple'] = bool(element.get('multiple', False))
        
        return element
        
    def _normalize_textarea_element(self, element: Dict[str, Any]) -> Dict[str, Any]:
        """Normalize textarea-specific attributes."""
        # Ensure cols and rows are integers if present
        for attr in ['cols', 'rows']:
            if attr in element:
                try:
                    element[attr] = int(element[attr])
                except (ValueError, TypeError):
                    # Keep original if conversion fails
                    pass
                    
        # Wrap attribute validation
        wrap = element.get('wrap', '').lower()
        if wrap not in ['soft', 'hard', 'off']:
            element['wrap'] = 'soft'  # Default
            
        return element
        
    def _normalize_button_element(self, element: Dict[str, Any]) -> Dict[str, Any]:
        """Normalize button-specific attributes."""
        button_type = element.get('type', 'button').lower()
        element['type'] = button_type
        
        # Form override attributes
        if 'formaction' in element:
            element['formaction'] = str(element['formaction'])
        if 'formenctype' in element:
            element['formenctype'] = str(element['formenctype']).lower()
        if 'formmethod' in element:
            element['formmethod'] = str(element['formmethod']).lower()
        if 'formtarget' in element:
            element['formtarget'] = str(element['formtarget'])
        if 'formnovalidate' in element:
            element['formnovalidate'] = bool(element['formnovalidate'])
            
        return element
        
    def _normalize_output_element(self, element: Dict[str, Any]) -> Dict[str, Any]:
        """Normalize output/progress/meter elements."""
        # These elements don't typically have user input but have values
        
        tag_name = element.get('tag_name', '').lower()
        
        if tag_name == 'progress':
            # Progress element: value, max
            for attr in ['value', 'max']:
                if attr in element:
                    try:
                        element[attr] = float(element[attr])
                    except (ValueError, TypeError):
                        pass
                        
        elif tag_name == 'meter':
            # Meter element: value, min, max, low, high, optimum
            for attr in ['value', 'min', 'max', 'low', 'high', 'optimum']:
                if attr in element:
                    try:
                        element[attr] = float(element[attr])
                    except (ValueError, TypeError):
                        pass
                        
        elif tag_name == 'output':
            # Output element: for, name
            for attr in ['for', 'name']:
                if attr in element:
                    element[attr] = str(element[attr])
                    
        return element
        
    def _normalize_grouping_element(self, element: Dict[str, Any]) -> Dict[str, Any]:
        """Normalize fieldset/legend elements."""
        tag_name = element.get('tag_name', '').lower()
        
        if tag_name == 'fieldset':
            element['disabled'] = bool(element.get('disabled', False))
            
        elif tag_name == 'legend':
            # Ensure text is string
            if 'text' in element:
                element['text'] = str(element['text'])
                
        return element
        
    def _deep_copy(self, obj: Any) -> Any:
        """Create a deep copy of an object."""
        import copy
        return copy.deepcopy(obj)


def normalize_form_data(form_data: Dict[str, Any]) -> Dict[str, Any]:
    """
    Convenience function to normalize form data.
    
    Args:
        form_data: Raw form data
        
    Returns:
        Normalized form data
    """
    normalizer = FormNormalizer()
    return normalizer.normalize_form_data(form_data)


# Export the main function
__all__ = ['normalize_form_data', 'FormNormalizer']