// DOM Utility Module
// Helper functions for working with the DOM in a safe and consistent way

const DOM_UTILS = {
    /**
     * Safely get an element by ID
     * @param {string} id - Element ID
     * @returns {HTMLElement|null} - Element or null if not found
     */
    getById: function(id) {
        if (!id || typeof id !== 'string') return null;
        return document.getElementById(id);
    },
    
    /**
     * Safely get elements by class name
     * @param {string} className - Class name
     * @returns {HTMLCollection} - Collection of elements
     */
    getByClassName: function(className) {
        if (!className || typeof className !== 'string') return document.getElementsByClassName('');
        return document.getElementsByClassName(className);
    },
    
    /**
     * Safely get elements by tag name
     * @param {string} tagName - Tag name
     * @returns {HTMLCollection} - Collection of elements
     */
    getByTagName: function(tagName) {
        if (!tagName || typeof tagName !== 'string') return document.getElementsByTagName('');
        return document.getElementsByTagName(tagName);
    },
    
    /**
     * Safely query elements using CSS selector
     * @param {string} selector - CSS selector
     * @returns {NodeList} - List of matching elements
     */
    querySelectorAll: function(selector) {
        if (!selector || typeof selector !== 'string') return [];
        try {
            return document.querySelectorAll(selector);
        } catch (e) {
            console.warn('[DOM Utils] Invalid selector:', selector);
            return [];
        }
    },
    
    /**
     * Safely query a single element using CSS selector
     * @param {string} selector - CSS selector
     * @returns {HTMLElement|null} - Element or null if not found
     */
    querySelector: function(selector) {
        if (!selector || typeof selector !== 'string') return null;
        try {
            return document.querySelector(selector);
        } catch (e) {
            console.warn('[DOM Utils] Invalid selector:', selector);
            return null;
        }
    },
    
    /**
     * Create an element with optional attributes and children
     * @param {string} tagName - Tag name for the element
     * @param {Object} options - Options for the element (attributes, children, etc.)
     * @returns {HTMLElement} - Created element
     */
    createElement: function(tagName, options = {}) {
        if (!tagName || typeof tagName !== 'string') {
            throw new Error('[DOM Utils] Invalid tag name');
        }
        
        const element = document.createElement(tagName);
        
        // Set attributes
        if (options.attributes) {
            Object.keys(options.attributes).forEach(key => {
                const value = options.attributes[key];
                if (value !== null && value !== undefined) {
                    element.setAttribute(key, value);
                }
            });
        }
        
        // Set properties
        if (options.properties) {
            Object.keys(options.properties).forEach(key => {
                const value = options.properties[key];
                if (value !== null && value !== undefined) {
                    try {
                        element[key] = value;
                    } catch (e) {
                        // Some properties can't be set directly, use attribute instead
                        element.setAttribute(key, value);
                    }
                }
            });
        }
        
        // Set innerHTML
        if (options.html) {
            element.innerHTML = options.html;
        }
        
        // Set text content
        if (options.text) {
            element.textContent = options.text;
        }
        
        // Add children
        if (options.children) {
            if (Array.isArray(options.children)) {
                options.children.forEach(child => {
                    if (child instanceof Node) {
                        element.appendChild(child);
                    } else if (typeof child === 'string') {
                        element.appendChild(document.createTextNode(child));
                    }
                });
            } else if (options.children instanceof Node) {
                element.appendChild(options.children);
            }
        }
        
        // Set CSS styles
        if (options.styles) {
            Object.keys(options.styles).forEach(key => {
                const value = options.styles[key];
                if (value !== null && value !== undefined) {
                    element.style[key] = value;
                }
            });
        }
        
        // Set class name
        if (options.className) {
            element.className = options.className;
        }
        
        // Set ID
        if (options.id) {
            element.id = options.id;
        }
        
        return element;
    },
    
    /**
     * Add an event listener with safe error handling
     * @param {HTMLElement} element - Element to attach listener to
     * @param {string} event - Event name
     * @param {Function} handler - Event handler function
     * @param {Object} options - Event listener options
     * @returns {Function} - Cleanup function to remove the listener
     */
    addEventListener: function(element, event, handler, options = {}) {
        if (!element || !event || !handler) {
            console.warn('[DOM Utils] Invalid arguments for addEventListener');
            return () => {};
        }
        
        const wrappedHandler = (e) => {
            try {
                handler(e);
            } catch (error) {
                console.error(`[DOM Utils] Error in event handler for ${event}:`, error);
            }
        };
        
        element.addEventListener(event, wrappedHandler, options);
        
        // Return cleanup function
        return () => {
            element.removeEventListener(event, wrappedHandler, options);
        };
    },
    
    /**
     * Remove an element from the DOM safely
     * @param {HTMLElement} element - Element to remove
     * @returns {boolean} - True if element was removed
     */
    removeElement: function(element) {
        if (!element || !element.parentNode) return false;
        element.parentNode.removeChild(element);
        return true;
    },
    
    /**
     * Check if an element is visible in the viewport
     * @param {HTMLElement} element - Element to check
     * @returns {boolean} - True if element is visible
     */
    isVisible: function(element) {
        if (!element || !element.isConnected) return false;
        
        const rect = element.getBoundingClientRect();
        return (
            rect.top >= 0 &&
            rect.left >= 0 &&
            rect.bottom <= (window.innerHeight || document.documentElement.clientHeight) &&
            rect.right <= (window.innerWidth || document.documentElement.clientWidth)
        );
    },
    
    /**
     * Get element position relative to viewport
     * @param {HTMLElement} element - Element to check
     * @returns {Object} - Position object with top, left, width, height
     */
    getPosition: function(element) {
        if (!element) return null;
        
        const rect = element.getBoundingClientRect();
        return {
            top: rect.top + window.pageYOffset,
            left: rect.left + window.pageXOffset,
            width: rect.width,
            height: rect.height,
            bottom: rect.bottom + window.pageYOffset,
            right: rect.right + window.pageXOffset
        };
    },
    
    /**
     * Wait for an element to appear in the DOM
     * @param {string} selector - CSS selector to wait for
     * @param {number} timeout - Timeout in milliseconds
     * @returns {Promise<HTMLElement|null>} - Promise that resolves with the element or null
     */
    waitForElement: function(selector, timeout = 5000) {
        return new Promise((resolve) => {
            const startTime = Date.now();
            
            const check = () => {
                const element = document.querySelector(selector);
                if (element) {
                    resolve(element);
                    return;
                }
                
                if (Date.now() - startTime >= timeout) {
                    resolve(null);
                    return;
                }
                
                requestAnimationFrame(check);
            };
            
            requestAnimationFrame(check);
        });
    },
    
    /**
     * Debounce a function call
     * @param {Function} func - Function to debounce
     * @param {number} wait - Wait time in milliseconds
     * @param {boolean} immediate - Whether to execute immediately on leading edge
     * @returns {Function} - Debounced function
     */
    debounce: function(func, wait, immediate = false) {
        let timeout;
        return function(...args) {
            const context = this;
            const later = () => {
                timeout = null;
                if (!immediate) func.apply(context, args);
            };
            const callNow = immediate && !timeout;
            clearTimeout(timeout);
            timeout = setTimeout(later, wait);
            if (callNow) func.apply(context, args);
        };
    },
    
    /**
     * Throttle a function call
     * @param {Function} func - Function to throttle
     * @param {number} limit - Time limit in milliseconds
     * @returns {Function} - Throttled function
     */
    throttle: function(func, limit) {
        let inThrottle;
        return function() {
            const args = arguments;
            const context = this;
            if (!inThrottle) {
                func.apply(context, args);
                inThrottle = true;
                setTimeout(() => inThrottle = false, limit);
            }
        };
    }
};

// Export for use in other modules
window.domUtils = DOM_UTILS;