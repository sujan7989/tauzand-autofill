// Logger Utility Module
// Centralized logging with different levels and formatting

const LOGGER = {
    // Log levels
    LEVELS: {
        OFF: 0,
        ERROR: 1,
        WARN: 2,
        INFO: 3,
        DEBUG: 4
    },
    
    // Default configuration
    config: {
        level: 3, // Default to INFO level
        timestamp: true,
        tag: 'TauzandExtension',
        // Enable/disable specific types of logging
        enableConsole: true,
        enableStorage: false, // Could store logs in chrome.storage for debugging
        maxStoredLogs: 1000
    },
    
    // Internal log storage (for debug purposes)
    _logStore: [],
    
    /**
     * Initialize the logger
     */
    init: function() {
        // Load logger settings from storage if available
        chrome.storage.local.get(['loggerLevel', 'loggerEnabled'], (result) => {
            if (result.loggerLevel !== undefined) {
                this.config.level = result.loggerLevel;
            }
            if (result.loggerEnabled !== undefined) {
                this.config.enableConsole = result.loggerEnabled;
            }
        });
        
        console.log('[Logger] Initialized with level:', this.config.level);
    },
    
    /**
     * Log an error message
     * @param {string} message - Message to log
     * @param {Object} context - Additional context information
     */
    error: function(message, context = {}) {
        if (this.config.level >= this.LEVELS.ERROR) {
            this._log(this.LEVELS.ERROR, 'ERROR', message, context);
        }
    },
    
    /**
     * Log a warning message
     * @param {string} message - Message to log
     * @param {Object} context - Additional context information
     */
    warn: function(message, context = {}) {
        if (this.config.level >= this.LEVELS.WARN) {
            this._log(this.LEVELS.WARN, 'WARN', message, context);
        }
    },
    
    /**
     * Log an info message
     * @param {string} message - Message to log
     * @param {Object} context - Additional context information
     */
    info: function(message, context = {}) {
        if (this.config.level >= this.LEVELS.INFO) {
            this._log(this.LEVELS.INFO, 'INFO', message, context);
        }
    },
    
    /**
     * Log a debug message
     * @param {string} message - Message to log
     * @param {Object} context - Additional context information
     */
    debug: function(message, context = {}) {
        if (this.config.level >= this.LEVELS.DEBUG) {
            this._log(this.LEVELS.DEBUG, 'DEBUG', message, context);
        }
    },
    
    /**
     * Internal logging method
     * @param {number} level - Log level
     * @param {string} levelStr - Level string
     * @param {string} message - Message to log
     * @param {Object} context - Additional context information
     */
    _log: function(level, levelStr, message, context) {
        // Format the log message
        const timestamp = this.config.timestamp ? new Date().toISOString() : '';
        const tag = this.config.tag || 'TauzandExtension';
        
        let logMessage = `[${tag}] [${levelStr}] ${timestamp} ${message}`;
        
        // Add context if provided
        if (context && Object.keys(context).length > 0) {
            logMessage += ` | Context: ${JSON.stringify(context)}`;
        }
        
        // Store in internal log if enabled
        if (this.config.enableStorage) {
            this._storeLog(logMessage);
        }
        
        // Output to console if enabled
        if (this.config.enableConsole) {
            switch (level) {
                case this.LEVELS.ERROR:
                    console.error(logMessage);
                    break;
                case this.LEVELS.WARN:
                    console.warn(logMessage);
                    break;
                case this.LEVELS.INFO:
                    console.log(logMessage);
                    break;
                case this.LEVELS.DEBUG:
                    console.debug(logMessage);
                    break;
                default:
                    console.log(logMessage);
            }
        }
    },
    
    /**
     * Store a log message in internal storage
     * @param {string} message - Log message to store
     */
    _storeLog: function(message) {
        this._logStore.push({
            timestamp: new Date().toISOString(),
            message: message
        });
        
        // Trim to max size
        if (this._logStore.length > this.config.maxStoredLogs) {
            this._logStore = this._logStore.slice(-this.config.maxStoredLogs);
        }
    },
    
    /**
     * Get stored logs
     * @returns {Array} - Array of stored log entries
     */
    getStoredLogs: function() {
        return [...this._logStore];
    },
    
    /**
     * Clear stored logs
     */
    clearStoredLogs: function() {
        this._logStore = [];
    },
    
    /**
     * Update logger configuration
     * @param {Object} newConfig - New configuration options
     */
    setConfig: function(newConfig) {
        Object.assign(this.config, newConfig);
        
        // Save to persistence if needed
        if (newConfig.level !== undefined || newConfig.enableConsole !== undefined) {
            chrome.storage.local.set({
                loggerLevel: newConfig.level,
                loggerEnabled: newConfig.enableConsole
            });
        }
    },
    
    /**
     * Set the log level
     * @param {number} level - Log level to set
     */
    setLevel: function(level) {
        this.config.level = level;
        chrome.storage.local.set({loggerLevel: level});
    },
    
    /**
     * Enable or disable console logging
     * @param {boolean} enabled - Whether to enable console logging
     */
    setConsoleLogging: function(enabled) {
        this.config.enableConsole = enabled;
        chrome.storage.local.set({loggerEnabled: enabled});
    }
};

// Initialize when the script loads
LOGGER.init();

// Export for use in other modules
window.logger = LOGGER;