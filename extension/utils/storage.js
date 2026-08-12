// Storage Utility Module
// Wrapper for chrome.storage API with promise-based interface and utilities

const STORAGE_UTILS = {
    // Storage areas
    AREAS: {
        SYNC: 'sync',
        LOCAL: 'local',
        MANAGED: 'managed'
    },

    // Default storage area
    DEFAULT_AREA: 'local',
    
    /**
     * Initialize storage utilities
     */
    init: function() {
        // Check if storage API is available
        if (!chrome || !chrome.storage) {
            console.warn('[Storage Utils] Chrome storage API not available');
            return false;
        }
        return true;
    },
    
    /**
     * Get data from storage
     * @param {string|string[]} keys - Key or array of keys to retrieve
     * @param {string} area - Storage area (default: local)
     * @returns {Promise<Object>} - Promise resolving with the requested data
     */
    get: function(keys, area = this.DEFAULT_AREA) {
        return new Promise((resolve, reject) => {
            try {
                // Normalize keys to array
                const keyArray = Array.isArray(keys) ? keys : (keys ? [keys] : []);
                
                // If no keys specified, get all items in the area
                if (keyArray.length === 0 || (keyArray.length === 1 && !keyArray[0])) {
                    chrome.storage[area].get(null, (result) => {
                        if (chrome.runtime.lastError) {
                            reject(new Error(chrome.runtime.lastError.message));
                        } else {
                            resolve(result);
                        }
                    });
                } else {
                    chrome.storage[area].get(keyArray, (result) => {
                        if (chrome.runtime.lastError) {
                            reject(new Error(chrome.runtime.lastError.message));
                        } else {
                            resolve(result);
                        }
                    });
                }
            } catch (error) {
                reject(error);
            }
        });
    },
    
    /**
     * Set data in storage
     * @param {Object} items - Key-value pairs to store
     * @param {string} area - Storage area (default: local)
     * @returns {Promise<void>} - Promise resolving when operation completes
     */
    set: function(items, area = this.DEFAULT_AREA) {
        return new Promise((resolve, reject) => {
            try {
                if (!items || typeof items !== 'object') {
                    throw new Error('Items must be a non-null object');
                }
                
                chrome.storage[area].set(items, () => {
                    if (chrome.runtime.lastError) {
                        reject(new Error(chrome.runtime.lastError.message));
                    } else {
                        resolve();
                    }
                });
            } catch (error) {
                reject(error);
            }
        });
    },
    
    /**
     * Remove data from storage
     * @param {string|string[]} keys - Key or array of keys to remove
     * @param {string} area - Storage area (default: local)
     * @returns {Promise<void>} - Promise resolving when operation completes
     */
    remove: function(keys, area = this.DEFAULT_AREA) {
        return new Promise((resolve, reject) => {
            try {
                const keyArray = Array.isArray(keys) ? keys : (keys ? [keys] : []);
                
                if (keyArray.length === 0) {
                    resolve(); // Nothing to remove
                    return;
                }
                
                chrome.storage[area].remove(keyArray, () => {
                    if (chrome.runtime.lastError) {
                        reject(new Error(chrome.runtime.lastError.message));
                    } else {
                        resolve();
                    }
                });
            } catch (error) {
                reject(error);
            }
        });
    },
    
    /**
     * Clear all data in a storage area
     * @param {string} area - Storage area (default: local)
     * @returns {Promise<void>} - Promise resolving when operation completes
     */
    clear: function(area = this.DEFAULT_AREA) {
        return new Promise((resolve, reject) => {
            try {
                chrome.storage[area].clear(() => {
                    if (chrome.runtime.lastError) {
                        reject(new Error(chrome.runtime.lastError.message));
                    } else {
                        resolve();
                    }
                });
            } catch (error) {
                reject(error);
            }
        });
    },
    
    /**
     * Get the total amount of storage used (in bytes)
     * @param {string} area - Storage area (default: local)
     * @returns {Promise<number>} - Promise resolving with bytes used
     */
    getBytesInUse: function(keys, area = this.DEFAULT_AREA) {
        return new Promise((resolve, reject) => {
            try {
                const keyArray = Array.isArray(keys) ? keys : (keys ? [keys] : undefined);
                chrome.storage[area].getBytesInUse(keyArray, (bytesUsed) => {
                    if (chrome.runtime.lastError) {
                        reject(new Error(chrome.runtime.lastError.message));
                        return;
                    }
                    resolve(bytesUsed);
                });
            } catch (error) {
                reject(error);
            }
        });
    },
    
    /**
     * Get available storage space (quota - usage)
     * @param {string} area - Storage area (default: local)
     * @returns {Promise<number>} - Promise resolving with available bytes
     */
    getAvailableSpace: function(area = this.DEFAULT_AREA) {
        return new Promise((resolve, reject) => {
            try {
                // Chrome storage quota is typically 5MB for local and 100KB for sync
                const quotas = {
                    [this.AREAS.LOCAL]: 5 * 1024 * 1024, // 5 MB
                    [this.AREAS.SYNC]: 100 * 1024, // 100 KB
                    [this.AREAS.MANAGED]: 0 // Read-only
                };
                
                const quota = quotas[area] || 0;
                
                // Get current usage
                this.getBytesInUse(null, area)
                    .then(used => {
                        const available = Math.max(0, quota - used);
                        resolve(available);
                    })
                    .catch(reject);
            } catch (error) {
                reject(error);
            }
        });
    },
    
    /**
     * Check if storage is available and working
     * @returns {Promise<boolean>} - Promise resolving with availability status
     */
    isAvailable: function() {
        return new Promise((resolve) => {
            try {
                // Try a simple get/set operation to test storage
                const testKey = `__storage_test_${Date.now()}`;
                this.set({[testKey]: true}, this.DEFAULT_AREA)
                    .then(() => {
                        return this.get(testKey, this.DEFAULT_AREA);
                    })
                    .then((result) => {
                        // Clean up test key
                        return this.remove(testKey, this.DEFAULT_AREA);
                    })
                    .then(() => {
                        resolve(true);
                    })
                    .catch(() => {
                        resolve(false);
                    });
            } catch (error) {
                resolve(false);
            }
        });
    },
    
    /**
     * Get all keys in a storage area
     * @param {string} area - Storage area (default: local)
     * @returns {Promise<string[]>} - Promise resolving with array of keys
     */
    getAllKeys: function(area = this.DEFAULT_AREA) {
        return new Promise((resolve, reject) => {
            try {
                chrome.storage[area].get(null, (result) => {
                    if (chrome.runtime.lastError) {
                        reject(new Error(chrome.runtime.lastError.message));
                        return;
                    }
                    resolve(Object.keys(result));
                });
            } catch (error) {
                reject(error);
            }
        });
    },
    
    /**
     * Batch multiple storage operations for efficiency
     * @param {Array<Object>} operations - Array of operation objects
     * @returns {Promise<void>} - Promise resolving when all operations complete
     */
    batch: function(operations) {
        return new Promise((resolve, reject) => {
            try {
                // Group operations by type and area
                const grouped = {
                    get: {},
                    set: {},
                    remove: {}
                };
                
                operations.forEach(op => {
                    const {type, area = this.DEFAULT_AREA, keys, items} = op;
                    if (!grouped[type][area]) {
                        grouped[type][area] = [];
                    }
                    grouped[type][area].push({keys, items});
                });
                
                // Execute all operations in parallel
                const promises = [];
                
                // Process gets
                for (const [area, ops] of Object.entries(grouped.get)) {
                    if (ops.length > 0) {
                        const keys = ops.flatMap(op => op.keys).filter(Boolean);
                        if (keys.length > 0) {
                            promises.push(this.get(keys, area));
                        }
                    }
                }
                
                // Process sets
                for (const [area, ops] of Object.entries(grouped.set)) {
                    if (ops.length > 0) {
                        const items = {};
                        ops.forEach(op => {
                            if (op.items) {
                                Object.assign(items, op.items);
                            }
                        });
                        if (Object.keys(items).length > 0) {
                            promises.push(this.set(items, area));
                        }
                    }
                }
                
                // Process removes
                for (const [area, ops] of Object.entries(grouped.remove)) {
                    if (ops.length > 0) {
                        const keys = ops.flatMap(op => op.keys).filter(Boolean);
                        if (keys.length > 0) {
                            promises.push(this.remove(keys, area));
                        }
                    }
                }
                
                // Wait for all operations to complete
                Promise.all(promises)
                    .then(() => resolve())
                    .catch(reject);
            } catch (error) {
                reject(error);
            }
        });
    }
};

// Initialize storage utilities
STORAGE_UTILS.init();

// Export for use in other modules
window.storageUtils = STORAGE_UTILS;