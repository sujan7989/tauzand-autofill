# Form Analysis Engine - Utility Module: Label Resolver

from bs4 import BeautifulSoup, Tag
from typing import Dict, List, Any, Optional
import logging

logger = logging.getLogger(__name__)


class LabelResolver:
    """Resolves label associations for form elements."""
    
    def __init__(self):
        self.label_cache = {}  # Cache label lookups by element ID
        
    def resolve_labels(self, form_data: Dict[str, Any], soup: BeautifulSoup) -> Dict[str, Any]:
        """
        Resolve labels for all form elements.
        
        Args:
            form_data: Parsed form data from parser
            soup: BeautifulSoup object of the document
            
        Returns:
            Form data with label information added
        """
        # Build label map: element_id -> label_info
        label_map = self._build_label_map(soup)
        
        for form in form_data.get('forms', []):
            for element in form.get('elements', []):
                element_id = element.get('element_id', '')
                element_name = element.get('element_name', '')
                
                # Find label for this element
                label_info = self._find_label_for_element(
                    element_id, element_name, element, label_map, soup
                )
                
                if label_info:
                    element['label'] = label_info
                    
        return form_data
        
    def _build_label_map(self, soup: BeautifulSoup) -> Dict[str, List[Dict[str, Any]]]:
        """Build a mapping of element IDs to their label information."""
        label_map = {}
        
        # Find all label elements
        labels = soup.find_all('label')
        
        for label in labels:
            # Method 1: Using 'for' attribute
            for_attr = label.get('for', '')
            if for_attr:
                label_info = self._extract_label_info(label)
                if for_attr not in label_map:
                    label_map[for_attr] = []
                label_map[for_attr].append(label_info)
                
            # Method 2: Wrapping the element (implicit label)
            # Find form-associated elements inside this label
            wrapped_elements = label.find_all([
                'input', 'textarea', 'select', 'button',
                'output', 'progress', 'meter'
            ])
            
            for element in wrapped_elements:
                element_id = element.get('id', '')
                element_name = element.get('name', '')
                
                label_info = self._extract_label_info(label)
                
                # Add to both ID and name maps if available
                if element_id and element_id not in label_map:
                    label_map[element_id] = []
                if element_id:
                    label_map[element_id].append(label_info)
                    
                if element_name and element_name not in label_map:
                    label_map[element_name] = []
                if element_name:
                    label_map[element_name].append(label_info)
                    
        return label_map
        
    def _extract_label_info(self, label_element: Tag) -> Dict[str, Any]:
        """Extract information from a label element."""
        return {
            'text': label_element.get_text(strip=True),
            'html': str(label_element)[:200],  # Truncate for safety
            'for_attribute': label_element.get('for', ''),
            'accesskey': label_element.get('accesskey', ''),
            'element_id': label_element.get('id', ''),
            'confidence': 'high'  # Explicit label association
        }
        
    def _find_label_for_element(self, element_id: str, element_name: str, 
                              element_dict: Dict[str, Any], label_map: Dict[str, List[Dict]], 
                              soup: BeautifulSoup) -> Optional[Dict[str, Any]]:
        """Find the best label for a given element."""
        candidates = []
        
        # Check ID-based matches first (highest confidence)
        if element_id and element_id in label_map:
            for label_info in label_map[element_id]:
                label_info_copy = label_info.copy()
                label_info_copy['method'] = 'id_match'
                label_info_copy['confidence'] = 'high'
                candidates.append(label_info_copy)
                
        # Check name-based matches
        if element_name and element_name in label_map:
            for label_info in label_map[element_name]:
                label_info_copy = label_info.copy()
                label_info_copy['method'] = 'name_match'
                label_info_copy['confidence'] = 'medium'
                candidates.append(label_info_copy)
                
        # If no explicit labels found, try proximity/implicit methods
        if not candidates:
            # Find the actual element in the soup to check ARIA attributes, etc.
            actual_element = None
            if element_id:
                actual_element = soup.find(id=element_id)
            if not actual_element and element_name:
                # Try to find by name (might return multiple, take first)
                actual_element = soup.find(name=element_dict.get('tag', ''), attrs={'name': element_name})
            
            if actual_element and isinstance(actual_element, Tag):
                # Look for aria-label or aria-labelledby
                aria_label = actual_element.get('aria-label', '').strip()
                if aria_label:
                    return {
                        'text': aria_label,
                        'method': 'aria_label',
                        'confidence': 'high',
                        'source': 'aria-label'
                    }
                    
                aria_labelledby = actual_element.get('aria-labelledby', '').strip()
                if aria_labelledby:
                    # Find the element(s) with this ID and get their text
                    labelled_elements = soup.find_all(id=aria_labelledby)
                    if labelled_elements:
                        text = ' '.join([el.get_text(strip=True) for el in labelled_elements])
                        return {
                            'text': text,
                            'method': 'aria-labelledby',
                            'confidence': 'high',
                            'source': 'aria-labelledby'
                        }
                        
                # Check for placeholder as fallback label
                placeholder = actual_element.get('placeholder', '').strip()
                if placeholder:
                    return {
                        'text': placeholder,
                        'method': 'placeholder',
                        'confidence': 'low',
                        'source': 'placeholder'
                    }
                    
                # Check if element is wrapped in a label (implicit label)
                parent = actual_element.parent
                while parent and parent.name != 'form' and parent.name != 'body' and parent.name != '[document]':
                    if parent.name == 'label':
                        label_info = self._extract_label_info(parent)
                        label_info['method'] = 'wrapped'
                        label_info['confidence'] = 'medium'
                        return label_info
                    parent = parent.parent
                
        # Return the best candidate if we found any
        if candidates:
            # Sort by confidence: high > medium > low
            confidence_order = {'high': 3, 'medium': 2, 'low': 1}
            candidates.sort(key=lambda x: confidence_order.get(x['confidence'], 0), reverse=True)
            return candidates[0]
            
        return None


def resolve_labels(form_data: Dict[str, Any], soup: BeautifulSoup) -> Dict[str, Any]:
    """
    Convenience function to resolve labels for form data.
    
    Args:
        form_data: Parsed form data
        soup: BeautifulSoup object
        
    Returns:
        Form data with label information
    """
    resolver = LabelResolver()
    return resolver.resolve_labels(form_data, soup)


# Export the main function
__all__ = ['resolve_labels', 'LabelResolver']