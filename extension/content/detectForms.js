// Content Script: Form Detection
// Detects forms on the page and form elements
// Guard against double-injection (background re-injects on SPA navigation)
if (typeof window.__detectFormsLoaded !== 'undefined') {
    // Already loaded " just re-register the message listener if needed
    console.log('[detectForms] Already loaded, skipping re-initialization');
} else {
window.__detectFormsLoaded = true;
console.log('[Content] detectForms.js loaded');

// Form detection logic
const FORM_SELECTORS = {
    form: 'form',
    input: 'input, textarea, select',
    button: 'button, input[type="submit"], input[type="button"]',
    fieldset: 'fieldset'
};

// Create a stable ID for a form element. Avoid Date.now()/Math.random "
// we want the same element to map to the same id across re-scans.
function generateElementId(element) {
    const form = element.closest('form');
    if (!form) return null;

    const formIndex = Array.from(document.forms).indexOf(form);
    const formId = form.id || form.name || `form_index_${formIndex}`;

    // Find this element's index within the form for stability
    const siblings = Array.from(form.querySelectorAll(FORM_SELECTORS.input));
    const elementIndex = siblings.indexOf(element);
    const elementName = element.name || element.id || `${element.tagName.toLowerCase()}_${elementIndex}`;

    return `${formId}_${elementName}`;
}

// Deep shadow DOM input collector " same logic as autoFill.js collectAllInputs
function collectShadowInputs(root) {
    var results = [];
    if (!root) return results;
    try {
        var standard = Array.from(root.querySelectorAll(
            'input:not([type=hidden]):not([type=submit]):not([type=button]):not([type=reset]),' +
            'textarea, select'
        )).filter(function(el) { return !el.disabled; });
        results = results.concat(standard);
    } catch(e) {}
    try {
        var all = root.querySelectorAll('*');
        for (var i = 0; i < all.length; i++) {
            if (all[i].shadowRoot) {
                results = results.concat(collectShadowInputs(all[i].shadowRoot));
            }
        }
    } catch(e) {}
    return results;
}

// Detect if element is fillable (not hidden, disabled, or read-only)
function isFillableElement(element) {
    if (!element) return false;
    if (element.disabled) return false;
    if (element.type === 'hidden') return false;
    // Allow submit/button type to be detected (we skip them at extraction time)
    if (element.getAttribute && element.getAttribute('aria-hidden') === 'true') return false;
    try {
        const style = window.getComputedStyle(element);
        if (style.display === 'none' || style.visibility === 'hidden') return false;
    } catch(e) { /* Shadow DOM " allow through */ }
    return true;
}

// Extract full info from a single element " shared by form and orphan paths
function extractElementInfo(element, stableElementId, index) {
    var type = (element.type || element.tagName.toLowerCase() || 'text').toLowerCase();
    var tagName = element.tagName.toLowerCase();

    // Collect radio/select options so backend knows valid values
    var options = [];
    if (tagName === 'select') {
        options = Array.from(element.options).map(function(o) {
            return { value: o.value, text: o.text.trim() };
        });
    } else if (type === 'radio' || type === 'checkbox') {
        // Collect all radio buttons in the same group
        var groupName = element.name;
        if (groupName) {
            var group = document.querySelectorAll('input[name="' + CSS.escape(groupName) + '"]');
            options = Array.from(group).map(function(r) {
                return { value: r.value, text: getLabelText(r) || r.value };
            });
        } else {
            options = [{ value: element.value, text: getLabelText(element) || element.value }];
        }
    }

    // Detect yes/no question pattern
    var labelText = getLabelText(element);
    var isYesNo = (type === 'radio' || type === 'select-one') &&
        options.length >= 2 &&
        options.some(function(o) { return /\byes\b/i.test(o.text) || /\byes\b/i.test(o.value); }) &&
        options.some(function(o) { return /\bno\b/i.test(o.text) || /\bno\b/i.test(o.value); });

    return {
        id:             stableElementId,
        element_id:     stableElementId,
        name:           element.name || '',
        type:           type,
        tagName:        tagName,
        value:          element.value || '',
        placeholder:    element.placeholder || '',
        required:       element.required || false,
        autocomplete:   element.autocomplete || '',
        'aria-label':   element.getAttribute('aria-label') || '',
        'aria-labelledby': element.getAttribute('aria-labelledby') || '',
        label:          labelText,
        options:        options,
        is_yes_no:      isYesNo,
        position:       getElementPosition(element)
    };
}

// Extract form data and metadata
function extractFormData(form) {
    if (!form || !(form instanceof HTMLFormElement)) return null;

    const allForms = Array.from(document.forms);
    const formIndex = allForms.indexOf(form);
    const stableFormId = form.id || form.name || `form_index_${formIndex}`;

    const formData = {
        id: stableFormId,
        action: form.action || '',
        method: form.method || '',
        elements: [],
        fieldCount: 0,
        fillableCount: 0
    };

    // Include ALL input types including radio and checkbox
    const elements = form.querySelectorAll('input, textarea, select');

    elements.forEach((element, index) => {
        if (!isFillableElement(element)) return;

        const stableElementId = element.id
            || element.name
            || `${element.tagName.toLowerCase()}_${index}`;

        const elementInfo = extractElementInfo(element, stableElementId, index);
        formData.elements.push(elementInfo);
        formData.fieldCount++;
        if (element.value !== '') formData.fillableCount++;
    });

    return formData;
}

// Get element position for highlighting
function getElementPosition(element) {
    const rect = element.getBoundingClientRect();
    return {
        top: rect.top + window.scrollY,
        left: rect.left + window.scrollX,
        width: rect.width,
        height: rect.height
    };
}

// Resolve the human-readable label text for a form element.
// Tries: aria-label ' aria-labelledby ' <label for="id"> ' wrapping <label> ' placeholder
function getLabelText(element) {
    // 1. aria-label (Workday, LinkedIn custom components)
    const ariaLabel = element.getAttribute('aria-label');
    if (ariaLabel && ariaLabel.trim()) return ariaLabel.trim();

    // 2. aria-labelledby ' resolve referenced element's text
    const labelledBy = element.getAttribute('aria-labelledby');
    if (labelledBy) {
        const text = labelledBy.split(/\s+/)
            .map(id => document.getElementById(id))
            .filter(Boolean)
            .map(el => el.textContent.trim())
            .join(' ').trim();
        if (text) return text;
    }

    // 3. <label for="id">
    if (element.id) {
        const labelEl = document.querySelector(`label[for="${CSS.escape(element.id)}"]`);
        if (labelEl) {
            // Strip nested input text (checkbox labels often have extra children)
            const clone = labelEl.cloneNode(true);
            clone.querySelectorAll('input, select, textarea').forEach(n => n.remove());
            const t = clone.textContent.trim().replace(/\s+/g, ' ');
            if (t) return t;
        }
    }

    // 4. Closest wrapping <label>
    const wrappingLabel = element.closest('label');
    if (wrappingLabel) {
        const clone = wrappingLabel.cloneNode(true);
        clone.querySelectorAll('input, select, textarea').forEach(n => n.remove());
        const t = clone.textContent.trim().replace(/\s+/g, ' ');
        if (t) return t;
    }

    // 5. Preceding sibling or parent text node (Taleo / legacy ATS)
    const parent = element.parentElement;
    if (parent) {
        for (const node of parent.childNodes) {
            if (node.nodeType === Node.TEXT_NODE) {
                const t = node.textContent.trim();
                if (t) return t;
            }
            if (node === element) break;
        }
    }

    // 6. Fallback: placeholder
    if (element.placeholder) return element.placeholder.trim();

    return '';
}

// Main form detection function
function detectForms() {
    console.log('[detectForms] ===== Starting form detection =====');
    const forms = document.querySelectorAll(FORM_SELECTORS.form);
    console.log('[detectForms] Found', forms.length, 'form elements on page');
    
    const formDataList = [];
    let totalFields = 0;
    let skippedFields = 0;
    
    forms.forEach((form, index) => {
        console.log('[detectForms] Processing form #', index + 1, 'id:', form.id, 'name:', form.name);
        const formData = extractFormData(form);
        
        if (formData) {
            console.log('[detectForms] Form #', index + 1, 'has', formData.elements.length, 'elements');
            console.log('[detectForms] Form #', index + 1, 'fillable count:', formData.fillableCount);
            
            if (formData.elements.length > 0) {
                formDataList.push(formData);
                totalFields += formData.elements.length;
                console.log('[detectForms] Form #', index + 1, 'added to results');
            } else {
                skippedFields++;
                console.log('[detectForms] Form #', index + 1, 'skipped - no elements');
            }
        } else {
            skippedFields++;
            console.log('[detectForms] Form #', index + 1, 'skipped - extractFormData returned null');
        }
    });    
    console.log('[detectForms] ===== Detection complete =====');
    console.log('[detectForms] Total forms with elements:', formDataList.length);
    console.log('[detectForms] Total fields across all forms:', totalFields);
    console.log('[detectForms] Skipped fields:', skippedFields);
    
    // "" Also detect inputs NOT inside any <form> tag (React portals, Greenhouse, Lever) ""
    var orphanInputs = Array.from(document.querySelectorAll(
        'input:not([type=hidden]):not([type=submit]):not([type=button]):not([type=file]):not([type=reset]),' +
        'textarea, select'
    )).filter(function(el) {
        return !el.closest('form') && isFillableElement(el);
    });

    // "" Also collect inputs hidden inside shadow DOM (SmartRecruiters SPL-INPUT etc.) ""
    var shadowInputs = collectShadowInputs(document.body).filter(function(el) {
        // Only include if NOT already captured by standard queries
        return !document.querySelectorAll('input,textarea,select').length ||
               !Array.from(document.querySelectorAll('input,textarea,select')).includes(el);
    });

    // Build a single de-duplicated orphan list
    var allOrphans = orphanInputs.slice();
    var seenOrphans = new Set(orphanInputs);
    shadowInputs.forEach(function(el) {
        if (!seenOrphans.has(el) && isFillableElement(el)) {
            seenOrphans.add(el);
            allOrphans.push(el);
        }
    });

    if (allOrphans.length > 0) {
        // Deduplicate radio groups " only keep one representative per group
        var seenRadioGroups = new Set();
        var deduped = allOrphans.filter(function(el) {
            if ((el.type === 'radio') && el.name) {
                if (seenRadioGroups.has(el.name)) return false;
                seenRadioGroups.add(el.name);
            }
            return true;
        });

        var orphanElements = deduped.map(function(el, index) {
            var stableId = el.id || el.name || (el.tagName.toLowerCase() + '_orphan_' + index);
            return extractElementInfo(el, stableId, index);
        });

        formDataList.push({
            id: 'orphan_inputs',
            action: '',
            method: '',
            elements: orphanElements,
            fieldCount: orphanElements.length,
            fillableCount: 0
        });
        totalFields += deduped.length;
        console.log('[detectForms] Found', deduped.length, 'shadow/orphan inputs');
    }

    return {
        success: true,
        forms: formDataList,
        count: totalFields, // Changed from formDataList.length to totalFields
        formCount: formDataList.length, // Keep form count separate
        timestamp: new Date().toISOString()
    };
}

// Listen for messages from background or other content scripts
console.log('[detectForms] Message listener registered');

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.type === 'PING') {
        console.log('[detectForms] PING received, responding with alive');
        sendResponse({alive: true});
        return true; // Keep channel open to be safe with service worker async
    }
    if (request.type === 'REQUEST_FORM_DETECTION') {
        // For shadow DOM sites (SmartRecruiters etc.), shadow inputs may not be
        // ready immediately. Retry the shadow scan up to 10 times with 300ms delay.
        const tryDetect = () => {
            const result = detectForms();
            if (result.count > 0) {
                sendResponse(result);
                return;
            }
            // Shadow inputs not ready yet " try again
            if (tryDetect._retries < 10) {
                tryDetect._retries++;
                setTimeout(tryDetect, 300);
            } else {
                // Final attempt " send whatever we have
                sendResponse(detectForms());
            }
        };
        tryDetect._retries = 0;
        tryDetect();
        return true; // async response
    }
    
    return false; // No async work in this listener
});

// Initialize content script
function initialize() {
    console.log('[detectForms] Starting initialization...');
    console.log('[detectForms] Document readyState:', document.readyState);
    console.log('[detectForms] Document body exists:', !!document.body);
    
    // Wait for DOM to be fully rendered
    if (document.readyState !== 'complete') {
        console.log('[detectForms] Waiting for DOM to be fully rendered...');
        window.addEventListener('load', () => {
            console.log('[detectForms] DOM fully loaded, proceeding with form detection');
            performDetection();
        });
    } else {
        console.log('[detectForms] DOM already complete, proceeding immediately');
        // Small delay to ensure dynamic content is rendered
        setTimeout(() => performDetection(), 300);
    }
}

function performDetection() {
    const initialForms = detectForms();
    console.log('[detectForms] Initial detection complete. Forms found:', initialForms.count);
    
    try {
        chrome.runtime.sendMessage({
            type: 'CONTENT_SCRIPT_READY',
            url: location.href
        }).catch(() => {});
    } catch (e) {
        console.debug('[detectForms] Failed to send CONTENT_SCRIPT_READY:', e);
    }
    
    try {
        chrome.runtime.sendMessage({
            type: 'INITIAL_FORMS_DETECTED',
            forms: initialForms.forms,
            count: initialForms.count
        }).catch(() => {});
    } catch (e) {
        console.debug('[detectForms] Failed to send INITIAL_FORMS_DETECTED:', e);
    }
}

// Also listen for DOM changes to catch dynamically loaded forms
const observer = new MutationObserver((mutations) => {
    let formAdded = false;
    
    for (const mutation of mutations) {
        if (mutation.type === 'childList') {
            for (const node of mutation.addedNodes) {
                if (node.nodeType === Node.ELEMENT_NODE) {
                    if (node.matches && node.matches(FORM_SELECTORS.form)) {
                        formAdded = true;
                    } else if (node.querySelector && node.querySelector(FORM_SELECTORS.form)) {
                        formAdded = true;
                    }
                }
            }
        }
    }
    
    if (formAdded) {
        // Debounce rapid mutations
        clearTimeout(observer._timeout);
        observer._timeout = setTimeout(() => {
            const newForms = detectForms();
            try {
                chrome.runtime.sendMessage({
                    type: 'FORMS_UPDATED',
                    forms: newForms.forms,
                    count: newForms.count
                }).catch(() => {});
            } catch (e) {
                console.debug('[detectForms] Failed to send FORMS_UPDATED:', e);
            }
        }, 300);
    }
});

// Start observing with document.body check
if (document.body) {
    observer.observe(document.body, {
        childList: true,
        subtree: true
    });
} else {
    console.warn('[detectForms] document.body not available for observer');
}

// Run initialization
initialize();

// Export functions for use by other content scripts
window.formDetector = {
    detectForms,
    extractFormData,
    isFillableElement,
    getElementPosition
};

} // end guard: window.__detectFormsLoaded
