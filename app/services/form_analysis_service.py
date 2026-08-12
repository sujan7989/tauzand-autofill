# Form Analysis Engine - Service Module

import logging
from typing import Dict, Any, Optional, List
from datetime import datetime
from bs4 import BeautifulSoup
from flask import current_app

from ..utils.form_analysis.parser import parse_html_form
from ..utils.form_analysis.label_resolver import resolve_labels
from ..utils.form_analysis.normalizer import normalize_form_data
from ..utils.form_analysis.validator import extract_validation_attributes
from ..utils.form_analysis.constants import ENGINE_VERSION, ENGINE_NAME
from ..services.field_mapping_service import FieldMappingService

logger = logging.getLogger(__name__)


class FormAnalysisService:
    """Main service for form analysis operations."""
    
    def __init__(self):
        self.logger = logging.getLogger(__name__ + '.FormAnalysisService')
        self.field_mapping_service = FieldMappingService()
        
    def analyze_form(self, html_content: str, source_url: Optional[str] = None, 
                    metadata: Optional[Dict[str, Any]] = None, 
                    resume_data: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        """
        Analyze an HTML form and return structured metadata.
        
        This is the main entry point for form analysis.
        
        Args:
            html_content: HTML string containing form(s) to analyze
            source_url: Optional URL where the HTML was obtained from
            metadata: Additional metadata to include in the result
            resume_data: Optional resume/profile data for field mapping
            
        Returns:
            Dictionary containing the complete form analysis results
            
        Raises:
            ValueError: If HTML content is invalid or empty
            Exception: For parsing or processing errors
        """
        self.logger.info("Starting form analysis")
        
        # Input validation
        if not html_content or not isinstance(html_content, str):
            raise ValueError("HTML content must be a non-empty string")
            
        if len(html_content.strip()) == 0:
            raise ValueError("HTML content is empty")
            
        # Limit input size to prevent DoS attacks
        if len(html_content) > 5 * 1024 * 1024:  # 5MB limit
            raise ValueError("HTML content too large (max 5MB)")
        
        try:
            # Step 1: Parse HTML to extract basic form structure
            self.logger.debug("Step 1: Parsing HTML structure")
            store_original_html = current_app.config.get('STORE_ORIGINAL_HTML', False)
            parsed_data = parse_html_form(html_content, store_original_html=store_original_html)
            
            # Step 2: Resolve labels and associate with form elements
            self.logger.debug("Step 2: Resolving labels")
            soup = BeautifulSoup(html_content, 'lxml')
            labeled_data = resolve_labels(parsed_data, soup)
            
            # Step 3: Extract validation attributes
            self.logger.debug("Step 3: Extracting validation attributes")
            validated_data = extract_validation_attributes(labeled_data)
            
            # Step 4: Normalize data (UUIDs, timestamps, etc.)
            self.logger.debug("Step 4: Normalizing data")
            normalized_data = normalize_form_data(validated_data)
            
            # Step 5: Add analysis metadata and page metadata
            self.logger.debug("Step 5: Adding metadata")
            final_result = self._add_analysis_metadata(
                normalized_data, 
                source_url=source_url,
                additional_metadata=metadata,
                html_length=len(html_content)
            )
            
            # Step 6: Perform field mapping if resume data is provided
            if resume_data:
                self.logger.debug("Step 6: Performing field mapping")
                mapping_result = self.field_mapping_service.map_form_to_profile(final_result, resume_data)

                # Enrich each mapping with a 'selector' field that autoFill.js can use
                # to locate the DOM element. form_field_name is the actual input name attr.
                raw_mappings = mapping_result.get('mappings', [])
                for m in raw_mappings:
                    # selector = the DOM element's name or id — gives autoFill.js best chance
                    m.setdefault('selector', m.get('form_field_name') or m.get('form_field_id') or '')
                    # Ensure form_field_id is present (used as fieldId in autoFill.js)
                    m.setdefault('form_field_id', m.get('selector') or m.get('form_field_name') or '')

                # Add mapping results to final response
                final_result['mappings'] = raw_mappings
                final_result['mapping_statistics'] = mapping_result.get('mapping_statistics', {})
                final_result['unmapped_form_fields'] = mapping_result.get('unmapped_form_fields', [])
                final_result['unmapped_profile_fields'] = mapping_result.get('unmapped_profile_fields', [])
                
                # Calculate overall confidence
                if final_result['mappings']:
                    avg_confidence = sum(m.get('confidence_score', 0) for m in final_result['mappings']) / len(final_result['mappings'])
                    final_result['confidence'] = round(avg_confidence, 2)
                else:
                    final_result['confidence'] = 0.0
            else:
                # No resume data, set empty mapping results
                final_result['mappings'] = []
                final_result['mapping_statistics'] = {}
                final_result['unmapped_form_fields'] = []
                final_result['unmapped_profile_fields'] = []
                final_result['confidence'] = 0.0
            
            self.logger.info(f"Form analysis completed successfully. Found {final_result.get('total_forms', 0)} forms, {len(final_result.get('mappings', []))} field mappings.")
            return final_result
            
        except Exception as e:
            self.logger.exception(f"Error during form analysis: {e}")
            raise
            
    def _add_analysis_metadata(self, form_data: Dict[str, Any],
                              source_url: Optional[str] = None,
                              additional_metadata: Optional[Dict[str, Any]] = None,
                              html_length: int = 0) -> Dict[str, Any]:
        """Add metadata about the analysis process."""
        # Initialize metadata if not present
        if 'metadata' not in form_data:
            form_data['metadata'] = {}

        # Add analysis-specific metadata
        form_data['metadata'].update({
            'analysis_timestamp': datetime.utcnow().isoformat() + 'Z',
            'analyzer_version': ENGINE_VERSION,
            'analyzer_name': ENGINE_NAME,
            'source_url': source_url,
            'html_length': html_length,
            'total_forms': len(form_data.get('forms', [])),
            'total_elements': sum(
                len(form.get('elements', []))
                for form in form_data.get('forms', [])
            )
        })
        
        # Add any additional metadata provided
        if additional_metadata:
            form_data['metadata'].update(additional_metadata)
            
        # Calculate form statistics
        form_data['statistics'] = self._calculate_form_statistics(form_data)
        
        return form_data
        
    def _calculate_form_statistics(self, form_data: Dict[str, Any]) -> Dict[str, Any]:
        """Calculate statistics about the analyzed forms."""
        stats = {
            'forms': 0,
            'total_elements': 0,
            'input_elements': 0,
            'select_elements': 0,
            'textarea_elements': 0,
            'button_elements': 0,
            'required_fields': 0,
            'optional_fields': 0,
            'field_types': {},
            'elements_with_labels': 0,
            'elements_with_placeholders': 0,
            'elements_with_validation': 0
        }
        
        for form in form_data.get('forms', []):
            stats['forms'] += 1
            form_elements = form.get('elements', [])
            stats['total_elements'] += len(form_elements)
            
            for element in form_elements:
                tag_name = element.get('tag_name', '').lower()
                element_type = element.get('type', '').lower()
                
                # Count by type
                is_input_like = tag_name == 'input' or bool(element_type)
                if is_input_like:
                    stats['input_elements'] += 1
                    field_type = element_type if element_type else 'text'
                elif tag_name == 'select':
                    stats['select_elements'] += 1
                    field_type = 'select'
                elif tag_name == 'textarea':
                    stats['textarea_elements'] += 1
                    field_type = 'textarea'
                elif tag_name == 'button':
                    stats['button_elements'] += 1
                    field_type = 'button'
                else:
                    field_type = tag_name
                    
                # Update field type counts
                stats['field_types'][field_type] = stats['field_types'].get(field_type, 0) + 1
                
                # Count required vs optional fields (excluding buttons, etc.)
                if tag_name in ['input', 'select', 'textarea']:
                    if element.get('required', False):
                        stats['required_fields'] += 1
                    else:
                        stats['optional_fields'] += 1
                        
                    # Count elements with labels
                    if element.get('label') or element.get('aria-label') or element.get('aria-labelledby'):
                        stats['elements_with_labels'] += 1
                        
                    # Count elements with placeholders
                    if element.get('placeholder'):
                        stats['elements_with_placeholders'] += 1
                        
                    # Count elements with validation
                    if element.get('validation'):
                        # Check if any validation constraints are present
                        validation = element.get('validation', {})
                        has_validation = False
                        # Check standard constraints
                        for attr in ['required', 'readonly', 'disabled', 'pattern', 'min', 'max', 'step', 'minlength', 'maxlength']:
                            if attr in validation and validation[attr] not in [False, None, '']:
                                has_validation = True
                                break
                        # Check type-specific validation
                        if not has_validation and validation.get('type_specific_validation', False):
                            has_validation = True
                        # Check file validation
                        if not has_validation and validation.get('accept_mime_types'):
                            has_validation = True
                        if not has_validation and validation.get('accept_extensions'):
                            has_validation = True
                        if not has_validation and validation.get('multiple') is not None:
                            has_validation = True
                            
                        if has_validation:
                            stats['elements_with_validation'] += 1
                        
        # Calculate percentages
        total_input_like = stats['input_elements'] + stats['select_elements'] + stats['textarea_elements']
        if total_input_like > 0:
            stats['label_coverage_percentage'] = round(
                (stats['elements_with_labels'] / total_input_like) * 100, 2
            )
            stats['placeholder_coverage_percentage'] = round(
                (stats['elements_with_placeholders'] / total_input_like) * 100, 2
            )
            stats['validation_coverage_percentage'] = round(
                (stats['elements_with_validation'] / total_input_like) * 100, 2
            )
        else:
            stats['label_coverage_percentage'] = 0
            stats['placeholder_coverage_percentage'] = 0
            stats['validation_coverage_percentage'] = 0
            
        return stats
        
    def get_supported_element_types(self) -> List[str]:
        """Return list of supported form element types."""
        return [
            'input', 'textarea', 'select', 'button',
            'fieldset', 'legend', 'datalist', 'output',
            'progress', 'meter', 'label'
        ]
        
    def get_supported_input_types(self) -> List[str]:
        """Return list of supported input types."""
        return [
            'text', 'password', 'email', 'number', 'tel', 'url', 'search',
            'date', 'datetime-local', 'month', 'week', 'time',
            'checkbox', 'radio', 'file', 'hidden',
            'submit', 'button', 'reset', 'image', 'color'
        ]


def analyze_form(html_content: str, source_url: Optional[str] = None,
                metadata: Optional[Dict[str, Any]] = None,
                resume_data: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    """
    Convenience function for form analysis.

    Args:
        html_content: HTML string to analyze
        source_url: Optional source URL
        metadata: Additional metadata
        resume_data: Optional resume/profile data for field mapping

    Returns:
        Form analysis results
    """
    service = FormAnalysisService()
    return service.analyze_form(html_content, source_url, metadata, resume_data)


# Export the main components
__all__ = [
    'FormAnalysisService',
    'analyze_form'
]