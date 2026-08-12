// Options Page Script: Options page logic
// Handles saving and loading settings for the extension options page

document.addEventListener('DOMContentLoaded', () => {
    // Initialize the options page
    initOptionsPage();
    
    // Set up event listeners
    setupEventListeners();
    
    // Load current settings
    loadSettings();
});

/**
 * Initialize the options page
 */
function initOptionsPage() {
    // Add any initialization logic here
    console.log('[Options Page] Initialized');
};

/**
 * Set up all event listeners
 */
function setupEventListeners() {
    // Save button
    document.getElementById('saveSettings').addEventListener('click', saveSettings);
    
    // Reset button
    document.getElementById('resetDefaults').addEventListener('click', resetDefaults);
    
    // Export/Import buttons
    document.getElementById('exportSettings').addEventListener('click', exportSettings);
    document.getElementById('importSettings').addEventListener('click', () => {
        document.getElementById('importFile').click();
    });
    
    document.getElementById('importFile').addEventListener('change', handleImportFile);
    
    // Confidence slider
    const confidenceSlider = document.getElementById('confidenceSlider');
    const confidenceValue = document.getElementById('confidenceValue');
    confidenceSlider.addEventListener('input', () => {
        confidenceValue.textContent = `${confidenceSlider.value}%`;
    });
    
    // Test connection button
    document.getElementById('testConnection').addEventListener('click', testConnection);
    
    // Handle form submission to prevent page reload
    document.getElementById('optionsForm').addEventListener('submit', (e) => {
        e.preventDefault();
        saveSettings();
    });
};

/**
 * Load settings from storage and populate the form
 */
function loadSettings() {
    chrome.storage.sync.get(null, (result) => {
        if (chrome.runtime.lastError) {
            showStatus('Error loading settings: ' + chrome.runtime.lastError.message, 'error');
            return;
        }
        
        // Populate form with saved values or defaults
        document.getElementById('enabled').checked = result.enabled !== undefined ? result.enabled : true;
        document.getElementById('autoScan').checked = result.autoScan !== undefined ? result.autoScan : false;
        document.getElementById('confidenceSlider').value = result.confidenceThreshold !== undefined ? 
            Math.round(result.confidenceThreshold * 100) : 70;
        document.getElementById('confidenceValue').textContent = 
            document.getElementById('confidenceSlider').value + '%';
        document.getElementById('backendUrl').value = result.backendUrl || 'http://localhost:5000';
        document.getElementById('showToasts').checked = result.showToasts !== undefined ? result.showToasts : true;
        document.getElementById('highlightFields').checked = result.highlightFields !== undefined ? result.highlightFields : true;
        document.getElementById('scanInterval').value = result.scanInterval !== undefined ? result.scanInterval : 300;
        document.getElementById('notificationTimeout').value = result.notificationTimeout !== undefined ? 
            result.notificationTimeout : 3;
        
        console.log('[Options Page] Settings loaded');
    });
};

/**
 * Save settings from the form to storage
 */
function saveSettings() {
    // Get values from form
    const settings = {
        enabled: document.getElementById('enabled').checked,
        autoScan: document.getElementById('autoScan').checked,
        confidenceThreshold: parseInt(document.getElementById('confidenceSlider').value, 10) / 100,
        backendUrl: document.getElementById('backendUrl').value.trim() || 'http://localhost:5000',
        showToasts: document.getElementById('showToasts').checked,
        highlightFields: document.getElementById('highlightFields').checked,
        scanInterval: parseInt(document.getElementById('scanInterval').value, 10),
        notificationTimeout: parseInt(document.getElementById('notificationTimeout').value, 10)
    };
    
    // Validate inputs
    const errors = [];
    if (settings.backendUrl.trim() === '') {
        errors.push('Backend URL cannot be empty');
    }
    if (isNaN(settings.confidenceThreshold) || settings.confidenceThreshold < 0 || settings.confidenceThreshold > 1) {
        errors.push('Confidence threshold must be between 0 and 1');
    }
    if (settings.scanInterval < 5) {
        errors.push('Scan interval must be at least 5 seconds');
    }
    if (settings.notificationTimeout < 1) {
        errors.push('Notification timeout must be at least 1 second');
    }
    
    if (errors.length > 0) {
        showStatus(errors.join('<br>'), 'error');
        return;
    }
    
    // Save to storage
    chrome.storage.sync.set(settings, () => {
        if (chrome.runtime.lastError) {
            showStatus('Error saving settings: ' + chrome.runtime.lastError.message, 'error');
            return;
        }
        
        showStatus('Settings saved successfully!', 'success');
        
        // Notify background page and other extensions/components
        chrome.runtime.sendMessage({
            type: 'SETTINGS_UPDATED',
            settings: settings
        });
        
        // Also update local storage for immediate use
        chrome.storage.local.set(settings);
    });
};

/**
 * Reset settings to default values
 */
function resetDefaults() {
    if (!confirm('Are you sure you want to reset all settings to default values?')) {
        return;
    }
    
    const defaults = {
        enabled: true,
        autoScan: false,
        confidenceThreshold: 0.70,
        backendUrl: 'http://localhost:5000',
        showToasts: true,
        highlightFields: true,
        scanInterval: 300,
        notificationTimeout: 3
    };
    
    chrome.storage.sync.set(defaults, () => {
        if (chrome.runtime.lastError) {
            showStatus('Error resetting settings: ' + chrome.runtime.lastError.message, 'error');
            return;
        }
        
        // Update form to reflect defaults
        document.getElementById('enabled').checked = defaults.enabled;
        document.getElementById('autoScan').checked = defaults.autoScan;
        document.getElementById('confidenceSlider').value = Math.round(defaults.confidenceThreshold * 100);
        document.getElementById('confidenceValue').textContent = `${document.getElementById('confidenceSlider').value}%`;
        document.getElementById('backendUrl').value = defaults.backendUrl;
        document.getElementById('showToasts').checked = defaults.showToasts;
        document.getElementById('highlightFields').checked = defaults.highlightFields;
        document.getElementById('scanInterval').value = defaults.scanInterval;
        document.getElementById('notificationTimeout').value = defaults.notificationTimeout;
        
        // Notify background
        chrome.runtime.sendMessage({
            type: 'SETTINGS_UPDATED',
            settings: defaults
        });
        
        showStatus('Settings reset to default values!', 'success');
    });
};

/**
 * Export settings to a JSON file
 */
function exportSettings() {
    chrome.storage.sync.get(null, (settings) => {
        if (chrome.runtime.lastError) {
            showStatus('Error exporting settings: ' + chrome.runtime.lastError.message, 'error');
            return;
        }
        
        // Create a blob with the settings data
        const blob = new Blob([JSON.stringify(settings, null, 2)], {type: 'application/json'});
        const url = URL.createObjectURL(blob);
        
        // Create a temporary link to download the file
        const a = document.createElement('a');
        a.href = url;
        a.download = `tauzand-settings-${new Date().toISOString().slice(0,10)}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        
        showStatus('Settings exported successfully!', 'success');
    });
};

/**
 * Handle importing settings from a file
 */
function handleImportFile(event) {
    const file = event.target.files[0];
    if (!file) return;
    
    const reader = new FileReader();
    reader.onload = (e) => {
        try {
            const settings = JSON.parse(e.target.result);
            
            // Validate that it looks like settings data
            if (typeof settings !== 'object' || settings === null) {
                throw new Error('Invalid settings file format');
            }
            
            // Save the imported settings
            chrome.storage.sync.set(settings, () => {
                if (chrome.runtime.lastError) {
                    showStatus('Error importing settings: ' + chrome.runtime.lastError.message, 'error');
                    return;
                }
                
                // Update the form to show imported settings
                loadSettings();
                
                // Notify background
                chrome.runtime.sendMessage({
                    type: 'SETTINGS_UPDATED',
                    settings: settings
                });
                
                showStatus('Settings imported successfully!', 'success');
            });
        } catch (error) {
            showStatus('Error parsing settings file: ' + error.message, 'error');
        }
    };
    
    reader.readAsText(file);
    
    // Reset file input
    event.target.value = '';
};

/**
 * Test the connection to the backend
 */
function testConnection() {
    const backendUrl = document.getElementById('backendUrl').value.trim();
    if (!backendUrl) {
        showStatus('Please enter a backend URL first', 'error');
        return;
    }
    
    const btn = document.getElementById('testConnection');
    btn.disabled = true;
    btn.textContent = 'Testing...';
    
    // Test connection to backend health endpoint with proper timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);
    
    fetch(`${backendUrl}/api/form/health`, {
        method: 'GET',
        signal: controller.signal
    })
    .then(response => {
        clearTimeout(timeoutId);
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        return response.json();
    })
    .then(data => {
        btn.disabled = false;
        btn.textContent = 'Test Connection';
        showStatus(`Backend connection successful! Response: ${JSON.stringify(data)}`, 'success');
    })
    .catch(error => {
        clearTimeout(timeoutId);
        if (error.name !== 'AbortError') {
            btn.disabled = false;
            btn.textContent = 'Test Connection';
            showStatus(`Connection failed: ${error.message}`, 'error');
        } else {
            btn.disabled = false;
            btn.textContent = 'Test Connection';
            showStatus('Connection timed out after 5 seconds', 'error');
        }
    });
};

/**
 * Show a status message
 */
function showStatus(message, type = 'info') {
    const statusDiv = document.getElementById('status');
    statusDiv.innerHTML = message;
    statusDiv.className = `status status-${type}`;
    statusDiv.style.display = 'block';
    
    // Auto-hide after 5 seconds
    setTimeout(() => {
        statusDiv.style.display = 'none';
    }, 5000);
};

// Export functions for use in console if needed
window.optionsPage = {
    loadSettings,
    saveSettings,
    resetDefaults,
    exportSettings,
    importSettings
};