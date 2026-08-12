// Content Script: HTML Extraction
// Handles extracting form data from the page for backend analysis
if (typeof window.__extractHTMLLoaded !== 'undefined') {
    console.log('[extractHTML] Already loaded, skipping');
} else {
window.__extractHTMLLoaded = true;
console.log('[Content] extractHTML.js loaded');

const EXTRACT_CONFIG = {
    BACKEND_URL: 'http://localhost:5000', // Will be overridden from storage
    TIMEOUT: 15000
};

// Extract full HTML from the current page (or just form sections)
function extractPageHTML(options = {}) {
    const {
        fullPage = false,
        formSelectors = ['form'],
        includeMetadata = true
    } = options;
    
    let htmlToSend = '';
    
    if (fullPage) {
        htmlToSend = document.documentElement.outerHTML;
    } else {
        // Extract only forms and their containers
        const formElements = document.querySelectorAll(formSelectors.join(', '));
        if (formElements.length === 0) {
            // Fallback to body if no forms found (guard for missing body)
            htmlToSend = document.body
                ? document.body.outerHTML
                : document.documentElement.outerHTML;
        } else {
            // Create a temporary container to hold form HTML
            const tempDiv = document.createElement('div');
            formElements.forEach(form => {
                // Include some context around each form
                const formClone = form.cloneNode(true);
                tempDiv.appendChild(formClone);
            });
            htmlToSend = tempDiv.innerHTML;
        }
    }
    
    const result = {
        html: htmlToSend,
        url: window.location.href,
        title: document.title,
        timestamp: new Date().toISOString(),
        referrer: document.referrer
    };
    
    if (includeMetadata) {
        // Add viewport and screen info for context
        result.viewport = {
            width: window.innerWidth,
            height: window.innerHeight
        };
        result.screen = {
            width: window.screen.width,
            height: window.screen.height
        };
        result.userAgent = navigator.userAgent;
    }
    
    return result;
}

// Get backend URL from storage or use default
// Bug 4 fix: Read from chrome.storage.sync (where background writes settings),
// not chrome.storage.local which would always return the default.
async function getBackendUrl() {
    const result = await chrome.storage.sync.get('backendUrl');
    return result.backendUrl || EXTRACT_CONFIG.BACKEND_URL;
}

// Handle messages from other content scripts or background
console.log('[ExtractHTML] Message listener registered');

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.type === 'EXTRACT_AND_ANALYZE_FORMS') {
        console.log('[ExtractHTML] EXTRACT_AND_ANALYZE_FORMS: Received request, fullPage:', !!request.fullPage);
        try {
            // Extract full page if: fullPage flag, no forms, or orphan inputs detected
            const hasOrphans = request.formData && request.formData.some(f => f.id === 'orphan_inputs');
            const noForms    = request.formData && request.formData.length === 0;
            const htmlData = extractPageHTML({fullPage: !!request.fullPage || noForms || hasOrphans});
            console.log('[ExtractHTML] HTML extracted, length:', htmlData.html.length);

            const analysisRequest = {
                html: htmlData.html,
                source_url: window.location.href,
                metadata: {
                    page_title: document.title,
                    forms: (request.formData || []).map(form => ({
                        id: form.id,
                        action: form.action,
                        method: form.method,
                        element_count: form.elements?.length || 0
                    }))
                }
            };

            sendResponse({ success: true, data: analysisRequest });
        } catch (error) {
            console.error('[ExtractHTML] Failed:', error);
            sendResponse({ success: false, error: error.message });
        }
        return false;
    }

    if (request.type === 'GET_PAGE_INFO') {
        sendResponse({ 
            success: true, 
            data: { 
                url: window.location.href, 
                title: document.title, 
                domain: new URL(window.location.href).hostname, 
                timestamp: new Date().toISOString() 
            } 
        });
    }

    return false; // Synchronous response
});

// Export for use by other modules
window.htmlExtractor = {
    extractPageHTML,
    getBackendUrl
};

} // end guard: window.__extractHTMLLoaded