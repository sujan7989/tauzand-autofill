// Content Script: Form Observer v2
// Handles SPA navigation, multi-step forms, and dynamic DOM changes for
// Workday, Greenhouse, LinkedIn, SmartRecruiters, Lever, Ashby, Taleo, iCIMS, etc.

if (window.__observerInitialized) {
    console.log('[observer] Already initialized, skipping');
} else {
    window.__observerInitialized = true;
    console.log('[Content] observer.js v2 loaded');

class FormObserver {
    constructor() {
        this.state = {
            mutationObserver: null,
            navigationObserver: null,
            lastKnownUrl: '',
            lastKnownState: '',
            formDetectionTimeout: null,
            debounceDelay: 300, // ms
            isObserving: false,
            knownForms: new Map(), // formId -> formData
            changeCallbacks: [],
            _multiStepHintTimeout: null  // hint toast for multi-step form navigation
        };
        
        // Bind methods
        this.handleMutations = this.handleMutations.bind(this);
        this.handleNavigationChange = this.handleNavigationChange.bind(this);
        this.debouncedFormCheck = this.debouncedFormCheck.bind(this);
        
        // Handle extension context invalidation
        this.handleContextInvalidation = this.handleContextInvalidation.bind(this);
    }
    
    // Handle extension context invalidation
    handleContextInvalidation() {
        console.log('[FormObserver] Extension context invalidated, stopping observer');
        this.stop();
    }
    
    // Start observing for form changes
    start() {
        if (this.state.isObserving) return;
        
        this.state.isObserving = true;
        this.state.lastKnownUrl = window.location.href;
        this.state.lastKnownState = document.readyState;
        
        // Set up MutationObserver for DOM changes
        this.state.mutationObserver = new MutationObserver(this.handleMutations);
        
        // Check if document.body exists before observing
        if (document.body) {
            this.state.mutationObserver.observe(document.body, {
                childList: true,
                subtree: true,
                attributes: true,
                attributeFilter: ['class', 'style', 'hidden', 'disabled', 'readonly']
            });
        } else {
            console.warn('[FormObserver] document.body not available for mutation observer');
        }
        
        // Set up navigation observer for SPA frameworks
        this.setupNavigationObserver();
        
        // Initial form check
        this.debouncedFormCheck();
        
        console.log('[FormObserver] Started observing for form changes');
    }
    
    // Stop observing
    stop() {
        if (!this.state.isObserving) return;
        
        this.state.isObserving = false;
        
        if (this.state.mutationObserver) {
            this.state.mutationObserver.disconnect();
            this.state.mutationObserver = null;
        }
        
        if (this.state.navigationObserver) {
            this.state.navigationObserver.disconnect();
            this.state.navigationObserver = null;
        }
        
        // Remove all navigation listeners we registered (avoid SPA leaks)
        if (this.state._navListenerRefs) {
            const refs = this.state._navListenerRefs;
            window.removeEventListener('popstate', refs.popstate, false);
            window.removeEventListener('hashchange', refs.hashchange, false);
            window.removeEventListener('pushstate', refs.pushstate, false);
            window.removeEventListener('replacestate', refs.replacestate, false);
            window.removeEventListener('locationchange', refs.locationchange, false);
            this.state._navListenerRefs = null;
        }
        
        // Restore native pushState/replaceState if we patched them
        if (window.history.__tauzandPatchedPush) {
            window.history.pushState = window.history.__tauzandPatchedPush;
            delete window.history.__tauzandPatchedPush;
        }
        if (window.history.__tauzandPatchedReplace) {
            window.history.replaceState = window.history.__tauzandPatchedReplace;
            delete window.history.__tauzandPatchedReplace;
        }
        
        // Clear debounce timeouts
        if (this.state.formDetectionTimeout) {
            clearTimeout(this.state.formDetectionTimeout);
            this.state.formDetectionTimeout = null;
        }
        if (this.state._navigationTimeout) {
            clearTimeout(this.state._navigationTimeout);
            this.state._navigationTimeout = null;
        }
        if (this.state._multiStepHintTimeout) {
            clearTimeout(this.state._multiStepHintTimeout);
            this.state._multiStepHintTimeout = null;
        }
        
        console.log('[FormObserver] Stopped observing');
    }
    
    // Handle DOM mutations
    handleMutations(mutations) {
        let formsChanged = false;
        let significantChange = false;
        
        for (const mutation of mutations) {
            // Check for added/removed form elements
            if (mutation.type === 'childList') {
                for (const node of mutation.addedNodes) {
                    if (node.nodeType === Node.ELEMENT_NODE) {
                        if (node.matches && node.matches('form')) {
                            formsChanged = true;
                            significantChange = true;
                        } else if (node.querySelector && node.querySelector('form')) {
                            formsChanged = true;
                            significantChange = true;
                        }
                    }
                }
                
                for (const node of mutation.removedNodes) {
                    if (node.nodeType === Node.ELEMENT_NODE) {
                        if (node.matches && node.matches('form')) {
                            formsChanged = true;
                            significantChange = true;
                        } else if (node.querySelector && node.querySelector('form')) {
                            formsChanged = true;
                            significantChange = true;
                        }
                    }
                }
            }
            
            // Check for attribute changes that might affect form visibility/interactivity
            if (mutation.type === 'attributes') {
                const target = mutation.target;
                if (target.matches && 
                    (target.matches('form') || 
                     target.querySelector && target.querySelector('form') ||
                     target.matches('input, select, textarea, button'))) {
                    
                    const attrName = mutation.attributeName;
                    if (['class', 'style', 'hidden', 'disabled', 'readonly', 
                         'aria-hidden', 'aria-disabled'].includes(attrName)) {
                        formsChanged = true;
                    }
                }
            }
        }
        
        // Debounce form checks to avoid excessive processing
        if (formsChanged) {
            this.debouncedFormCheck();
        }
        
        // Notify of significant changes (like SPA page changes)
        if (significantChange) {
            this.processNavigationChange();
        }
    }
    
    // Handle navigation changes (SPA frameworks)
    setupNavigationObserver() {
        // Override pushState and replaceState to detect SPA navigations
        // Guard against being patched twice (e.g. if start() is called twice)
        if (window.history.pushState && !window.history.__tauzandPatchedPush) {
            const originalPushState = window.history.pushState;
            window.history.pushState = function(state, title, url) {
                const result = originalPushState.apply(this, arguments);
                window.dispatchEvent(new Event('pushstate'));
                window.dispatchEvent(new Event('locationchange'));
                return result;
            };
            window.history.__tauzandPatchedPush = originalPushState;
        }

        if (window.history.replaceState && !window.history.__tauzandPatchedReplace) {
            const originalReplaceState = window.history.replaceState;
            window.history.replaceState = function(state, title, url) {
                const result = originalReplaceState.apply(this, arguments);
                window.dispatchEvent(new Event('replacestate'));
                window.dispatchEvent(new Event('locationchange'));
                return result;
            };
            window.history.__tauzandPatchedReplace = originalReplaceState;
        }

        // Listen for popstate and hashchange events " store refs for cleanup
        const popstateHandler = this.handleNavigationChange;
        const hashchangeHandler = this.handleNavigationChange;
        window.addEventListener('popstate', popstateHandler, false);
        window.addEventListener('hashchange', hashchangeHandler, false);
        window.addEventListener('pushstate', popstateHandler, false);
        window.addEventListener('replacestate', popstateHandler, false);
        window.addEventListener('locationchange', popstateHandler, false);

        this.state._navListenerRefs = {
            popstate: popstateHandler,
            hashchange: hashchangeHandler,
            pushstate: popstateHandler,
            replacestate: popstateHandler,
            locationchange: popstateHandler
        };

        // Also check for common SPA framework events
        // Angular
        if (window.ng && window.ng.getComponent) {
            // Angular specific detection would go here
        }

        // React/Vue detection is harder without specific libraries
        // We'll rely on DOM changes and URL changes
    }
    
    // Handle navigation-like changes
    handleNavigationChange(event) {
        // Avoid firing too rapidly
        if (this.state._navigationTimeout) {
            clearTimeout(this.state._navigationTimeout);
        }
        
        this.state._navigationTimeout = setTimeout(() => {
            this.processNavigationChange();
        }, 100);
    }
    
    // Process a potential navigation change
    processNavigationChange() {
        const newUrl = window.location.href;
        const newState = document.readyState;
        
        const urlChanged = newUrl !== this.state.lastKnownUrl;
        const stateChanged = newState !== this.state.lastKnownState;
        
        if (urlChanged || stateChanged) {
            console.log(`[FormObserver] Navigation detected: ${this.state.lastKnownUrl} -> ${newUrl}`);
            
            this.state.knownForms.clear();
            this.state.lastKnownUrl = newUrl;
            this.state.lastKnownState = newState;
            
            // Trigger fresh form detection after SPA render settles
            this.debouncedFormCheck();
            
            // Detect platform for richer context
            const host = location.hostname.toLowerCase();
            let platform = 'generic';
            if (host.includes('myworkdayjobs') || host.includes('workday')) platform = 'workday';
            else if (host.includes('greenhouse'))    platform = 'greenhouse';
            else if (host.includes('linkedin'))      platform = 'linkedin';
            else if (host.includes('smartrecruiters')) platform = 'smartrecruiters';
            else if (host.includes('lever'))         platform = 'lever';
            else if (host.includes('ashbyhq'))       platform = 'ashby';
            else if (host.includes('indeed'))        platform = 'indeed';
            else if (host.includes('taleo'))         platform = 'taleo';
            else if (host.includes('icims'))         platform = 'icims';
            else if (host.includes('workable'))      platform = 'workable';
            else if (host.includes('bamboohr'))      platform = 'bamboohr';
            else if (host.includes('rippling'))      platform = 'rippling';
            else if (host.includes('wellfound') || host.includes('angel.co')) platform = 'wellfound';

            // Notify background " it will re-inject scripts if needed
            try {
                if (chrome.runtime?.id) {
                    chrome.runtime.sendMessage({
                        type: 'NAVIGATION_CHANGE',
                        url: newUrl,
                        platform: platform,
                        timestamp: new Date().toISOString()
                    });
                }
            } catch (e) {
                console.debug('[FormObserver] Context invalidated during navigation change:', e);
            }

            // On multi-step forms (Workday, Greenhouse) the user may click "Next"
            // and land on a new step. After a short delay, show a toast hint.
            if (this.state._multiStepHintTimeout) clearTimeout(this.state._multiStepHintTimeout);
            this.state._multiStepHintTimeout = setTimeout(() => {
                const inputs = document.querySelectorAll('input:not([type=hidden]), textarea, select');
                const hasUnfilledInputs = Array.from(inputs).some(el => {
                    return !el.disabled && !el.readOnly && (el.value || '').trim() === '' &&
                           el.type !== 'submit' && el.type !== 'button' && el.type !== 'reset';
                });
                if (hasUnfilledInputs && inputs.length > 0) {
                    // Show re-autofill hint toast
                    const existing = document.getElementById('tauzand-toast');
                    if (!existing) {
                        const toast = document.createElement('div');
                        toast.id = 'tauzand-toast-hint';
                        toast.style.cssText = 'position:fixed;bottom:20px;right:20px;padding:10px 18px;' +
                            'border-radius:6px;color:#fff;font-size:13px;font-weight:500;' +
                            'z-index:2147483647;box-shadow:0 4px 12px rgba(0,0,0,0.25);' +
                            'background:#1565c0;font-family:-apple-system,BlinkMacSystemFont,sans-serif;' +
                            'cursor:pointer;';
                        toast.textContent = '- New form step detected " click Autofill to fill it';
                        toast.onclick = function() { toast.remove(); };
                        document.body && document.body.appendChild(toast);
                        setTimeout(() => { if (toast.parentNode) toast.parentNode.removeChild(toast); }, 5000);
                    }
                }
            }, 1500);
        }
    }
    
    // Debounced form checking to avoid excessive processing
    debouncedFormCheck() {
        if (this.state.formDetectionTimeout) {
            clearTimeout(this.state.formDetectionTimeout);
        }
        
        this.state.formDetectionTimeout = setTimeout(() => {
            this.checkForFormChanges();
        }, this.state.debounceDelay);
    }
    
    // Check for form changes and report them
    async checkForFormChanges() {
        try {
            // Get current forms on the page
            const currentForms = await this.detectCurrentForms();
            
            // Compare with known forms
            const changes = this.compareForms(currentForms);
            
            // If there are significant changes, notify
            if (changes.hasChanges) {
                // Update known forms
                this.updateKnownForms(currentForms);
                
                // Notify background and other content scripts
                try {
                    if (chrome.runtime?.id) {
                        chrome.runtime.sendMessage({
                            type: 'FORMS_UPDATED_DYNAMIC',
                            forms: currentForms,
                            changes: changes,
                            timestamp: new Date().toISOString()
                        });
                    }
                } catch (e) {
                    console.debug('[FormObserver] Extension context invalidated during forms update:', e);
                }
                
                console.log(`[FormObserver] Detected ${changes.added.length} new forms, ${changes.removed.length} removed, ${changes.changed.length} changed`);
            }
        } catch (error) {
            console.error('[FormObserver] Error checking for form changes:', error);
        }
    }
    
    // Detect all forms currently on the page
    async detectCurrentForms() {
        // We'll reuse the form detection logic from detectForms.js
        // But we need to get it from the window or re-implement a lightweight version
        
        // Try to get it from the existing form detector
        if (window.formDetector && typeof window.formDetector.detectForms === 'function') {
            const result = window.formDetector.detectForms();
            if (result.success) {
                return result.forms;
            }
        }
        
        // Fallback: lightweight form detection
        return this.lightweightFormDetection();
    }
    
    // Lightweight form detection (fallback)
    lightweightFormDetection() {
        const forms = document.querySelectorAll('form');
        const formData = [];
        
        forms.forEach(form => {
            if (!form.isConnected) return; // Skip if removed from DOM
            
            const elements = [];
            const inputs = form.querySelectorAll('input, select, textarea');
            
            inputs.forEach(input => {
                if (!this.isFieldFillable(input)) return;
                
                elements.push({
                    id: input.id,
                    name: input.name,
                    type: input.type,
                    placeholder: input.placeholder || '',
                    required: input.required,
                    autocomplete: input.autocomplete,
                    'aria-label': input.getAttribute('aria-label'),
                    'aria-labelledby': input.getAttribute('aria-labelledby'),
                    value: input.value
                });
            });
            
            formData.push({
                id: form.id || form.name || `form_${Date.now()}_${Math.random()}`,
                action: form.action,
                method: form.method,
                elements: elements,
                fieldCount: elements.length
            });
        });
        
        return formData;
    }
    
    // Check if a field is fillable (simplified version)
    isFieldFillable(element) {
        if (!element) return false;
        
        // Basic checks
        if (element.type === 'hidden') return false;
        if (element.disabled) return false;
        if (element.readOnly) return false;
        
        // Check visibility (basic)
        const style = window.getComputedStyle(element);
        if (style.display === 'none' || style.visibility === 'hidden') return false;
        
        return true;
    }
    
    // Compare current forms with known forms to detect changes
    compareForms(currentForms) {
        const knownMap = this.state.knownForms; // Already a Map, use directly
        const currentMap = new Map();
        
        // Build map of current forms by ID
        currentForms.forEach(form => {
            currentMap.set(form.id, form);
        });
        
        const changes = {
            added: [],
            removed: [],
            changed: [],
            unchanged: [],
            hasChanges: false
        };
        
        // Check for added and changed forms
        currentForms.forEach(currentForm => {
            const knownForm = knownMap.get(currentForm.id);
            if (!knownForm) {
                changes.added.push(currentForm);
                changes.hasChanges = true;
            } else if (!this.formsEqual(knownForm, currentForm)) {
                changes.changed.push({
                    old: knownForm,
                    new: currentForm
                });
                changes.hasChanges = true;
            } else {
                changes.unchanged.push(currentForm);
            }
        });
        
        // Check for removed forms
        this.state.knownForms.forEach(knownForm => {
            if (!currentMap.has(knownForm.id)) {
                changes.removed.push(knownForm);
                changes.hasChanges = true;
            }
        });
        
        return changes;
    }
    
    // Check if two forms are essentially the same
    formsEqual(form1, form2) {
        // Quick checks
        if (form1.fieldCount !== form2.fieldCount) return false;
        if (form1.action !== form2.action) return false;
        if (form1.method !== form2.method) return false;
        
        // Compare elements (simplified - just count and basic attributes)
        if (form1.elements.length !== form2.elements.length) return false;
        
        // Create maps for easier comparison
        const map1 = new Map(form1.elements.map(el => [el.name || el.id, el]));
        const map2 = new Map(form2.elements.map(el => [el.name || el.id, el]));
        
        // Check that all elements in map1 exist in map2 with similar properties
        for (const [key, el1] of map1) {
            const el2 = map2.get(key);
            if (!el2) return false;
            
            // Check key attributes
            if (el1.type !== el2.type) return false;
            if (el1.required !== el2.required) return false;
            // Note: We're not checking exact value as it may change
        }
        
        return true;
    }
    
    // Update our known forms list
    updateKnownForms(currentForms) {
        // Clear the existing Map and add current forms
        this.state.knownForms.clear();
        
        currentForms.forEach(form => {
            // Store the form data in the Map
            this.state.knownForms.set(form.id, form);
        });
    }
    
    // Get a summary of what we're tracking
    getState() {
        return {
            isObserving: this.state.isObserving,
            knownFormsCount: this.state.knownForms.size,
            lastKnownUrl: this.state.lastKnownUrl,
            lastKnownState: this.state.lastKnownState,
            hasMutationObserver: !!this.state.mutationObserver,
            hasNavigationObserver: !!this.state.navigationObserver
        };
    }
    
    // Clean up resources
    destroy() {
        this.stop();
        
        // Clear any timeouts
        if (this.state.formDetectionTimeout) {
            clearTimeout(this.state.formDetectionTimeout);
            this.state.formDetectionTimeout = null;
        }
    }
}

// Create and export a singleton instance
const formObserver = new FormObserver();

// Auto-start when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => formObserver.start());
} else {
    formObserver.start();
}

// Export for use by other modules
window.formObserver = formObserver;

// Listen for messages to control the observer
console.log('[observer] Message listener registered');

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.type === 'FORM_OBSERVER_START') {
        formObserver.start();
        sendResponse({success: true});
        return true; // Allow async response
    } else if (request.type === 'FORM_OBSERVER_STOP') {
        formObserver.stop();
        sendResponse({success: true});
        return true; // Allow async response
    } else if (request.type === 'EXTENSION_RELOAD') {
        formObserver.handleContextInvalidation();
        sendResponse({success: true});
        return true; // Allow async response
    }
    return false; // Unhandled message type
});

// Handle extension context invalidation
window.addEventListener('beforeunload', () => {
    console.log('[FormObserver] Page unloading, stopping observer');
    if (window.formObserver) {
        window.formObserver.stop();
    }
});

// Close the initialization guard
}
