// Confidence Utility Module
// Functions for calculating, interpreting, and working with confidence scores

const CONFIDENCE_UTILS = {
    // Confidence thresholds and labels
    THRESHOLDS: {
        EXCELLENT: 0.95,
        HIGH: 0.85,
        MEDIUM: 0.70,
        LOW: 0.60,
        VERY_LOW: 0.0
    },
    
    // Label mappings for different confidence ranges
    LABELS: {
        EXCELLENT: 'Excellent',
        HIGH: 'High',
        MEDIUM: 'Medium',
        LOW: 'Low',
        VERY_LOW: 'Very Low'
    },
    
    // Color mappings for different confidence ranges (for UI)
    COLORS: {
        EXCELLENT: '#4caf50', // Green
        HIGH: '#8bc34a',      // Light green
        MEDIUM: '#ffc107',    // Amber
        LOW: '#ff9800',       // Orange
        VERY_LOW: '#f44336'   // Red
    },
    
    /**
     * Get a label for a confidence score
     * @param {number} score - Confidence score (0.0 to 1.0)
     * @returns {string} - Label for the confidence level
     */
    getLabel: function(score) {
        if (score >= this.THRESHOLDS.EXCELLENT) return this.LABELS.EXCELLENT;
        if (score >= this.THRESHOLDS.HIGH) return this.LABELS.HIGH;
        if (score >= this.THRESHOLDS.MEDIUM) return this.LABELS.MEDIUM;
        if (score >= this.THRESHOLDS.LOW) return this.LABELS.LOW;
        return this.LABELS.VERY_LOW;
    },
    
    /**
     * Get a color for a confidence score
     * @param {number} score - Confidence score (0.0 to 1.0)
     * @returns {string} - Hex color code
     */
    getColor: function(score) {
        if (score >= this.THRESHOLDS.EXCELLENT) return this.COLORS.EXCELLENT;
        if (score >= this.THRESHOLDS.HIGH) return this.COLORS.HIGH;
        if (score >= this.THRESHOLDS.MEDIUM) return this.COLORS.MEDIUM;
        if (score >= this.THRESHOLDS.LOW) return this.COLORS.LOW;
        return this.COLORS.VERY_LOW;
    },
    
    /**
     * Get a CSS class name for a confidence score
     * @param {number} score - Confidence score (0.0 to 1.0)
     * @returns {string} - CSS class name
     */
    getCssClass: function(score) {
        if (score >= this.THRESHOLDS.EXCELLENT) return 'confidence-excellent';
        if (score >= this.THRESHOLDS.HIGH) return 'confidence-high';
        if (score >= this.THRESHOLDS.MEDIUM) return 'confidence-medium';
        if (score >= this.THRESHOLDS.LOW) return 'confidence-low';
        return 'confidence-very-low';
    },
    
    /**
     * Format a confidence score as a percentage string
     * @param {number} score - Confidence score (0.0 to 1.0)
     * @param {number} decimalPlaces - Number of decimal places (default: 1)
     * @returns {string} - Formatted percentage string
     */
    formatPercentage: function(score, decimalPlaces = 1) {
        const multiplier = Math.pow(10, decimalPlaces);
        return `${Math.round(score * 100 * multiplier) / multiplier}%`;
    },
    
    /**
     * Determine if a confidence score meets a minimum threshold
     * @param {number} score - Confidence score to check
     * @param {number} threshold - Minimum threshold (default: 0.85)
     * @returns {boolean} - True if score meets or exceeds threshold
     */
    meetsThreshold: function(score, threshold = 0.85) {
        return score >= threshold;
    },
    
    /**
     * Calculate a weighted average of confidence scores
     * @param {Array<Object>} scores - Array of {score: number, weight: number} objects
     * @returns {number} - Weighted average confidence score
     */
    weightedAverage: function(scores) {
        if (!scores || scores.length === 0) return 0;
        
        let totalWeight = 0;
        let weightedSum = 0;
        
        for (const item of scores) {
            const score = item.score !== undefined ? item.score : 0;
            const weight = item.weight !== undefined ? item.weight : 1;
            
            weightedSum += score * weight;
            totalWeight += weight;
        }
        
        return totalWeight > 0 ? weightedSum / totalWeight : 0;
    },
    
    /**
     * Apply a confidence adjustment based on contextual factors
     * @param {number} baseScore - Base confidence score
     * @param {Object} factors - Adjustment factors
     * @returns {number} - Adjusted confidence score (clamped to 0-1 range)
     */
    adjust: function(baseScore, factors = {}) {
        let adjusted = baseScore;
        
        // Apply various adjustment factors
        if (factors.formCompletion !== undefined) {
            // Bonus for highly completed forms
            adjusted += (factors.formCompletion - 0.5) * 0.1; // +/- 0.05 max
        }
        
        if (factors.fieldMatchQuality !== undefined) {
            // Bonus/Penalty based on field match quality
            adjusted *= (0.5 + factors.fieldMatchQuality * 0.5); // Scale 0.5-1.5
        }
        
        if (factors.dataQuality !== undefined) {
            // Bonus/Penalty based on data quality
            adjusted *= (0.7 + factors.dataQuality * 0.3); // Scale 0.7-1.0
        }
        
        // Clamp to valid range
        return Math.max(0.0, Math.min(1.0, adjusted));
    },
    
    /**
     * Get a description of what a confidence score means
     * @param {number} score - Confidence score
     * @returns {string} - Human-readable description
     */
    getDescription: function(score) {
        const label = this.getLabel(score);
        const percentage = this.formatPercentage(score);
        
        switch (true) {
            case score >= this.THRESHOLDS.EXCELLENT:
                return `Very high confidence (${percentage}) - Nearly certain match`;
            case score >= this.THRESHOLDS.HIGH:
                return `High confidence (${percentage}) - Strong match with minor uncertainties`;
            case score >= this.THRESHOLDS.MEDIUM:
                return `Moderate confidence (${percentage}) - Good match but verification recommended`;
            case score >= this.THRESHOLDS.LOW:
                return `Low confidence (${percentage}) - Possible match but likely needs manual review`;
            default:
                return `Very low confidence (${percentage}) - Unlikely match, manual input recommended`;
        }
    },
    
    /**
     * Validate that a value is a valid confidence score
     * @param {*} value - Value to validate
     * @returns {boolean} - True if valid confidence score (0.0-1.0)
     */
    isValid: function(value) {
        return typeof value === 'number' && 
               !isNaN(value) && 
               value >= 0.0 && 
               value <= 1.0;
    },
    
    /**
     * Clamp a value to the valid confidence score range
     * @param {number} value - Value to clamp
     * @returns {number} - Clamped value between 0.0 and 1.0
     */
    clamp: function(value) {
        return Math.max(0.0, Math.min(1.0, value));
    }
};

// Export for use in other modules
window.confidenceUtils = CONFIDENCE_UTILS;