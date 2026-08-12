// API Service for communicating with the Flask backend
// Handles all HTTP requests to the form analysis and field mapping services

const API_SERVICE = {
    // Configuration
    BASE_URL: 'http://localhost:5000/api/v1', // Will be overridden from storage
    TIMEOUT: 10000, // 10 seconds
    MAX_RETRIES: 3,

    // State
    isInitialized: false,

    /**
     * Initialize the API service
     */
    init: async function() {
        // Load base URL from storage
        const {backendUrl} = await chrome.storage.local.get('backendUrl');
        if (backendUrl) {
            this.BASE_URL = `${backendUrl}/api/v1`;
        }

        this.isInitialized = true;
        console.log('[API Service] Initialized with base URL:', this.BASE_URL);
    },

    /**
     * Make an HTTP request with retry logic
     * @param {string} endpoint - API endpoint (without base URL)
     * @param {Object} options - Request options (method, data, headers, etc.)
     * @returns {Promise<Object>} - Response data
     */
    request: async function(endpoint, options = {}) {
        if (!this.isInitialized) {
            await this.init();
        }

        const url = `${this.BASE_URL}${endpoint}`;
        const {
            method = 'GET',
            data = null,
            headers = {},
            retryCount = this.MAX_RETRIES
        } = options;

        // Prepare request options
        const requestOptions = {
            method,
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json',
                ...headers
            },
            credentials: 'include' // Include cookies if needed
        };

        // Add data for POST/PUT/PATCH requests
        if (data && (method === 'POST' || method === 'PUT' || method === 'PATCH')) {
            requestOptions.body = JSON.stringify(data);
        }

        // Attempt request with retries
        for (let attempt = 0; attempt <= retryCount; attempt++) {
            try {
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), this.TIMEOUT);

                requestOptions.signal = controller.signal;

                const response = await fetch(url, requestOptions);

                clearTimeout(timeoutId);

                if (!response.ok) {
                    let errorMsg = `HTTP ${response.status}: ${response.statusText}`;
                    try {
                        const errorData = await response.json();
                        errorMsg += ` - ${errorData.error || errorData.message || ''}`;
                    } catch (e) {
                        // Ignore JSON parsing errors
                    }
                    throw new Error(errorMsg);
                }

                const data = await response.json();
                return {success: true, data: data};
            } catch (error) {
                if (attempt === retryCount) {
                    // Last attempt failed
                    console.error(`[API Service] Request failed after ${retryCount + 1} attempts:`, error);
                    return {success: false, error: error.message};
                }

                // Wait before retrying (exponential backoff)
                await new Promise(resolve => setTimeout(resolve, 1000 * Math.pow(2, attempt)));
            }
        }
    },

    /**
     * Analyze HTML form data using the backend service
     * @param {Object} formData - Form data to analyze
     * @returns {Promise<Object>} - Analysis results
     */
    analyzeForm: async function(formData) {
        return this.request('/api/form/analyze', {
            method: 'POST',
            data: formData
        });
    },

    /**
     * Get field mapping analysis from the backend
     * @param {Object} mappingRequest - Request containing form analysis and profile data
     * @returns {Promise<Object>} - Mapping results
     */
    getFieldMapping: async function(mappingRequest) {
        return this.request('/api/v1/field-mapping', {
            method: 'POST',
            data: mappingRequest
        });
    },

    /**
     * Check if the backend service is healthy
     * @returns {Promise<Object>} - Health status
     */
    healthCheck: async function() {
        return this.request('/health', {
            method: 'GET'
        });
    },

    /**
     * Get available form analysis capabilities
     * @returns {Promise<Object>} - Capabilities information
     */
    getCapabilities: async function() {
        return this.request('/form-analysis/capabilities', {
            method: 'GET'
        });
    }
};

// Initialize when the script loads
API_SERVICE.init().catch(err => {
    console.error('[API Service] Failed to initialize:', err);
});

// Export for use in other modules
window.apiService = API_SERVICE;
