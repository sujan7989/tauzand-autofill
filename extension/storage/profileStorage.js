// Storage Utility for managing extension data
// Handles saving and retrieving user profile, settings, and other persistent data

const STORAGE_SERVICE = {
    // Storage keys
    KEYS: {
        PROFILE: 'tauzand_user_profile',
        SETTINGS: 'tauzand_extension_settings',
        BACKEND_URL: 'tauzand_backend_url',
        LAST_SCAN: 'tauzand_last_scan',
        FORM_HISTORY: 'tauzand_form_history',
        AUTOFILL_HISTORY: 'tauzand_autofill_history',
        SETTINGS_VERSION: 'tauzand_settings_version'
    },
    
    // Default settings
    DEFAULT_SETTINGS: {
        enabled: true,
        confidenceThreshold: 0.70,   // Unified with autoFill.js MIN_CONFIDENCE_THRESHOLD
        autoScan: false,
        backendUrl: 'http://localhost:5000',
        showToasts: true,
        highlightFields: true,
        autoFillEnabled: true,
        scanInterval: 300000, // 5 minutes
        notificationTimeout: 3000, // 3 seconds
        highlightColors: {
            auto: 'rgba(76, 175, 80, 0.2)',
            review: 'rgba(255, 193, 7, 0.2)',
            unmapped: 'rgba(244, 67, 54, 0.2)'
        }
    },
    
    /**
     * Initialize storage service
     */
    init: async function() {
        await this.ensureDefaults();
        console.log('[Storage Service] Initialized');
    },
    
    /**
     * Ensure default values exist in storage
     */
    ensureDefaults: async function() {
        const settings = await this.getSettings();
        const needsUpdate = !settings || !settings.version;
        
        if (needsUpdate) {
            // Merge default settings with existing ones
            const updatedSettings = {
                ...this.DEFAULT_SETTINGS,
                ...(settings || {}),
                version: '1.0.0'
            };
            
            await this.saveSettings(updatedSettings);
            console.log('[Storage Service] Defaults ensured');
        }
    },
    
    /**
     * Save user profile data
     * @param {Object} profile - User profile data
     * @returns {Promise<void>}
     */
    saveProfile: async function(profile) {
        await chrome.storage.local.set({
            [this.KEYS.PROFILE]: profile,
            [this.KEYS.PROFILE + '_timestamp']: Date.now()
        });
        console.log('[Storage Service] Profile saved');
    },
    
    /**
     * Get user profile data
     * @returns {Promise<Object|null>} - Profile data or null if not found
     */
    getProfile: async function() {
        const result = await chrome.storage.local.get(this.KEYS.PROFILE);
        return result[this.KEYS.PROFILE] || null;
    },
    
    /**
     * Save extension settings
     * @param {Object} settings - Settings object to save
     * @returns {Promise<void>}
     */
    saveSettings: async function(settings) {
        const settingsToSave = {
            ...settings,
            [this.KEYS.SETTINGS_VERSION]: '1.0.0',
            lastUpdated: Date.now()
        };
        
        await chrome.storage.local.set({
            [this.KEYS.SETTINGS]: settingsToSave
        });
        console.log('[Storage Service] Settings saved');
    },
    
    /**
     * Get extension settings
     * @returns {Promise<Object>} - Settings object
     */
    getSettings: async function() {
        const result = await chrome.storage.local.get(this.KEYS.SETTINGS);
        return result[this.KEYS.SETTINGS] || null;
    },
    
    /**
     * Save backend URL
     * @param {string} url - Backend URL to save
     * @returns {Promise<void>}
     */
    saveBackendUrl: async function(url) {
        await chrome.storage.local.set({
            [this.KEYS.BACKEND_URL]: url
        });
        console.log('[Storage Service] Backend URL saved');
    },
    
    /**
     * Get backend URL
     * @returns {Promise<string>} - Backend URL
     */
    getBackendUrl: async function() {
        const result = await chrome.storage.local.get(this.KEYS.BACKEND_URL);
        return result[this.KEYS.BACKEND_URL] || 'http://localhost:5000';
    },
    
    /**
     * Save last scan timestamp
     * @param {number} timestamp - Timestamp to save
     * @returns {Promise<void>}
     */
    saveLastScan: async function(timestamp) {
        await chrome.storage.local.set({
            [this.KEYS.LAST_SCAN]: timestamp
        });
    },
    
    /**
     * Get last scan timestamp
     * @returns {Promise<number>} - Timestamp
     */
    getLastScan: async function() {
        const result = await chrome.storage.local.get(this.KEYS.LAST_SCAN);
        return result[this.KEYS.LAST_SCAN] || 0;
    },
    
    /**
     * Add form analysis to history
     * @param {Object} formData - Form analysis data to add to history
     * @returns {Promise<void>}
     */
    addToFormHistory: async function(formData) {
        const history = await this.getFormHistory();
        const entry = {
            ...formData,
            timestamp: Date.now(),
            url: window.location.href
        };
        
        // Keep only last 50 entries
        const updatedHistory = [entry, ...history.slice(0, 49)];
        
        await chrome.storage.local.set({
            [this.KEYS.FORM_HISTORY]: updatedHistory
        });
    },
    
    /**
     * Get form analysis history
     * @returns {Promise<Array>} - Array of form analysis entries
     */
    getFormHistory: async function() {
        const result = await chrome.storage.local.get(this.KEYS.FORM_HISTORY);
        return result[this.KEYS.FORM_HISTORY] || [];
    },
    
    /**
     * Add autofill operation to history
     * @param {Object} autofillData - Autofill operation data
     * @returns {Promise<void>}
     */
    addToAutofillHistory: async function(autofillData) {
        const history = await this.getAutofillHistory();
        const entry = {
            ...autofillData,
            timestamp: Date.now(),
            url: window.location.href
        };
        
        // Keep only last 100 entries
        const updatedHistory = [entry, ...history.slice(0, 99)];
        
        await chrome.storage.local.set({
            [this.KEYS.AUTOFILL_HISTORY]: updatedHistory
        });
    },
    
    /**
     * Get autofill history
     * @returns {Promise<Array>} - Array of autofill operation entries
     */
    getAutofillHistory: async function() {
        const result = await chrome.storage.local.get(this.KEYS.AUTOFILL_HISTORY);
        return result[this.KEYS.AUTOFILL_HISTORY] || [];
    },
    
    /**
     * Clear all stored data (for reset/uninstall)
     * @returns {Promise<void>}
     */
    clearAll: async function() {
        const keysToRemove = Object.values(this.KEYS);
        await chrome.storage.local.remove(keysToRemove);
        console.log('[Storage Service] All data cleared');
    },
    
    /**
     * Get storage usage statistics
     * @returns {Promise<Object>} - Storage usage info
     */
    getUsageStats: async function() {
        const items = await chrome.storage.local.get(null);
        const size = new TextEncoder().encode(JSON.stringify(items)).length;
        
        return {
            sizeInBytes: size,
            sizeInKB: (size / 1024).toFixed(2),
            itemCount: Object.keys(items).length
        };
    }
};

// Initialize when the script loads
STORAGE_SERVICE.init().catch(err => {
    console.error('[Storage Service] Failed to initialize:', err);
});

// Export for use in other modules
window.storageService = STORAGE_SERVICE;