// NOTE: This module does NOT register a chrome.runtime.onMessage listener.
if (typeof window.__messagingLoaded !== 'undefined') {
    console.log('[messaging] Already loaded, skipping');
} else {
window.__messagingLoaded = true;
console.log('[Content] messaging.js loaded (helper-only, no listener registered)');

// Message type constants (reference only " actual handlers are in each script)
const MESSAGE_TYPES = {
    // From background to content
    FROM_BACKGROUND: {
        GET_STATE: 'GET_STATE',
        SET_ENABLED: 'SET_ENABLED',
        GET_USER_PROFILE: 'GET_USER_PROFILE',
        SET_USER_PROFILE: 'SET_USER_PROFILE',
        SCAN_FORMS: 'SCAN_FORMS',
        AUTO_FILL_FORM: 'AUTO_FILL_FORM',
        GET_FORM_DATA: 'GET_FORM_DATA',
        SUBMIT_FORM: 'SUBMIT_FORM',
        FORM_OBSERVER_START: 'FORM_OBSERVER_START',
        FORM_OBSERVER_STOP: 'FORM_OBSERVER_STOP',
        FORM_OBSERVER_GET_STATE: 'FORM_OBSERVER_GET_STATE',
        FORM_OBSERVER_FORCE_CHECK: 'FORM_OBSERVER_FORCE_CHECK',
        HIGHLIGHT_FIELD: 'HIGHLIGHT_FIELD',
        HIGHLIGHT_FIELDS_BATCH: 'HIGHLIGHT_FIELDS_BATCH',
        CLEAR_HIGHLIGHTS: 'CLEAR_HIGHLIGHTS',
        GET_HIGHLIGHT_STATS: 'GET_HIGHLIGHT_STATS',
        FILL_RESULTS: 'FILL_RESULTS',
        SHOW_TOAST: 'SHOW_TOAST',
        NAVIGATION_CHANGE: 'NAVIGATION_CHANGE',
        FORMS_UPDATED_DYNAMIC: 'FORMS_UPDATED_DYNAMIC',
        INITIAL_FORMS_DETECTED: 'INITIAL_FORMS_DETECTED',
        CONFIG_UPDATE: 'CONFIG_UPDATE'
    },

    // From content to background
    TO_BACKGROUND: {
        REQUEST_FORM_DETECTION: 'REQUEST_FORM_DETECTION',
        EXTRACT_AND_ANALYZE_FORMS: 'EXTRACT_AND_ANALYZE_FORMS',
        GET_PAGE_INFO: 'GET_PAGE_INFO',
        PERFORM_AUTO_FILL: 'PERFORM_AUTO_FILL',
        CLEAR_HIGHLIGHTS: 'CLEAR_HIGHLIGHTS',
        GET_FILL_STATE: 'GET_FILL_STATE',
        FORM_OBSERVER_START: 'FORM_OBSERVER_START',
        FORM_OBSERVER_STOP: 'FORM_OBSERVER_STOP',
        FORM_OBSERVER_GET_STATE: 'FORM_OBSERVER_GET_STATE',
        FORM_OBSERVER_FORCE_CHECK: 'FORM_OBSERVER_FORCE_CHECK',
        HIGHLIGHT_FIELD: 'HIGHLIGHT_FIELD',
        HIGHLIGHT_FIELDS_BATCH: 'HIGHLIGHT_FIELDS_BATCH',
        CLEAR_HIGHLIGHTS: 'CLEAR_HIGHLIGHTS',
        GET_HIGHLIGHT_STATS: 'GET_HIGHLIGHT_STATS',
        FILL_RESULTS: 'FILL_RESULTS',
        SHOW_TOAST: 'SHOW_TOAST',
        NAVIGATION_CHANGE: 'NAVIGATION_CHANGE',
        FORMS_UPDATED_DYNAMIC: 'FORMS_UPDATED_DYNAMIC',
        INITIAL_FORMS_DETECTED: 'INITIAL_FORMS_DETECTED',
        CONFIG_UPDATE: 'CONFIG_UPDATE'
    }
};

// NOTE: Each specialized content script owns its own chrome.runtime.onMessage listener.
// The routing table and handleMessage were removed " messaging.js is now helper-only.
// See Bug 3 fix.

// Helper: sendMessage with timeout and error handling
function sendMessageToBackground(message, options = {}) {
    const {timeout = 5000, checkForResponse = true} = options;

    return new Promise((resolve, reject) => {
        const timeoutId = setTimeout(() => {
            reject(new Error(`Message timeout: ${message.type}`));
        }, timeout);

        chrome.runtime.sendMessage(message, (response) => {
            clearTimeout(timeoutId);

            if (chrome.runtime.lastError) {
                reject(new Error(chrome.runtime.lastError.message));
                return;
            }

            if (checkForResponse && (!response || !response.success)) {
                reject(new Error(response?.error || 'Unknown error'));
                return;
            }

            resolve(response);
        });
    });
}

// Export for use by other content scripts
window.extensionMessaging = {
    sendMessageToBackground,
    MESSAGE_TYPES,
    sendMessage: (message) => chrome.runtime.sendMessage(message)
};

console.log('[Messaging] Helper functions initialized');

} // end guard: window.__messagingLoaded