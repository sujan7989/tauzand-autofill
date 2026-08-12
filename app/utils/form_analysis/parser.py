# Form Analysis Engine - Utility Module: Parser

import re
from bs4 import BeautifulSoup
from typing import Dict, List, Any, Optional
import logging

logger = logging.getLogger(__name__)


class FormParser:
    """Parses HTML forms and extracts form elements with their basic attributes."""
    
    def __init__(self, store_original_html: bool = False):
        self.store_original_html = store_original_html
        self.supported_input_types = {
            'text', 'password', 'email', 'number', 'tel', 'url', 'search',
            'date', 'datetime-local', 'month', 'week', 'time',
            'textarea', 'select', 'checkbox', 'radio', 'file', 'hidden',
            'submit', 'button', 'reset', 'image', 'color'
        }
        
    def parse_form(self, html_content: str) -> Dict[str, Any]:
        """
        Parse HTML content and extract form elements.
        
        Args:
            html_content: Raw HTML string
            
        Returns:
            Dictionary containing parsed form data
        """
        try:
            soup = BeautifulSoup(html_content, 'lxml')
            forms = soup.find_all('form')
            
            if not forms:
                # If no form tags found, treat the whole document as a form
                forms = [soup]
                
            result = {
                'forms': [],
                'total_forms': len(forms),
                'page_metadata': self._extract_page_metadata(soup)
            }
            
            for i, form in enumerate(forms):
                form_data = self._parse_single_form(form, i)
                result['forms'].append(form_data)

            # Also collect inputs NOT inside any form (React portals, orphan inputs)
            # This catches fields like portfolio/years_experience outside <form> tags
            all_inputs_in_forms = set()
            for form in forms:
                for el in form.find_all(['input', 'textarea', 'select']):
                    all_inputs_in_forms.add(id(el))

            orphan_elements = []
            for el in soup.find_all(['input', 'textarea', 'select']):
                if id(el) not in all_inputs_in_forms:
                    element_data = self._parse_element(el)
                    if element_data:
                        orphan_elements.append(element_data)

            if orphan_elements:
                result['forms'].append({
                    'form_index': len(forms),
                    'elements': orphan_elements,
                    'form_attributes': {'id': 'orphan_inputs', 'name': '', 'method': '', 'action': ''}
                })
                
            return result
            
        except Exception as e:
            logger.exception(f"Error parsing HTML form: {e}")
            raise
            
    def _parse_single_form(self, form_element, form_index: int) -> Dict[str, Any]:
        """Parse a single form element."""
        form_data = {
            'form_index': form_index,
            'elements': [],
            'form_attributes': self._extract_form_attributes(form_element)
        }
        
        # Find all form-associated elements
        elements = form_element.find_all([
            'input', 'textarea', 'select', 'button', 
            'fieldset', 'legend', 'datalist', 'output',
            'progress', 'meter', 'label'
        ])
        
        for element in elements:
            element_data = self._parse_element(element)
            if element_data:
                form_data['elements'].append(element_data)
                
        return form_data
        
    def _parse_element(self, element) -> Optional[Dict[str, Any]]:
        """Parse a single form element."""
        tag_name = element.name.lower()
        
        # Skip label elements here - they're handled by label resolver
        if tag_name == 'label':
            return None
            
        element_data = {
            'tag': tag_name,
            'tag_name': tag_name,
            'attributes': dict(element.attrs),
            'element_id': element.get('id', ''),
            'element_name': element.get('name', ''),
            # aria attributes — captured here so field_mapping_service can use them
            'aria-label': element.get('aria-label', ''),
            'aria-labelledby': element.get('aria-labelledby', ''),
            'autocomplete': element.get('autocomplete', ''),
            'element_type': self._get_element_type(element),
            'type': self._get_element_type(element),
        }

        # For elements with no name/id (e.g. Workday uses aria-label only),
        # derive a synthetic element_name from aria-label so field_mapping_service
        # can match and autoFill.js can locate the field.
        if not element_data['element_name'] and not element_data['element_id']:
            aria = element.get('aria-label', '').strip()
            if aria:
                # Convert "First Name" -> "first_name" as synthetic name
                element_data['element_name'] = aria.lower().replace(' ', '_').replace('-', '_')
                element_data['element_id'] = element_data['element_name']
        # Optionally store original HTML (useful for debugging, but increases memory usage)
        if self.store_original_html:
            element_data['original_html'] = str(element)[:1000]
        
        # Add type-specific data
        if tag_name == 'input':
            element_data.update(self._parse_input_element(element))
        elif tag_name == 'textarea':
            element_data.update(self._parse_textarea_element(element))
        elif tag_name == 'select':
            element_data.update(self._parse_select_element(element))
        elif tag_name in ['output', 'progress', 'meter']:
            element_data.update(self._parse_output_like_element(element))
        elif tag_name in ['fieldset']:
            element_data.update(self._parse_fieldset_element(element))
        elif tag_name in ['legend']:
            element_data.update(self._parse_legend_element(element))
        elif tag_name in ['datalist']:
            element_data.update(self._parse_datalist_element(element))
        elif tag_name in ['button']:
            element_data.update(self._parse_button_element(element))
            
        return element_data
        
    def _get_element_type(self, element) -> str:
        """Get the semantic type of an element."""
        tag_name = element.name.lower()
        if tag_name == 'input':
            return element.get('type', 'text').lower()
        return tag_name
        
    def _parse_input_element(self, element) -> Dict[str, Any]:
        """Parse input-specific attributes."""
        input_type = element.get('type', 'text').lower()
        data = {'input_type': input_type}
        
        # Handle special input types
        if input_type in ['checkbox', 'radio']:
            data['checked'] = element.has_attr('checked')
            data['value'] = element.get('value', 'on')
        elif input_type == 'file':
            data['accept'] = element.get('accept', '')
            data['multiple'] = element.has_attr('multiple')
            # capture attribute is non-standard but sometimes used
            data['capture'] = element.get('capture', '')
        elif input_type in ['range', 'number']:
            data['min'] = element.get('min')
            data['max'] = element.get('max')
            data['step'] = element.get('step')
        elif input_type in ['date', 'datetime-local', 'month', 'week', 'time']:
            data['min'] = element.get('min')
            data['max'] = element.get('max')
            data['step'] = element.get('step')
            
        # Common attributes
        data['placeholder'] = element.get('placeholder', '')
        data['required'] = element.has_attr('required')
        data['readonly'] = element.has_attr('readonly')
        data['disabled'] = element.has_attr('disabled')
        data['value'] = element.get('value', '')
        
        return data
        
    def _parse_textarea_element(self, element) -> Dict[str, Any]:
        """Parse textarea-specific attributes."""
        return {
            'placeholder': element.get('placeholder', ''),
            'required': element.has_attr('required'),
            'readonly': element.has_attr('readonly'),
            'disabled': element.has_attr('disabled'),
            'value': element.get_text(),  # Textarea value is its inner text
            'rows': element.get('rows'),
            'cols': element.get('cols'),
            'wrap': element.get('wrap')
        }
        
    def _parse_select_element(self, element) -> Dict[str, Any]:
        """Parse select-specific attributes."""
        options = []
        for option in element.find_all('option'):
            options.append({
                'value': option.get('value', ''),
                'text': option.get_text(strip=True),
                'selected': option.has_attr('selected'),
                'disabled': option.has_attr('disabled')
            })
            
        return {
            'multiple': element.has_attr('multiple'),
            'required': element.has_attr('required'),
            'disabled': element.has_attr('disabled'),
            'options': options,
            'size': element.get('size')
        }
        
    def _parse_output_like_element(self, element) -> Dict[str, Any]:
        """Parse output, progress, meter elements."""
        tag_name = element.name.lower()
        data = {
            'value': element.get('value', ''),
            'form': element.get('form', '')
        }
        
        if tag_name == 'progress':
            data['max'] = element.get('max')
        elif tag_name == 'meter':
            data['min'] = element.get('min')
            data['max'] = element.get('max')
            data['low'] = element.get('low')
            data['high'] = element.get('high')
            data['optimum'] = element.get('optimum')
            
        return data
        
    def _parse_fieldset_element(self, element) -> Dict[str, Any]:
        """Parse fieldset element."""
        return {
            'disabled': element.has_attr('disabled'),
            'name': element.get('name', '')
        }
        
    def _parse_legend_element(self, element) -> Dict[str, Any]:
        """Parse legend element."""
        return {
            'text': element.get_text(strip=True),
            'accesskey': element.get('accesskey', '')
        }
        
    def _parse_datalist_element(self, element) -> Dict[str, Any]:
        """Parse datalist element."""
        options = []
        for option in element.find_all('option'):
            options.append({
                'value': option.get('value', ''),
                'label': option.get('label', '')
            })
            
        return {
            'id': element.get('id', ''),
            'options': options
        }
        
    def _parse_button_element(self, element) -> Dict[str, Any]:
        """Parse button element."""
        button_type = element.get('type', 'button').lower()
        data = {
            'button_type': button_type,
            'value': element.get('value', ''),
            'text': element.get_text(strip=True)
        }
        
        if button_type in ['submit', 'reset']:
            data['form_action'] = element.get('formaction', '')
            data['form_enctype'] = element.get('formenctype', '')
            data['form_method'] = element.get('formmethod', '')
            data['form_target'] = element.get('formtarget', '')
            data['form_novalidate'] = element.has_attr('formnovalidate')
            
        return data
        
    def _extract_form_attributes(self, form_element) -> Dict[str, Any]:
        """Extract form-level attributes."""
        return {
            'id': form_element.get('id', ''),
            'name': form_element.get('name', ''),
            'method': form_element.get('method', 'get').lower(),
            'action': form_element.get('action', ''),
            'enctype': form_element.get('enctype', 'application/x-www-form-urlencoded'),
            'autocomplete': form_element.get('autocomplete', 'on'),
            'novalidate': form_element.has_attr('novalidate'),
            'target': form_element.get('target', ''),
            'accept_charset': form_element.get('accept-charset', '')
        }
        
    def _extract_page_metadata(self, soup: BeautifulSoup) -> Dict[str, Any]:
        """Extract metadata from the HTML page."""
        metadata = {}
        
        # Extract title
        title_tag = soup.find('title')
        if title_tag:
            metadata['title'] = title_tag.get_text(strip=True)
            
        # Extract charset from meta tag
        charset_meta = soup.find('meta', charset=True)
        if charset_meta:
            metadata['charset'] = charset_meta.get('charset')
        else:
            # Try http-equiv variant
            charset_meta = soup.find('meta', attrs={'http-equiv': 'Content-Type'})
            if charset_meta:
                content = charset_meta.get('content', '')
                # Extract charset from content like "text/html; charset=UTF-8"
                if 'charset=' in content:
                    charset = content.split('charset=')[1].split(';')[0].strip()
                    metadata['charset'] = charset
                    
        # Extract language from html tag
        html_tag = soup.find('html')
        if html_tag:
            lang = html_tag.get('lang')
            if lang:
                metadata['language'] = lang
                
        return metadata


def parse_html_form(html_content: str, store_original_html: bool = False) -> Dict[str, Any]:
    """
    Convenience function to parse HTML form.
    
    Args:
        html_content: Raw HTML string
        store_original_html: Whether to store the original HTML string for each element (for debugging)
        
    Returns:
        Parsed form data
    """
    parser = FormParser(store_original_html=store_original_html)
    return parser.parse_form(html_content)


# Export the main function
__all__ = ['parse_html_form', 'FormParser']