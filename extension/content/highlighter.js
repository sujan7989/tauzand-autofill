// Content Script: Field Highlighter
// Handles visual feedback for form fields with tooltips and animations

// Prevent duplicate initialization
if (window.__highlighterInitialized) {
    console.log('[highlighter] Already initialized, skipping');
} else {
    window.__highlighterInitialized = true;
    console.log('[Content] highlighter.js loaded');

class FieldHighlighter {
    constructor() {
        // Configuration
        this.config = {
            highlightDelay: 100, // ms delay before highlighting
            fadeDuration: 300, // ms for fade animations
            zIndex: 2147483647, // Highest possible z-index
            maxTooltips: 50 // Limit to prevent memory issues
        };
        
        // State tracking
        this.state = {
            highlights: new Map(), // element -> highlight element
            tooltips: new Map(), // element -> tooltip element
            mutationObserver: null,
            isObserving: false,
            highlightedCount: 0
        };
    }
    
    // Initialize the highlighter
    init() {
        this.setupStyles();
        this.startObserving();
    }
    
    // Create CSS styles for highlighting
    setupStyles() {
        if (document.getElementById('tauzand-highlighter-styles')) return;
        
        const style = document.createElement('style');
        style.id = 'tauzand-highlighter-styles';
        style.textContent = `
            .tauzand-highlight {
                position: fixed;
                pointer-events: none;
                border-radius: 4px;
                z-index: 2147483647;
                transition: all 0.2s ease;
                box-shadow: 0 0 0 3px rgba(0,0,0,0.1);
            }
            
            .tauzand-highlight-auto {
                background-color: rgba(76, 175, 80, 0.2);
                border: 2px solid rgba(76, 175, 80, 0.7);
            }
            
            .tauzand-highlight-review {
                background-color: rgba(255, 193, 7, 0.2);
                border: 2px solid rgba(255, 193, 7, 0.7);
            }
            
            .tauzand-highlight-unmapped {
                background-color: rgba(244, 67, 54, 0.2);
                border: 2px solid rgba(244, 67, 54, 0.7);
            }
            
            .tauzand-tooltip {
                position: fixed;
                background: rgba(0, 0, 0, 0.8);
                color: white;
                padding: 4px 8px;
                border-radius: 4px;
                font-size: 12px;
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                z-index: 2147483647;
                pointer-events: none;
                white-space: nowrap;
                max-width: 250px;
                word-wrap: break-word;
                opacity: 0;
                transform: translateY(-10px);
                transition: opacity 0.2s ease, transform 0.2s ease;
            }
            
            .tauzand-tooltip.visible {
                opacity: 0.9;
                transform: translateY(-5px);
            }
            
            .tauzand-highlight-pulse {
                animation: tauzand-pulse 2s ease-in-out infinite;
            }
            
            @keyframes tauzand-pulse {
                0% {
                    box-shadow: 0 0 0 0 rgba(255,255,255,0.4);
                }
                70% {
                    box-shadow: 0 0 0 10px rgba(255,255,255,0);
                }
                100% {
                    box-shadow: 0 0 0 0 rgba(255,255,255,0.4);
                }
            }
            
            .tauzand-field-icon {
                position: absolute;
                top: -8px;
                right: -8px;
                width: 16px;
                height: 16px;
                border-radius: 50%;
                background: white;
                border: 2px solid;
                display: flex;
                align-items: center;
                justify-content: center;
                font-size: 10px;
                font-weight: bold;
                z-index: 2147483649;
            }
            
            .tauzand-field-icon-check {
                background: #4caf50;
                color: white;
                border-color: #4caf50;
            }
            
            .tauzand-field-icon-warning {
                background: #ff9800;
                color: white;
                border-color: #ff9800;
            }
            
            .tauzand-field-icon-error {
                background: #f44336;
                color: white;
                border-color: #f44336;
            }
        `;
        document.head.appendChild(style);
    }
    
    // Start observing DOM changes for new fields
    startObserving() {
        if (this.state.isObserving) return;
        
        this.state.mutationObserver = new MutationObserver((mutations) => {
            // Debounce rapid mutations
            if (this.state._timeout) clearTimeout(this.state._timeout);
            this.state._timeout = setTimeout(() => {
                this.handleMutations(mutations);
            }, 100);
        });
        
        this.state.mutationObserver.observe(document.body, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ['class', 'style', 'disabled', 'readonly']
        });
        
        this.state.isObserving = true;
    }

    // Stop observing
    stopObserving() {
        if (this.state.mutationObserver) {
            this.state.mutationObserver.disconnect();
            this.state.isObserving = false;
        }
    }
    
    // Handle DOM mutations
    handleMutations(mutations) {
        const addedNodes = [];
        
        for (const mutation of mutations) {
            if (mutation.type === 'childList') {
                addedNodes.push(...Array.from(mutation.addedNodes));
            } else if (mutation.type === 'attributes') {
                // Check if attribute changes affect field visibility or interactability
                const target = mutation.target;
                if (target.matches('input, select, textarea, button, select')) {
                    this.handleFieldAttributeChange(target, mutation.attributeName);
                }
            }
        }
        
        // Process newly added nodes
        for (const node of addedNodes) {
            if (node.nodeType === Node.ELEMENT_NODE) {
                // Check if it's a form element
                if (node.matches('input, select, textarea, button')) {
                    this.checkAndHighlightNode(node);
                }
                // Check if it contains form elements
                const formElements = node.querySelectorAll
                    ? node.querySelectorAll('input, select, textarea, button')
                    : [];
                for (const element of formElements) {
                    this.checkAndHighlightNode(element);
                }
            }
        }
    }

    // Handle attribute changes on existing fields
    handleFieldAttributeChange(element, attributeName) {
        if (!['disabled', 'readonly', 'style', 'class'].includes(attributeName)) return;

        const isCurrentlyHighlighted = this.state.highlights.has(element);
        // shouldHighlightField is not defined " just remove stale highlights when
        // fields become disabled/readonly/hidden
        const shouldBeHighlighted = !element.disabled && !element.readOnly &&
            window.getComputedStyle(element).display !== 'none';

        if (isCurrentlyHighlighted && !shouldBeHighlighted) {
            this.removeHighlight(element);
        }
    }

    // Check if an element should be highlighted and apply highlight
    checkAndHighlightNode(element) {
        if (!element || !element.offsetParent) return; // Skip if not visible

        // Only highlight form elements
        if (!element.matches('input, select, textarea, button')) return;
        
        // In a real implementation, this would get highlighting data from
        // the form analysis results. For now, we'll rely on messages from
        // other scripts to tell us what to highlight.
    }

    // Highlight a field with specific styling and tooltip
    highlightField(element, options = {}) {
        if (!element || !element.isConnected) return;

        const {
            type = 'info', // 'auto', 'review', 'unmapped', 'info', 'success', 'warning', 'error'
            text = '',
            position = 'top', // 'top', 'bottom', 'left', 'right'
            offset = 8,
            showIcon = true,
            pulse = false
        } = options;

        // Remove existing highlight if any
        this.removeHighlight(element);

        // Get element position
        const rect = element.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) return; // Skip invisible elements
        
        // Create highlight element
        const highlight = document.createElement('div');
        highlight.className = `tauzand-highlight tauzand-highlight-${type}`;
        if (pulse) highlight.classList.add('tauzand-highlight-pulse');
        
        // Determine border color from type
        const colorMap = {
            'auto':    'rgba(76, 175, 80, 0.8)',
            'success': 'rgba(76, 175, 80, 0.8)',
            'review':  'rgba(255, 193, 7, 0.8)',
            'warning': 'rgba(255, 193, 7, 0.8)',
            'unmapped':'rgba(244, 67, 54, 0.8)',
            'error':   'rgba(244, 67, 54, 0.8)',
        };
        const borderColor = colorMap[type] || 'rgba(0, 123, 255, 0.6)';

        // Position " fixed is viewport-relative, no scroll offsets needed
        highlight.style.left = `${rect.left}px`;
        highlight.style.top = `${rect.top}px`;
        highlight.style.width = `${rect.width}px`;
        highlight.style.height = `${rect.height}px`;

        // Thin border only " no filled background so form is readable
        highlight.style.border = `2px solid ${borderColor}`;
        highlight.style.backgroundColor = 'transparent';
        highlight.style.boxShadow = `inset 0 0 0 1px ${borderColor}`;
        
        document.body.appendChild(highlight);
        this.state.highlights.set(element, highlight);
        this.state.highlightedCount++;

        // Add tooltip if text provided
        if (text.trim() !== '') {
            this.createTooltip(element, text, position, offset, type);
        }

        // Add icon if requested
        if (showIcon) {
            this.addFieldIndicator(element, type);
        }

        return highlight;
    }

    // Create a tooltip for an element
    createTooltip(element, text, position = 'top', offset = 8, type = 'info') {
        if (!element || !element.isConnected) return null;

        // Remove existing tooltip
        this.removeTooltip(element);
        
        const tooltip = document.createElement('div');
        tooltip.className = 'tauzand-tooltip';
        tooltip.textContent = text;
        
        // Set tooltip styling based on type
        let backgroundColor = 'rgba(0, 0, 0, 0.8)';
        let textColor = '#ffffff';
        
        switch (type) {
            case 'success':
                backgroundColor = 'rgba(76, 175, 80, 0.9)';
                break;
            case 'warning':
                backgroundColor = 'rgba(255, 193, 7, 0.9)';
                break;
            case 'error':
                backgroundColor = 'rgba(244, 67, 54, 0.9)';
                break;
            case 'info':
                backgroundColor = 'rgba(0, 0, 0, 0.8)';
                break;
        }
        
        tooltip.style.backgroundColor = backgroundColor;
        tooltip.style.color = textColor;
        
        // Position the tooltip
        const updateTooltipPosition = () => {
            if (!element || !element.isConnected || !tooltip.parentNode) {
                this.removeTooltip(element);
                return;
            }
            
            const rect = element.getBoundingClientRect();
            let top, left;
            
            // position:fixed is viewport-relative " do NOT add pageYOffset/pageXOffset.
            switch (position) {
                case 'top':
                    top = rect.top - tooltip.offsetHeight - offset;
                    left = rect.left + (rect.width / 2) - (tooltip.offsetWidth / 2);
                    break;
                case 'bottom':
                    top = rect.bottom + offset;
                    left = rect.left + (rect.width / 2) - (tooltip.offsetWidth / 2);
                    break;
                case 'left':
                    top = rect.top + (rect.height / 2) - (tooltip.offsetHeight / 2);
                    left = rect.left - tooltip.offsetWidth - offset;
                    break;
                case 'right':
                    top = rect.top + (rect.height / 2) - (tooltip.offsetHeight / 2);
                    left = rect.right + offset;
                    break;
            }
            
            // Keep tooltip within viewport
            top = Math.max(10, Math.min(top, window.innerHeight - tooltip.offsetHeight - 10));
            left = Math.max(10, Math.min(left, window.innerWidth - tooltip.offsetWidth - 10));
            
            tooltip.style.top = `${top}px`;
            tooltip.style.left = `${left}px`;
            
            // Trigger reflow for animation
            void tooltip.offsetWidth;
            tooltip.classList.add('visible');
        };
        
        // Initial positioning
        updateTooltipPosition();

        // Update on scroll or resize
        const updateListener = () => updateTooltipPosition();
        window.addEventListener('scroll', updateListener, true);
        window.addEventListener('resize', updateListener, true);

        // Store listener for cleanup
        tooltip._positionListener = updateListener;

        document.body.appendChild(tooltip);
        this.state.tooltips.set(element, tooltip);

        return tooltip;
    }

    // Add a small indicator icon to a field
    addFieldIndicator(element, type) {
        if (!element || !element.isConnected) return null;

        // Remove existing indicator first
        this.removeFieldIndicator(element);

        // CRITICAL: NEVER wrap/move the original form element.
        // React/Workday/Greenhouse/Lever rely on stable DOM refs.
        // Use a fixed-position overlay icon anchored to the element's bounding rect.
        const icon = document.createElement('div');
        icon.className = `tauzand-field-icon tauzand-field-icon-${this.getIconType(type)}`;

        // Set icon content based on type
        let iconText = '?';
        switch (type) {
            case 'auto':
            case 'success':
                iconText = '"';
                break;
            case 'review':
            case 'warning':
                iconText = '!';
                break;
            case 'unmapped':
            case 'error':
                iconText = '*';
                break;
            default:
                iconText = 'i';
        }

        icon.textContent = iconText;

        // Fixed-position overlay (not a wrapper). Anchored to element rect.
        icon.style.position = 'fixed';
        icon.style.zIndex = '2147483649';
        icon.style.pointerEvents = 'none';
        icon.style.width = '18px';
        icon.style.height = '18px';
        icon.style.borderRadius = '50%';
        icon.style.display = 'flex';
        icon.style.alignItems = 'center';
        icon.style.justifyContent = 'center';
        icon.style.fontSize = '11px';
        icon.style.fontWeight = 'bold';
        icon.style.boxShadow = '0 1px 3px rgba(0,0,0,0.3)';
        icon.style.background = '#fff';

        // Position based on element rect " position:fixed, no scroll offsets needed.
        const positionIcon = () => {
            if (!element.isConnected) {
                this.removeFieldIndicator(element);
                return;
            }
            const rect = element.getBoundingClientRect();
            icon.style.top = `${rect.top - 6}px`;
            icon.style.left = `${rect.right - 12}px`;
        };
        positionIcon();

        // Track scroll/resize once per element (added when highlighting " removed on clear)
        const updateListener = () => positionIcon();
        icon._positionListener = updateListener;
        window.addEventListener('scroll', updateListener, true);
        window.addEventListener('resize', updateListener, true);

        if (document.body) {
            document.body.appendChild(icon);
        }
        // Tag the icon so removeFieldIndicator can locate it for cleanup
        icon._attachedTo = element;
        // Also store the icon on the element for fast lookup in clearAll
        if (!element.__tauzandIcon) {
            element.__tauzandIcon = [];
        }
        element.__tauzandIcon.push(icon);
        return icon;
    }

    // Get icon CSS class based on type
    getIconType(type) {
        switch (type) {
            case 'auto':
            case 'success':
                return 'check';
            case 'warning':
                return 'warning';
            case 'unmapped':
            case 'error':
                return 'error';
            default:
                return 'info';
        }
    }

    // Remove highlight from an element
    removeHighlight(element) {
        const highlight = this.state.highlights.get(element);
        if (highlight) {
            if (highlight.parentNode) {
                // Fade out before removing
                highlight.style.opacity = '0';
                setTimeout(() => {
                    if (highlight.parentNode) {
                        highlight.parentNode.removeChild(highlight);
                    }
                }, 200);
            }
            this.state.highlights.delete(element);
            this.state.highlightedCount--;
        }
    }

    // Remove tooltip from an element
    removeTooltip(element) {
        const tooltip = this.state.tooltips.get(element);
        if (tooltip) {
            // Remove event listeners
            if (tooltip._positionListener) {
                window.removeEventListener('scroll', tooltip._positionListener, true);
                window.removeEventListener('resize', tooltip._positionListener, true);
            }

            // Fade out before removing
            tooltip.style.opacity = '0';
            setTimeout(() => {
                if (tooltip.parentNode) {
                    tooltip.parentNode.removeChild(tooltip);
                }
            }, 200);

            this.state.tooltips.delete(element);
        }
    }

    // Remove field indicator from an element
    removeFieldIndicator(element) {
        // Fast path: use element.__tauzandIcon array (set in addFieldIndicator)
        const icons = element.__tauzandIcon || [];
        icons.forEach(icon => {
            if (icon._positionListener) {
                window.removeEventListener('scroll', icon._positionListener, true);
                window.removeEventListener('resize', icon._positionListener, true);
            }
            if (icon.parentNode) icon.parentNode.removeChild(icon);
        });
        element.__tauzandIcon = [];
    }

    // Clear all highlights and tooltips
    clearAll() {
        // Remove all highlights
        this.state.highlights.forEach((highlight, element) => {
            this.removeHighlight(element);
        });

        // Remove all tooltips
        this.state.tooltips.forEach((tooltip, element) => {
            this.removeTooltip(element);
        });

        // Reset counters
        this.state.highlightedCount = 0;
    }

    // Get current highlighting stats
    getStats() {
        return {
            highlightedElements: this.state.highlights.size,
            activeTooltips: this.state.tooltips.size,
            isObserving: this.state.isObserving
        };
    }
};

// Create instance
const highlighter = new FieldHighlighter();

// Initialize when script loads
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => highlighter.init());
} else {
    highlighter.init();
}

// Export for use by other modules
window.fieldHighlighter = highlighter;

// Listen for messages to trigger highlighting
console.log('[highlighter] Message listener registered');

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.type === 'HIGHLIGHT_FIELD') {
        const highlight = highlighter.highlightField(
            document.elementFromPoint(request.x, request.y) || 
            document.querySelector(`[data-field-id="${request.fieldId}"]`) ||
            document.getElementById(request.elementId),
            request.options
        );
        sendResponse({success: true, highlight: !!highlight});
        return true;
    }
    
    if (request.type === 'HIGHLIGHT_FIELDS_BATCH') {
        const highlights = [];
        for (const fieldSpec of request.fields) {
            const element = document.querySelector(fieldSpec.selector) || 
                           document.getElementById(fieldSpec.id);
            if (element) {
                const highlight = highlighter.highlightField(element, fieldSpec.options);
                if (highlight) highlights.push(true);
            }
        }
        sendResponse({success: true, highlightedCount: highlights.length});
        return true;
    }
    
    if (request.type === 'CLEAR_HIGHLIGHTS') {
        highlighter.clearAll();
        sendResponse({success: true});
        return true;
    }
    
    if (request.type === 'GET_HIGHLIGHT_STATS') {
        sendResponse({
            success: true,
            stats: highlighter.getStats()
        });
        return true;
    }
    
    return false;
});

// Close the initialization guard
}
