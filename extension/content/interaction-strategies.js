// interaction-strategies.js
// Phase 4: Strategy Registry — per-component fill strategies for universal autofill.
// Exports window.InteractionStrategies for use by autoFill-universal.js and any
// future content scripts.  Works on ALL sites; NOT platform-specific.

(function () {
'use strict';

if (window.__interactionStrategiesInitialized) { return; }
window.__interactionStrategiesInitialized = true;

// ─────────────────────────────────────────────────────────────
// INTERNAL HELPERS
// ─────────────────────────────────────────────────────────────

/** Await a fixed number of milliseconds. Falls back to shared window.delay. */
var _delay = function (ms) {
    if (window.delay) return window.delay(ms);
    return new Promise(function (r) { setTimeout(r, ms); });
};

/**
 * Set the value of an <input> or <textarea> using the native React/Angular-
 * compatible setter so frameworks notice the change.
 */
function _nativeSet(el, value) {
    try {
        var proto = (el.tagName === 'TEXTAREA')
            ? HTMLTextAreaElement.prototype
            : HTMLInputElement.prototype;
        var d = Object.getOwnPropertyDescriptor(proto, 'value');
        if (d && d.set) {
            d.set.call(el, String(value));
        } else {
            el.value = String(value);
        }
    } catch (e) {
        el.value = String(value);
    }
}

/** Dispatch the standard burst of events that React/Angular/Vue expect. */
function _fireEvents(el) {
    el.dispatchEvent(new Event('focus',  { bubbles: true }));
    el.dispatchEvent(new Event('input',  { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true }));
    el.dispatchEvent(new Event('blur',   { bubbles: true }));
}

/** Full fill sequence: native-set + fire events. */
function _fillAndFire(el, value) {
    _nativeSet(el, value);
    _fireEvents(el);
}

// ─────────────────────────────────────────────────────────────
// STRATEGY IMPLEMENTATIONS
// ─────────────────────────────────────────────────────────────

var IS = {};

// ── text / email / phone / number / url ──────────────────────

IS.text = async function (el, value /*, delay */) {
    if (!el || value === null || value === undefined) return { ok: false, method: 'text' };
    _fillAndFire(el, String(value));
    return { ok: (el.value || '').trim() !== '', method: 'text' };
};

IS.email = async function (el, value /*, delay */) {
    if (!el || !value) return { ok: false, method: 'email' };
    _fillAndFire(el, String(value));
    return { ok: (el.value || '').trim() !== '', method: 'email' };
};

IS.phone = async function (el, value /*, delay */) {
    if (!el || !value) return { ok: false, method: 'phone' };
    _fillAndFire(el, String(value));
    return { ok: (el.value || '').trim() !== '', method: 'phone' };
};

IS.number = async function (el, value /*, delay */) {
    if (!el || value === null || value === undefined) return { ok: false, method: 'number' };
    _fillAndFire(el, String(value));
    return { ok: (el.value || '').trim() !== '', method: 'number' };
};

IS.textarea = async function (el, value /*, delay */) {
    if (!el || value === null || value === undefined) return { ok: false, method: 'textarea' };
    _fillAndFire(el, String(value));
    return { ok: (el.value || '').trim() !== '', method: 'textarea' };
};

// ── nativeSelect ─────────────────────────────────────────────

IS.nativeSelect = async function (el, value /*, delay */) {
    if (!el || !value) return { ok: false, method: 'nativeSelect' };
    var lc   = String(value).toLowerCase().trim();
    var opts = Array.from(el.options);

    // Pass 0: exact text or value match
    // Pass 1: option text starts-with value  OR  value starts-with option text
    // Pass 2: includes (either direction, length > 2 guard)
    for (var pass = 0; pass < 3; pass++) {
        var found = opts.find(function (o) {
            if (o.disabled) return false;
            var ot = (o.text  || '').toLowerCase().trim();
            var ov = (o.value || '').toLowerCase().trim();
            if (pass === 0) return ot === lc || ov === lc;
            if (pass === 1) return ot.startsWith(lc) || (lc.startsWith(ot) && ot.length > 2);
            return (ot.includes(lc) && lc.length > 2) || (lc.includes(ot) && ot.length > 2);
        });
        if (found) {
            el.value = found.value;
            el.dispatchEvent(new Event('change', { bubbles: true }));
            return { ok: true, method: 'nativeSelect' };
        }
    }
    return { ok: false, method: 'nativeSelect' };
};

// ── customDropdown ───────────────────────────────────────────

IS.customDropdown = async function (triggerEl, value, delay) {
    if (!triggerEl || !value) return { ok: false, method: 'customDropdown' };
    var lc = String(value).toLowerCase().trim();
    var ms = delay || 600;

    // Open the dropdown
    triggerEl.click();
    triggerEl.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    await _delay(ms);

    var optSelectors = [
        '[role="option"]', '[role="menuitem"]', '[role="listitem"]',
        '.k-list-item', '.k-item',
        '.mat-option', '.mat-select-panel mat-option',
        '.ant-select-item', '.ant-dropdown-menu-item',
        '[class*="option"]:not(input)', '[class*="menu-item"]',
        '.select2-results__option',
        'ul.dropdown li', 'ul.options li', '.dropdown-item',
        '.vs__dropdown-option'
    ].join(',');

    var opts = Array.from(document.querySelectorAll(optSelectors)).filter(function (o) {
        var r = o.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
    });

    // Also search shadow DOM
    try {
        Array.from(document.querySelectorAll('*')).forEach(function (host) {
            if (host.shadowRoot) {
                try {
                    Array.from(host.shadowRoot.querySelectorAll(optSelectors)).forEach(function (o) {
                        var r = o.getBoundingClientRect();
                        if (r.width > 0 && r.height > 0) opts.push(o);
                    });
                } catch (e) {}
            }
        });
    } catch (e) {}

    if (opts.length === 0) {
        document.body.click();
        return { ok: false, method: 'customDropdown' };
    }

    // Semantic match: exact → starts-with → includes → single option fallback
    var target = opts.find(function (o) { return o.textContent.trim().toLowerCase() === lc; })
              || opts.find(function (o) { return o.textContent.trim().toLowerCase().startsWith(lc); })
              || opts.find(function (o) {
                    var ot = o.textContent.trim().toLowerCase();
                    return ot.includes(lc) && ot.length < 60;
                 })
              || (opts.length === 1 ? opts[0] : null);

    if (target) {
        target.click();
        target.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
        await _delay(300);
        return { ok: true, method: 'customDropdown' };
    }

    document.body.click();
    return { ok: false, method: 'customDropdown' };
};

// ── radio ────────────────────────────────────────────────────

IS.radio = async function (name, value /*, delay */) {
    if (!name || !value) return { ok: false, method: 'radio' };
    var lc = String(value).toLowerCase().trim();

    var radios = Array.from(document.querySelectorAll(
        name ? 'input[type="radio"][name="' + name + '"]' : 'input[type="radio"]'
    ));
    if (!radios.length) return { ok: false, method: 'radio' };

    function labelOf(r) {
        if (r.id) {
            var lf = document.querySelector('label[for="' + r.id + '"]');
            if (lf) return (lf.innerText || lf.textContent || '').trim().toLowerCase();
        }
        var al = r.getAttribute('aria-label') || '';
        if (al) return al.toLowerCase();
        var ns = r.nextElementSibling;
        if (ns) {
            var nt = (ns.textContent || '').trim().toLowerCase();
            if (nt.length > 0 && nt.length < 80) return nt;
        }
        return (r.value || '').toLowerCase();
    }

    var target = radios.find(function (r) {
        var lbl = labelOf(r);
        var val = (r.value || '').toLowerCase();
        return lbl === lc || val === lc
            || lbl.startsWith(lc) || (lc.startsWith(lbl) && lbl.length > 3)
            || lbl.includes(lc) && lc.length > 3;
    });

    // Yes/no shortcuts
    if (!target && (lc === 'yes' || lc === 'true' || lc === 'immediate' || lc === 'immediately')) {
        target = radios[0];
    }
    if (!target && (lc === 'no' || lc === 'false')) {
        target = radios[radios.length - 1];
    }

    if (target) {
        if (!target.checked) target.click();
        target.dispatchEvent(new Event('change', { bubbles: true }));
        return { ok: true, method: 'radio' };
    }
    return { ok: false, method: 'radio' };
};

// ── checkbox ─────────────────────────────────────────────────

IS.checkbox = async function (el, value /*, delay */) {
    if (!el) return { ok: false, method: 'checkbox' };
    var shouldCheck = /^(yes|true|1|on|checked)$/i.test(String(value));
    if (el.checked !== shouldCheck) {
        el.click();
        el.dispatchEvent(new Event('change', { bubbles: true }));
    }
    return { ok: true, method: 'checkbox' };
};

// ── datePicker ───────────────────────────────────────────────

IS.datePicker = async function (el, value /*, delay */) {
    if (!el || !value) return { ok: false, method: 'datePicker' };
    var raw = String(value).trim();

    // Normalise to components
    var year = '', month = '', day = '';
    var iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    var dmy = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    var mdy = raw.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);

    if (iso)      { year = iso[1];  month = iso[2];  day = iso[3]; }
    else if (dmy) { day  = dmy[1];  month = dmy[2];  year = dmy[3]; }
    else if (mdy) { month= mdy[1];  day   = mdy[2];  year = mdy[3]; }
    else {
        // Unknown format — try direct assignment
        _fillAndFire(el, raw);
        return { ok: (el.value || '').trim() !== '', method: 'datePicker' };
    }

    var isoDate = year + '-' + String(month).padStart(2, '0') + '-' + String(day).padStart(2, '0');

    if (el.type === 'date' || el.type === 'datetime-local') {
        _fillAndFire(el, isoDate);
        return { ok: (el.value || '').trim() !== '', method: 'datePicker' };
    }

    // Text input — detect format from placeholder
    var ph = (el.placeholder || '').toUpperCase();
    var formatted = isoDate; // default YYYY-MM-DD
    if (/MM.DD.YYYY/.test(ph) || /MM\/DD\/YYYY/.test(ph)) {
        formatted = String(month).padStart(2, '0') + '/' + String(day).padStart(2, '0') + '/' + year;
    } else if (/DD.MM.YYYY/.test(ph) || /DD\/MM\/YYYY/.test(ph)) {
        formatted = String(day).padStart(2, '0') + '/' + String(month).padStart(2, '0') + '/' + year;
    }

    _fillAndFire(el, formatted);
    return { ok: (el.value || '').trim() !== '', method: 'datePicker' };
};

// ── skillSelector ────────────────────────────────────────────

IS.skillSelector = async function (inputEl, skills, delay) {
    if (!inputEl || !skills) return { ok: false, added: 0, method: 'skillSelector' };
    var ms       = delay || 600;
    var skillArr = Array.isArray(skills) ? skills : String(skills).split(',').map(function (s) { return s.trim(); });
    var added    = 0;

    var optSelectors = [
        '[role="option"]', '[role="listitem"]', '[role="menuitem"]',
        '.ant-select-item', '.mat-option', '.k-list-item',
        '[class*="option"]:not(input)', '[class*="suggestion"]', '[class*="chip"]',
        'li[class*="item"]'
    ].join(',');

    for (var si = 0; si < skillArr.length; si++) {
        var skill = skillArr[si].trim();
        if (!skill) continue;

        // Focus and type the skill name
        inputEl.focus();
        _fillAndFire(inputEl, skill);
        await _delay(ms);

        // Find visible suggestion options
        var opts = Array.from(document.querySelectorAll(optSelectors)).filter(function (o) {
            var r = o.getBoundingClientRect();
            return r.width > 0 && r.height > 0;
        });

        var lc = skill.toLowerCase();
        var target = opts.find(function (o) { return o.textContent.trim().toLowerCase() === lc; })
                  || opts.find(function (o) { return o.textContent.trim().toLowerCase().startsWith(lc); })
                  || opts.find(function (o) {
                        var ot = o.textContent.trim().toLowerCase();
                        return ot.includes(lc) && lc.length > 2;
                     });

        if (target) {
            var beforeVal = inputEl.value;
            target.click();
            target.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
            await _delay(300);

            // Verify chip/tag appeared: input cleared or its container grew
            var afterVal = inputEl.value;
            if (afterVal !== beforeVal || afterVal === '') {
                added++;
            } else {
                // Chip may have appeared even if input value didn't clear
                added++;
            }
        }
        // else: skill not found in suggestions — skip and move on
    }

    return { ok: added > 0, added: added, method: 'skillSelector' };
};

// ── contentEditable ───────────────────────────────────────────

IS.contentEditable = async function (el, value /*, delay */) {
    if (!el || value === null || value === undefined) return { ok: false, method: 'contentEditable' };
    var v = String(value);

    el.focus();
    try {
        document.execCommand('selectAll', false, null);
        var inserted = document.execCommand('insertText', false, v);
        if (inserted) {
            el.dispatchEvent(new Event('input', { bubbles: true }));
            return { ok: (el.textContent || '').trim() !== '', method: 'contentEditable' };
        }
    } catch (e) {}

    // Fallback: set textContent directly
    el.textContent = v;
    el.dispatchEvent(new Event('input',  { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return { ok: (el.textContent || '').trim() !== '', method: 'contentEditable' };
};

// ── phoneCountryCode ─────────────────────────────────────────

IS.phoneCountryCode = async function (el, countryCode /*, delay */) {
    if (!el || !countryCode) return { ok: false, method: 'phoneCountryCode' };
    var cc    = String(countryCode).replace(/^\+/, '').trim(); // e.g. "91"
    var ccFull = '+' + cc;

    // Native <select>
    if (el.tagName === 'SELECT') {
        var opts = Array.from(el.options);

        // Exact numeric match first (avoids +91 → +917 confusion)
        var exact = opts.find(function (o) {
            var ov = (o.value || '').replace(/^\+/, '').trim();
            return ov === cc && !o.disabled;
        });
        if (!exact) {
            // Text that starts with "+CC" not followed by another digit
            var re = new RegExp('^\\+?' + cc + '(\\D|$)');
            exact = opts.find(function (o) {
                return re.test((o.text || '').trim()) && !o.disabled;
            });
        }
        if (exact) {
            el.value = exact.value;
            el.dispatchEvent(new Event('change', { bubbles: true }));
            return { ok: true, method: 'phoneCountryCode' };
        }
        return { ok: false, method: 'phoneCountryCode' };
    }

    // Custom picker — open, type, find, click
    el.click();
    el.focus();
    await _delay(400);
    _fillAndFire(el, ccFull);
    await _delay(600);

    var optSelectors2 = [
        '[role="option"]', '[role="listitem"]', '.mat-option',
        '.k-list-item', '.ant-select-item', '[class*="option"]:not(input)',
        'li[class*="item"]'
    ].join(',');

    var opts2 = Array.from(document.querySelectorAll(optSelectors2)).filter(function (o) {
        var r = o.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
    });

    var re2 = new RegExp('^\\+?' + cc + '(\\D|$)');
    var target = opts2.find(function (o) {
        return re2.test(o.textContent.trim()) && !o.disabled;
    });

    if (target) {
        target.click();
        await _delay(300);
        return { ok: true, method: 'phoneCountryCode' };
    }
    return { ok: false, method: 'phoneCountryCode' };
};

// ── autocomplete ─────────────────────────────────────────────

IS.autocomplete = async function (inputEl, value, delay) {
    if (!inputEl || !value) return { ok: false, method: 'autocomplete', selected: false };
    var ms = delay || 800;
    var lc = String(value).toLowerCase().trim();

    inputEl.focus();
    _fillAndFire(inputEl, String(value));
    await _delay(ms);

    var optSelectors = [
        '[role="option"]', '[role="listitem"]', '[role="menuitem"]',
        '.autocomplete-item', '.suggestion-item', '.mat-option',
        '.k-list-item', '.ant-select-item',
        '[class*="option"]:not(input)', '[class*="suggestion"]',
        'ul li[id]', 'datalist option'
    ].join(',');

    var opts = Array.from(document.querySelectorAll(optSelectors)).filter(function (o) {
        var r = o.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
    });

    if (opts.length === 0) {
        // No suggestions — leave the typed value
        return { ok: (inputEl.value || '').trim() !== '', method: 'autocomplete', selected: false };
    }

    var target = opts.find(function (o) { return o.textContent.trim().toLowerCase() === lc; })
              || opts.find(function (o) { return o.textContent.trim().toLowerCase().startsWith(lc); })
              || opts.find(function (o) {
                    var ot = o.textContent.trim().toLowerCase();
                    return ot.includes(lc) && lc.length > 2;
                 });

    if (target) {
        target.click();
        await _delay(300);
        return { ok: true, method: 'autocomplete', selected: true };
    }

    // Left the typed value in the input
    return { ok: (inputEl.value || '').trim() !== '', method: 'autocomplete', selected: false };
};

// ── universal fallback ───────────────────────────────────────

IS.universal = async function (el, value /*, delay */) {
    if (!el || value === null || value === undefined) return { ok: false, method: 'universal-fallback' };
    var v = String(value);

    // 1. execCommand insertText
    try {
        el.focus();
        document.execCommand('selectAll', false, null);
        var ok1 = document.execCommand('insertText', false, v);
        el.dispatchEvent(new Event('input',  { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        if (ok1 && (el.value || el.textContent || '').trim() !== '') {
            return { ok: true, method: 'universal-fallback' };
        }
    } catch (e) {}

    // 2. Native setter + events
    try {
        _fillAndFire(el, v);
        if ((el.value || '').trim() !== '') {
            return { ok: true, method: 'universal-fallback' };
        }
    } catch (e) {}

    // 3. Direct .value assignment
    try {
        el.value = v;
        el.dispatchEvent(new Event('input',  { bubbles: true, composed: true }));
        el.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
        return { ok: (el.value || '').trim() !== '', method: 'universal-fallback' };
    } catch (e) {
        return { ok: false, method: 'universal-fallback' };
    }
};

// ─────────────────────────────────────────────────────────────
// STRATEGY SELECTOR
// ─────────────────────────────────────────────────────────────

/**
 * Given a componentType string (from autoFill-universal.js detectComponentType),
 * return the name of the strategy to use.
 */
IS.select = function (componentType) {
    var map = {
        'TEXT':            'text',
        'EMAIL':           'email',
        'PHONE':           'phone',
        'NUMBER':          'number',
        'TEXTAREA':        'textarea',
        'SELECT':          'nativeSelect',
        'MULTISELECT':     'nativeSelect',
        'CUSTOM_DROPDOWN': 'customDropdown',
        'COMBOBOX':        'autocomplete',
        'AUTOCOMPLETE':    'autocomplete',
        'RADIO':           'radio',
        'CHECKBOX':        'checkbox',
        'DATE':            'datePicker',
        'TAGS_INPUT':      'skillSelector',
        'PHONE_CC':        'phoneCountryCode',
        'CONTENTEDITABLE': 'contentEditable',
        'SHADOW_COMPONENT':'universal',
        'URL':             'text',
        'UNKNOWN':         'universal'
    };
    return map[componentType] || 'universal';
};

// ─────────────────────────────────────────────────────────────
// EXPORT
// ─────────────────────────────────────────────────────────────

window.InteractionStrategies = IS;

console.log('[IS] interaction-strategies.js loaded');

})(); // end IIFE
