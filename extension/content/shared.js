// shared.js " Shared helpers loaded on ALL job sites
// Every site-specific file (autoFill-workday.js etc.) depends on this.

if (window.__sharedHelpersInitialized) {
    // already loaded " skip re-init
} else {
window.__sharedHelpersInitialized = true;

// "" CONFIG """"""""""""""""""""""""""""""""""""""""""""""""""""
window.AUTOFILL_BACKEND_URL = 'http://localhost:5000';

// "" AI QUESTION PATTERNS """"""""""""""""""""""""""""""""""""""
window.AI_QUESTION_PATTERNS = [
    /cover letter/i, /why do you want/i, /why are you interest/i,
    /tell us about yourself/i, /describe your experience/i,
    /what are your strength/i, /what are your weakness/i,
    /where do you see yourself/i, /what motivates you/i,
    /why should we hire/i, /describe a challenge/i, /describe a situation/i,
    /how do you handle/i, /what is your greatest/i, /tell me about a time/i,
    /what are your career goal/i, /what do you know about/i,
    /how did you hear about/i, /how did you come to know/i,
    /what salary/i, /salary expectation/i, /expected salary/i,
    /desired salary/i, /expected compensation/i, /notice period/i,
    /current ctc/i, /expected ctc/i, /last drawn/i, /current salary/i,
    /available to start/i, /earliest start/i, /when can you join/i,
    /willing to relocate/i, /open to relocation/i,
    /additional information/i, /anything else/i,
    /is there anything/i, /please describe/i, /please explain/i,
    /briefly describe/i, /share your/i, /how would you/i,
    /what experience do you have/i, /how many years/i,
    /years of experience/i, /describe your background/i,
    /relevant experience/i, /passion for/i, /what drives you/i,
    /what excites you/i, /total work experience/i,
    /last working day/i, /previous organisation/i,
    /if selected.*relocate/i, /when.*offered.*join/i
];

window.isAIQuestion = function(labelText) {
    if (!labelText) return false;
    var lc = labelText.toLowerCase();
    return window.AI_QUESTION_PATTERNS.some(function(p) { return p.test(lc); });
};

window.getAIAnswer = async function(question, profile, context) {
    try {
        // Auto-extract page context if not provided
        var ctx = context || {};

        // Extract company name from page
        if (!ctx.company_name) {
            // Try structured elements first
            var companyEl = document.querySelector(
                '[class*="company-name"],[class*="org-name"],[data-company],[class*="employer-name"],' +
                '[itemprop="hiringOrganization"] [itemprop="name"]'
            );
            if (companyEl) {
                ctx.company_name = companyEl.textContent.trim().split('\n')[0].substring(0, 80);
            }
            if (!ctx.company_name) {
                // Parse from page title: "Job Title at Company | Site" or "Company - Job Title"
                var title = document.title || '';
                var atMatch = title.match(/\bat\s+([^|\-\[\]]+)/i);
                var dashMatch = title.match(/^([^|\-]+?)\s*[\-|]/);
                if (atMatch) ctx.company_name = atMatch[1].trim().substring(0, 80);
                else if (dashMatch) ctx.company_name = dashMatch[1].trim().substring(0, 80);
            }
            // Fallback: hostname
            if (!ctx.company_name) {
                var hostname = window.location.hostname.replace('www.', '').replace('jobs.', '').split('.')[0];
                ctx.company_name = hostname.charAt(0).toUpperCase() + hostname.slice(1);
            }
        }

        // Extract job title from page
        if (!ctx.job_title) {
            var h1 = document.querySelector('h1');
            if (h1) ctx.job_title = h1.textContent.trim().substring(0, 100);
            if (!ctx.job_title) {
                var title2 = document.title || '';
                var parts = title2.split(/[|\-]/);
                if (parts.length > 0) ctx.job_title = parts[0].trim().substring(0, 100);
            }
        }

        // Extract job description snippet for context
        if (!ctx.job_description) {
            var descEl = document.querySelector(
                '[class*="job-description"],[class*="jobDescription"],[id*="description"],' +
                '[class*="job-detail"],[class*="position-description"],[data-testid*="description"]'
            );
            if (descEl) ctx.job_description = descEl.textContent.trim().replace(/\s+/g,' ').substring(0, 800);
        }

        var res = await fetch(window.AUTOFILL_BACKEND_URL + '/api/v1/ai/answer-question', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                question:    question,
                field_label: question,
                field_type:  'textarea',
                context:     ctx,
                profile:     profile
            })
        });
        if (!res.ok) return null;
        var data = await res.json();
        return data.answer || data.response || null;
    } catch (e) {
        console.log('[AutoFill] AI answer fetch failed:', e.message);
        return null;
    }
};

// "" DELAY """""""""""""""""""""""""""""""""""""""""""""""""""""
window.delay = function(ms) {
    return new Promise(function(resolve) { setTimeout(resolve, ms); });
};

// "" FILL FIELD (React-compatible) """""""""""""""""""""""""""""
window.fillField = function(el, value) {
    try {
        var nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')
                        || Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value');
        var setter = nativeSetter && nativeSetter.set;
        if (setter) setter.call(el, value); else el.value = value;
        el.dispatchEvent(new Event('input',  { bubbles: true, cancelable: true }));
        el.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
        el.dispatchEvent(new Event('blur',   { bubbles: true, cancelable: true }));
        el.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true }));
        el.dispatchEvent(new KeyboardEvent('keyup',   { bubbles: true }));
        return true;
    } catch (e) { return false; }
};

// "" FILL SELECT """""""""""""""""""""""""""""""""""""""""""""""
window.fillSelect = function(el, value) {
    try {
        var lc = value.toLowerCase();
        for (var i = 0; i < el.options.length; i++) {
            if ((el.options[i].value || '').toLowerCase() === lc) {
                el.selectedIndex = i; el.dispatchEvent(new Event('change', { bubbles: true })); return true;
            }
        }
        for (var j = 0; j < el.options.length; j++) {
            if ((el.options[j].text || '').toLowerCase().includes(lc)) {
                el.selectedIndex = j; el.dispatchEvent(new Event('change', { bubbles: true })); return true;
            }
        }
        return false;
    } catch (e) { return false; }
};

// "" FILL CHECKBOX """""""""""""""""""""""""""""""""""""""""""""
window.fillCheckbox = function(el, value) {
    try {
        var shouldCheck = value === true || value === 'true' ||
            (typeof value === 'string' && /^(yes|on|checked|true)$/i.test(value.trim()));
        if (el.checked !== shouldCheck) {
            el.click();
            el.dispatchEvent(new Event('change', { bubbles: true }));
        }
        return true;
    } catch (e) { return false; }
};

// "" FILL RADIO """"""""""""""""""""""""""""""""""""""""""""""""
window.fillRadio = function(el, value) {
    try {
        var elVal = (el.value || '').toLowerCase();
        var elLbl = (window.getLabelForElement(el) || '').toLowerCase();
        var val   = (value || '').toLowerCase();
        if (elVal === val || elLbl === val || elVal.includes(val) || val.includes(elVal)) {
            if (!el.checked) { el.click(); el.dispatchEvent(new Event('change', { bubbles: true })); }
            return true;
        }
        return false;
    } catch (e) { return false; }
};

// "" FILL ANY FIELD """"""""""""""""""""""""""""""""""""""""""""
window.fillAnyField = function(el, value) {
    if (!el || value === null || value === undefined) return false;
    var tag  = (el.tagName || '').toLowerCase();
    var type = (el.type    || '').toLowerCase();
    if (tag === 'select')                      return window.fillSelect(el, String(value));
    if (tag === 'input' && type === 'checkbox') return window.fillCheckbox(el, value);
    if (tag === 'input' && type === 'radio')    return window.fillRadio(el, String(value));
    if (tag === 'input' || tag === 'textarea')  return window.fillField(el, String(value));
    if (el.getAttribute('contenteditable') === 'true' || el.getAttribute('contenteditable') === '') {
        el.focus();
        document.execCommand('selectAll', false, null);
        document.execCommand('insertText', false, String(value));
        el.dispatchEvent(new Event('input', { bubbles: true }));
        return true;
    }
    return false;
};

// "" IS FIELD FILLABLE """""""""""""""""""""""""""""""""""""""""
window.isFieldFillable = function(el) {
    if (!el) return false;
    try {
        var rect = el.getBoundingClientRect();
        if (rect.width === 0 && rect.height === 0) return false;
    } catch (e) { return false; }
    if (el.disabled || el.readOnly) return false;
    var style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
    return true;
};

// "" GET LABEL FOR ELEMENT """""""""""""""""""""""""""""""""""""
window.getLabelForElement = function(el) {
    if (!el) return '';
    if (el.id) {
        var lbl = document.querySelector('label[for="' + el.id + '"]');
        if (lbl) return lbl.textContent.trim();
    }
    var parent = el.parentElement;
    while (parent && parent !== document.body) {
        if ((parent.tagName || '').toLowerCase() === 'label') return parent.textContent.trim();
        parent = parent.parentElement;
    }
    if (el.getAttribute('aria-label'))     return el.getAttribute('aria-label').trim();
    var labelledBy = el.getAttribute('aria-labelledby');
    if (labelledBy) {
        var lblEl = document.getElementById(labelledBy);
        if (lblEl) return lblEl.textContent.trim();
    }
    if (el.placeholder) return el.placeholder.trim();
    if (el.name)        return el.name.trim();
    return '';
};

// "" SHOW TOAST """"""""""""""""""""""""""""""""""""""""""""""""
window.showToast = function(msg, type) {
    try {
        var existing = document.getElementById('__autofill_toast__');
        if (existing) existing.remove();
        var toast = document.createElement('div');
        toast.id = '__autofill_toast__';
        toast.textContent = msg;
        var bg = type === 'error' ? '#c0392b' : type === 'warn' ? '#e67e22' : '#27ae60';
        toast.style.cssText = [
            'position:fixed', 'bottom:24px', 'right:24px', 'z-index:2147483647',
            'background:' + bg, 'color:#fff', 'padding:12px 20px',
            'border-radius:8px', 'font-size:14px', 'font-family:sans-serif',
            'box-shadow:0 4px 16px rgba(0,0,0,0.25)', 'max-width:380px',
            'line-height:1.4', 'pointer-events:none'
        ].join(';');
        document.body.appendChild(toast);
        setTimeout(function() { if (toast.parentNode) toast.remove(); }, 4000);
    } catch (e) {}
};

console.log('[Shared] helpers loaded');
} // end __sharedHelpersInitialized guard
