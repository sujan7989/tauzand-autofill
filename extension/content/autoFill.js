// autoFill.js - Generic autofill for non-platform-specific sites
// Handles PERFORM_AUTO_FILL messages and fills fields using field mappings

if (window.__autoFillInitialized) {
    console.log('[AutoFill] already initialized, skipping');
} else {
window.__autoFillInitialized = true;

// "" Helper: delay """""""""""""""""""""""""""""""""""""""""""""
var delay = window.delay || function(ms) { return new Promise(function(r) { setTimeout(r, ms); }); };

// "" Helper: get label for an element """""""""""""""""""""""""
function getLabelText(el) {
    if (!el) return '';
    // Try label[for=id]
    if (el.id) {
        var lbl = document.querySelector('label[for="' + el.id + '"]');
        if (lbl) return lbl.textContent.trim();
    }
    // Try aria-label
    if (el.getAttribute('aria-label')) return el.getAttribute('aria-label').trim();
    // Try aria-labelledby
    var lblId = el.getAttribute('aria-labelledby');
    if (lblId) {
        var lblEl = document.getElementById(lblId);
        if (lblEl) return lblEl.textContent.trim();
    }
    // Try placeholder
    if (el.placeholder) return el.placeholder.trim();
    // Try name
    if (el.name) return el.name;
    return '';
}

// "" Helper: fill a field with a value """"""""""""""""""""""""
function fillField(el, value) {
    if (!el || !value) return false;
    try {
        // Use native setter to bypass React's synthetic events
        var proto = el.tagName === 'TEXTAREA'
            ? window.HTMLTextAreaElement.prototype
            : window.HTMLInputElement.prototype;
        var nativeDesc = Object.getOwnPropertyDescriptor(proto, 'value');
        if (nativeDesc && nativeDesc.set) {
            nativeDesc.set.call(el, value);
        } else {
            el.value = value;
        }
        el.dispatchEvent(new Event('input',  { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        el.dispatchEvent(new Event('blur',   { bubbles: true }));
        return true;
    } catch (e) {
        try { el.value = value; el.dispatchEvent(new Event('change', { bubbles: true })); return true; } catch (e2) {}
        return false;
    }
}

// "" Helper: find element by selector or label """""""""""""""""
function findElement(mapping) {
    var el = null;

    // Try by fieldId
    if (mapping.fieldId) {
        el = document.getElementById(mapping.fieldId);
        if (el) return el;
    }

    // Try by selector
    if (mapping.selector) {
        try {
            el = document.querySelector(mapping.selector);
            if (el) return el;
        } catch (e) {}

        // Try as ID
        el = document.getElementById(mapping.selector);
        if (el) return el;

        // Try as name
        el = document.querySelector('[name="' + mapping.selector + '"]');
        if (el) return el;
    }

    // Try by label text match
    var labelText = (mapping.resumeField || '').toLowerCase();
    if (!labelText) return null;

    var inputs = Array.from(document.querySelectorAll('input, textarea, select'));
    for (var i = 0; i < inputs.length; i++) {
        var inp = inputs[i];
        var rect = inp.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) continue;
        if (inp.disabled || inp.readOnly) continue;
        var lbl = getLabelText(inp).toLowerCase();
        if (lbl && lbl.includes(labelText)) return inp;
    }

    return null;
}

// "" Main fill function """"""""""""""""""""""""""""""""""""""""
async function fillForm(fieldMappings, confidenceThreshold) {
    confidenceThreshold = confidenceThreshold || 0.5;
    var filledCount = 0;
    var skippedCount = 0;
    var failedCount = 0;
    var filledEls = new Set();

    console.log('[AutoFill] Starting fill with', fieldMappings.length, 'mappings');

    for (var i = 0; i < fieldMappings.length; i++) {
        var mapping = fieldMappings[i];
        if (!mapping.value) { skippedCount++; continue; }
        if ((mapping.confidence || 0) < confidenceThreshold) { skippedCount++; continue; }

        var el = findElement(mapping);
        if (!el) { skippedCount++; continue; }
        if (filledEls.has(el)) { skippedCount++; continue; }

        var rect = el.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) { skippedCount++; continue; }
        if (el.disabled || el.readOnly) { skippedCount++; continue; }

        var ok = false;
        if (el.tagName === 'SELECT') {
            var val = mapping.value.toLowerCase();
            for (var j = 0; j < el.options.length; j++) {
                if (el.options[j].text.toLowerCase().includes(val) ||
                    el.options[j].value.toLowerCase().includes(val)) {
                    el.selectedIndex = j;
                    el.dispatchEvent(new Event('change', { bubbles: true }));
                    ok = true;
                    break;
                }
            }
        } else if (el.type === 'checkbox' || el.type === 'radio') {
            var should = /yes|true|1/i.test(mapping.value);
            if (el.checked !== should) {
                el.click();
                el.dispatchEvent(new Event('change', { bubbles: true }));
            }
            ok = true;
        } else {
            ok = fillField(el, mapping.value);
        }

        if (ok) {
            filledEls.add(el);
            filledCount++;
            console.log('[AutoFill] Filled:', mapping.resumeField, '=', mapping.value);
        } else {
            failedCount++;
        }

        // Update storage progress
        chrome.storage.local.set({ fieldsFilled: filledCount });
        await delay(80);
    }

    console.log('[AutoFill] Done. Filled:', filledCount, 'Skipped:', skippedCount, 'Failed:', failedCount);
    return { filledCount: filledCount, skippedCount: skippedCount, failedCount: failedCount };
}

// "" Message listener """"""""""""""""""""""""""""""""""""""""""
chrome.runtime.onMessage.addListener(function(message, sender, sendResponse) {
    if (!message || !message.type) return false;

    if (message.type === 'PERFORM_AUTO_FILL' ||
        message.type === 'AUTOFILL_START' ||
        message.type === 'AUTO_FILL_FORM') {

        var mappings = message.fieldMappings || [];
        var threshold = message.confidenceThreshold || 0.5;

        fillForm(mappings, threshold)
            .then(function(result) {
                chrome.storage.local.set({
                    fieldsFilled: result.filledCount,
                    autofillStatus: 'done'
                });
                try { sendResponse({ success: true, result: result }); } catch (e) {}
            })
            .catch(function(err) {
                console.error('[AutoFill] Error:', err);
                try { sendResponse({ success: false, error: err.message }); } catch (e) {}
            });
        return true;
    }

    if (message.type === 'PING') {
        sendResponse({ alive: true, platform: 'generic' });
        return false;
    }

    return false;
});

console.log('[AutoFill] autoFill.js loaded');
} // end __autoFillInitialized guard
