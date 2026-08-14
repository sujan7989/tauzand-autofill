// autoFill-universal.js
// Universal autofill for ANY job portal site worldwide
// Handles: text, email, tel, number, select, radio, checkbox, date, textarea,
//          React/Angular/Vue custom dropdowns, shadow DOM, Kendo, MUI, Ant Design, etc.
// Does NOT run on sites that have dedicated scripts (Workday, Greenhouse, Lever, Ashby, SmartRecruiters, Google Forms)

(function() {
'use strict';

// Skip dedicated platforms
var SKIP = ['myworkdayjobs.com','workday.com','greenhouse.io','lever.co','ashbyhq.com','smartrecruiters.com','docs.google.com/forms'];
if (SKIP.some(function(s){return location.hostname.indexOf(s)!==-1||location.pathname.indexOf(s)!==-1;})) {
    return;
}

if (window.__uvInitialized) return;
window.__uvInitialized = true;

var uv = { filled: new Set(), busy: false };

// ─────────────────────────────────────────────────────────────
// PHASE 3: FIELD DESCRIPTOR + LABEL NORMALIZATION
// Every field gets a structured descriptor so the popup's
// Field Review screen can show real data.
// ─────────────────────────────────────────────────────────────

// Semantic label → normalized field name
var LABEL_MAP = [
    // Name
    [/^(first.?name|given.?name|firstname)$/i,           'first_name',         'Resume'],
    [/^(middle.?name|middle.?initial)$/i,                'middle_name',        'Resume'],
    [/^(last.?name|surname|family.?name|lastname)$/i,    'last_name',          'Resume'],
    [/^(full.?name|your.?name|name|candidate.?name)$/i,  'full_name',          'Resume'],
    // Contact
    [/email|e-mail/i,                                    'email',              'Resume'],
    [/phone|mobile|cell|^tel\b|contact.*(no|num)/i,      'phone',              'Resume'],
    [/country.*code|dial.*code|isd|calling.?code/i,      'phone_country_code', 'Resume'],
    [/^city$|current.?city|city.?name/i,                 'city',               'Resume'],
    [/\bstate\b|\bprovince\b/i,                          'state',              'Resume'],
    [/\bcountry\b/i,                                     'country',            'Resume'],
    [/pin.?code|zip|postal/i,                            'postal_code',        'Resume'],
    [/address/i,                                         'address',            'Resume'],
    [/current.?location|location/i,                      'location',           'Resume'],
    // Social
    [/linkedin/i,                                        'linkedin_url',       'Resume'],
    [/github/i,                                          'github_url',         'Resume'],
    [/portfolio|personal.*site|website/i,                'portfolio_url',      'Resume'],
    // Education
    [/college|university|institution|school/i,           'edu_institution',    'Resume'],
    [/degree|qualification/i,                            'edu_degree',         'Resume'],
    [/branch|major|field.*study|stream/i,                'edu_field',          'Resume'],
    [/graduation.*year|year.*pass/i,                     'edu_grad_year',      'Resume'],
    [/cgpa|gpa|percentage|marks/i,                       'edu_gpa',            'Resume'],
    // Experience
    [/current.*company|employer|present.*company/i,      'exp_company',        'Resume'],
    [/designation|current.*title|job.*title/i,           'exp_title',          'Resume'],
    [/total.*exp|years.*exp|work.*exp/i,                 'exp_years',          'Resume'],
    // Skills
    [/\bskills\b|technical.*skills|key.*skills/i,        'skills',             'Resume'],
    // Application questions
    [/notice.*period/i,                                  'notice_period',      'Template'],
    [/current.*salary|current.*ctc/i,                    'current_salary',     'Resume'],
    [/expected.*salary|expected.*ctc/i,                  'expected_salary',    'Resume'],
    [/relocat/i,                                         'willing_relocate',   'Template'],
    [/authorized.*work|work.*authoriz/i,                 'work_authorization', 'Profile'],
    [/sponsorship|visa/i,                                'visa_sponsorship',   'Profile'],
    [/cover.?letter|why.*join|why.*want|why.*interest|motivation|tell.*about.*yourself|introduce/i, 'ai_open_question', 'AI'],
    [/how.*hear|source.*apply/i,                         'how_heard',          'Template'],
    [/language/i,                                        'languages',          'Resume'],
    [/gender/i,                                          'gender',             'Profile']
];

// Component type detection
function detectComponentType(el) {
    var tag  = (el.tagName||'').toUpperCase();
    var type = (el.type||'').toLowerCase();
    var nm   = (el.name||'').toLowerCase();
    var ph   = (el.placeholder||'').toLowerCase();
    var cls  = (el.className||'').toLowerCase();

    if (tag === 'SELECT')   return el.multiple ? 'MULTISELECT' : 'SELECT';
    if (tag === 'TEXTAREA') return 'TEXTAREA';
    if (type === 'radio')   return 'RADIO';
    if (type === 'checkbox')return 'CHECKBOX';
    if (type === 'date' || type === 'datetime-local') return 'DATE';
    if (type === 'number')  return 'NUMBER';
    if (type === 'email')   return 'EMAIL';
    if (type === 'tel')     return 'PHONE';
    if (type === 'url')     return 'URL';
    if (/country.*code|dial.*code|isd/i.test(getLabel(el))) return 'PHONE_CC';
    if (/add.*skill|type.*enter.*skill|new.*skill/i.test(ph)) return 'TAGS_INPUT';
    if (el.getRootNode() !== document) return 'SHADOW_COMPONENT';
    if (cls.includes('search') || el.getAttribute('role')==='combobox') return 'AUTOCOMPLETE';
    return 'TEXT';
}

// Build a FieldDescriptor for one element
function buildDescriptor(el, label) {
    var lc  = (label||'').toLowerCase().trim();
    var compType = detectComponentType(el);
    var required = el.required || el.getAttribute('aria-required')==='true' ||
                   !!(el.closest && el.closest('[required]'));

    // Semantic normalization
    var normalizedLabel = 'unknown';
    var source = 'Unknown';
    var confidence = 0.5;

    for (var i = 0; i < LABEL_MAP.length; i++) {
        if (LABEL_MAP[i][0].test(lc)) {
            normalizedLabel = LABEL_MAP[i][1];
            source          = LABEL_MAP[i][2];
            confidence      = normalizedLabel === 'ai_open_question' ? 0.88 :
                              source === 'Resume'   ? 0.95 :
                              source === 'Template' ? 0.90 :
                              source === 'Profile'  ? 0.85 : 0.75;
            break;
        }
    }

    // Options for selects/radios
    var options = [];
    if (el.tagName === 'SELECT') {
        options = Array.from(el.options).map(function(o){ return o.text.trim(); }).filter(Boolean);
    }

    return {
        id:              el.id || el.name || ('uv_' + Math.random().toString(36).substr(2,6)),
        label:           label,
        normalizedLabel: normalizedLabel,
        type:            (el.type||'text').toLowerCase(),
        componentType:   compType,
        required:        required,
        visible:         true,
        options:         options.slice(0,10),
        source:          source,
        confidence:      confidence,
        value:           null   // filled in after resolveValue
    };
}

// Store descriptors for the Field Review screen
uv.descriptors = [];
var uvDelay = window.delay || function(ms){return new Promise(function(r){setTimeout(r,ms);});};

// ─────────────────────────────────────────────────────────────
// LABEL DETECTION - Most comprehensive possible
// ─────────────────────────────────────────────────────────────
function getLabel(el) {
    if (!el) return '';
    var t = '';

    // Special early check: if name= contains countrycode/dialcode, return that directly
    // This prevents the "Mobile Phone" label bleeding onto the country code SELECT
    var nm0 = (el.name||'').toLowerCase();
    if (nm0.includes('countrycode') || nm0.includes('dialcode') || nm0.includes('isd')) {
        return 'Country Code';
    }

    // 1. Standard label[for]
    if (el.id) {
        var lf = document.querySelector('label[for="'+el.id+'"]');
        if (lf) t = lf.innerText||lf.textContent||'';
    }

    // 2. aria-label / aria-labelledby
    if (!t) t = el.getAttribute('aria-label')||'';
    if (!t) {
        var lid = el.getAttribute('aria-labelledby');
        if (lid) {
            var parts = lid.trim().split(/\s+/);
            var combined = parts.map(function(id){ var e=document.getElementById(id); return e?(e.innerText||e.textContent||''):''; }).join(' ');
            if (combined.trim()) t = combined;
        }
    }

    // 3. placeholder / title only (NOT name — name is last resort)
    if (!t) t = el.placeholder||'';
    if (!t) t = el.getAttribute('title')||'';

    // 4. data-* attributes
    if (!t) t = el.getAttribute('data-label')||el.getAttribute('data-field')||el.getAttribute('data-field-name')||el.getAttribute('data-placeholder')||'';

    // 5. Walk up DOM tree - check parent elements for label-like text
    if (!t) {
        var parent = el.parentElement;
        var checked = 0;
        while (parent && checked < 8) {
            var lblEls = parent.querySelectorAll(
                'label, .label, [class*="label"], [class*="Label"], legend, ' +
                'kendo-label, mat-label, .form-label, .field-label, .input-label, ' +
                '.ant-form-item-label label, .MuiFormLabel-root, .chakra-form__label, ' +
                '.k-label, .k-form-label, .form__label, .control-label, ' +
                'p.label, span.label, dt, th'
            );
            for (var li=0; li<lblEls.length; li++) {
                var lEl = lblEls[li];
                if (!lEl.contains(el)) {
                    var txt = (lEl.innerText||lEl.textContent||'').trim().replace(/\s+/g,' ').replace(/[*:]+$/,'').trim();
                    // Skip error messages / validation text / very long descriptions
                    if (txt.length > 1 && txt.length < 120 &&
                        !/unable to process|invalid|error|failed|not valid|please/i.test(txt)) {
                        t = txt; break;
                    }
                }
            }
            if (t) break;
            parent = parent.parentElement;
            checked++;
        }
    }

    // 6. Check immediate siblings — ONLY for radio/checkbox where label follows input
    // Restrict to <label> or <span> siblings only (not <div> which may contain other fields)
    if (!t) {
        var type6 = (el.type||'').toLowerCase();
        var isInlineControl = (type6 === 'radio' || type6 === 'checkbox');
        var next = el.nextElementSibling;
        if (next && isInlineControl) {
            var nextTag = (next.tagName||'').toUpperCase();
            // Only use label/span siblings — skip divs and other inputs
            if (nextTag === 'LABEL' || nextTag === 'SPAN') {
                var ntxt = (next.innerText||next.textContent||'').trim().replace(/\s+/g,' ');
                // Reject if it looks like an error message (too long) or contains 'error'/'invalid'
                if (ntxt.length > 1 && ntxt.length < 60 && !/error|invalid|required|please/i.test(ntxt)) {
                    t = ntxt;
                }
            }
        }
    }
    // Also check: label that immediately precedes input's parent
    // Only use for non-checkbox/radio — for checkboxes, distant labels are unreliable
    if (!t && el.parentElement) {
        var type7 = (el.type||'').toLowerCase();
        if (type7 !== 'checkbox' && type7 !== 'radio') {
            var prev = el.parentElement.previousElementSibling;
            if (prev) {
                var ptxt = (prev.innerText||prev.textContent||'').trim().replace(/\s+/g,' ');
                if (ptxt.length > 1 && ptxt.length < 80) t = ptxt;
            }
        }
    }

    // 7. Last resort: use name attribute (may be UUID/garbage for dynamic fields)
    if (!t) t = el.name ? el.name.replace(/[-_.]/g,' ').replace(/([a-z])([A-Z])/g,'$1 $2') : '';

    // Final: if label looks like a different field name (e.g. checkbox got "First Name"), clear it
    // so name-based resolveValue handles it instead
    var type8 = (el.type||'').toLowerCase();
    if (type8 === 'checkbox' && t && /^(first name|last name|email|phone|mobile)$/i.test(t.trim())) {
        t = ''; // will fall through to name-based match
    }

    return t.trim().replace(/[*:]+$/, '').replace(/^\s*[*:]+/, '').trim();
}

// ─────────────────────────────────────────────────────────────
// GET ALL FILLABLE ELEMENTS (including shadow DOM)
// ─────────────────────────────────────────────────────────────
function getAllElements(root, depth) {
    root = root || document;
    depth = depth || 0;
    if (depth > 5) return [];

    var sel = 'input:not([type="hidden"]):not([type="file"]):not([type="submit"])' +
              ':not([type="button"]):not([type="image"]):not([type="reset"]):not([type="search"]),' +
              'textarea, select';
    var els = Array.from(root.querySelectorAll(sel));

    // Pierce shadow DOM
    try {
        Array.from(root.querySelectorAll('*')).forEach(function(el) {
            if (el.shadowRoot) {
                try { els = els.concat(getAllElements(el.shadowRoot, depth+1)); } catch(e) {}
            }
        });
    } catch(e) {}

    return els;
}

// ─────────────────────────────────────────────────────────────
// FILL FUNCTIONS
// ─────────────────────────────────────────────────────────────
function fillInput(el, value) {
    if (!el || value===undefined||value===null||String(value)==='') return false;
    var v = String(value);
    try {
        var proto = (el.tagName==='TEXTAREA') ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        var d = Object.getOwnPropertyDescriptor(proto, 'value');
        if (d && d.set) { d.set.call(el, v); } else { el.value = v; }
        el.dispatchEvent(new Event('focus',  {bubbles:true}));
        el.dispatchEvent(new Event('input',  {bubbles:true}));
        el.dispatchEvent(new Event('change', {bubbles:true}));
        el.dispatchEvent(new KeyboardEvent('keyup', {bubbles:true}));
        el.dispatchEvent(new Event('blur',   {bubbles:true}));
        return true;
    } catch(e) {
        try { el.value = v; el.dispatchEvent(new Event('input',{bubbles:true})); return true; } catch(e2) { return false; }
    }
}

function fillSelect(sel, value) {
    if (!sel||!value) return false;
    var lc = String(value).toLowerCase().trim();
    var opts = Array.from(sel.options);

    // Special handling for country code selects (+91, +1, etc.)
    // Match the EXACT country code number to avoid +91 matching +917
    var ccMatch = lc.match(/^\+?(\d{1,4})$/);
    if (ccMatch) {
        var ccNum = ccMatch[1]; // e.g. "91"
        // Try exact value match first (value="91" or value="+91")
        var exactCC = opts.find(function(o) {
            var ov = (o.value||'').replace(/^\+/,'').trim();
            return ov === ccNum && !o.disabled;
        });
        if (!exactCC) {
            // Try text that STARTS with +XX and the XX matches exactly (not just prefix)
            exactCC = opts.find(function(o) {
                var ot = (o.text||'').trim();
                // Match "+91" at start of text, not followed by another digit
            return new RegExp('^\\+?' + ccNum + '(\\D|$)').test(ot) && !o.disabled;
            });
        }
        if (exactCC) {
            sel.value = exactCC.value;
            sel.dispatchEvent(new Event('change',{bubbles:true}));
            return true;
        }
    }

    // Pass 0: exact text/value   Pass 1: starts-with   Pass 2: includes
    for (var pass=0; pass<3; pass++) {
        var found = opts.find(function(o) {
            var ot = (o.text||'').toLowerCase().trim();
            var ov = (o.value||'').toLowerCase().trim();
            if (o.disabled) return false;
            if (pass===0) return ot===lc || ov===lc;
            if (pass===1) return ot.startsWith(lc) || (lc.startsWith(ot) && ot.length>2);
            return (ot.includes(lc) && lc.length>2) || (lc.includes(ot) && ot.length>2);
        });
        if (found) {
            sel.value = found.value;
            sel.dispatchEvent(new Event('change',{bubbles:true}));
            return true;
        }
    }
    return false;
}

// ─────────────────────────────────────────────────────────────
// CUSTOM DROPDOWN (React/Angular/Vue/Kendo/MUI)
// ─────────────────────────────────────────────────────────────
async function fillCustomDropdown(triggerEl, value) {
    if (!value) return false;
    var lc = String(value).toLowerCase().trim();

    triggerEl.click();
    triggerEl.dispatchEvent(new MouseEvent('mousedown',{bubbles:true}));
    await uvDelay(600);

    var optSelectors = [
        '[role="option"]','[role="menuitem"]','[role="listitem"]',
        '.k-list-item','.k-item',
        '.mat-option','.mat-select-panel mat-option',
        '.ant-select-item','.ant-dropdown-menu-item',
        '[class*="option"]:not(input)','[class*="menu-item"]',
        '.select2-results__option',
        'ul.dropdown li','ul.options li','.dropdown-item',
        '.vs__dropdown-option'
    ].join(',');

    var opts = Array.from(document.querySelectorAll(optSelectors)).filter(function(o) {
        var r=o.getBoundingClientRect(); return r.width>0&&r.height>0;
    });

    document.querySelectorAll('*').forEach(function(el) {
        if (el.shadowRoot) {
            try {
                Array.from(el.shadowRoot.querySelectorAll(optSelectors)).forEach(function(o) {
                    var r=o.getBoundingClientRect(); if(r.width>0&&r.height>0) opts.push(o);
                });
            } catch(e) {}
        }
    });

    if (opts.length === 0) { document.body.click(); return false; }

    var target = opts.find(function(o){return o.textContent.trim().toLowerCase()===lc;})
              || opts.find(function(o){return o.textContent.trim().toLowerCase().startsWith(lc);})
              || opts.find(function(o){return o.textContent.trim().toLowerCase().includes(lc)&&o.textContent.trim().length<60;})
              || (opts.length===1 ? opts[0] : null);

    if (target) {
        target.click();
        target.dispatchEvent(new MouseEvent('mouseup',{bubbles:true}));
        await uvDelay(300);
        console.log('[UV] Custom dropdown selected:', target.textContent.trim().substring(0,30));
        return true;
    }
    document.body.click();
    return false;
}

// ─────────────────────────────────────────────────────────────
// RADIO HANDLING
// ─────────────────────────────────────────────────────────────
function clickRadioByValue(name, value) {
    if (!name||!value) return false;
    var lc = value.toLowerCase().trim();
    var radios = Array.from(document.querySelectorAll('input[type="radio"][name="'+name+'"]'));
    if (!radios.length) return false;

    // Try to match by label text or value
    var target = radios.find(function(r) {
        var lbl = getLabel(r).toLowerCase();
        var val = (r.value||'').toLowerCase();
        return lbl===lc || val===lc || lbl.startsWith(lc) || lc.startsWith(lbl) && lbl.length>3 || lbl.includes(lc) && lc.length>3;
    });
    // yes/no / immediate fallbacks
    if (!target && (lc==='yes'||lc==='true'||lc==='immediate'||lc==='immediately')) target = radios[0];
    if (!target && (lc==='no'||lc==='false')) target = radios[radios.length-1];

    if (target) {
        if (!target.checked) target.click();
        target.dispatchEvent(new Event('change',{bubbles:true}));
        return true;
    }
    return false;
}

// Radio: find by label text ANYWHERE on page (for UUID-named radios)
function clickRadioByLabel(labelText) {
    if (!labelText) return false;
    var lc = labelText.toLowerCase().trim();
    var allRadios = Array.from(document.querySelectorAll('input[type="radio"]'));

    var target = allRadios.find(function(r) {
        // 1. standard label[for]
        if (r.id) {
            var lf = document.querySelector('label[for="'+r.id+'"]');
            if (lf) {
                var t = (lf.innerText||lf.textContent||'').trim().toLowerCase();
                if (t===lc||t.includes(lc)||(lc.includes(t)&&t.length>3)) return true;
            }
        }
        // 2. aria-label
        var al = (r.getAttribute('aria-label')||'').toLowerCase();
        if (al && (al===lc||al.includes(lc))) return true;

        // 3. next sibling (label after radio)
        var ns = r.nextElementSibling || r.nextSibling;
        if (ns) {
            var nt = (ns.textContent||'').trim().toLowerCase();
            if (nt===lc||nt.includes(lc)||(lc.includes(nt)&&nt.length>3)) return true;
        }

        // 4. parent element text (Keka puts label in parent div)
        var parent = r.parentElement;
        for (var d=0; d<4&&parent; d++) {
            var pt = (parent.innerText||parent.textContent||'').trim().toLowerCase()
                      .replace(/\s+/g,' ');
            // Only use if parent text is short enough to be a label
            if (pt.length < 60 && (pt===lc||pt.includes(lc)||(lc.includes(pt)&&pt.length>3))) return true;
            parent = parent.parentElement;
        }
        return false;
    });

    if (target) {
        if (!target.checked) target.click();
        target.dispatchEvent(new Event('change',{bubbles:true}));
        console.log('[UV] Radio clicked by label:', labelText);
        return true;
    }
    return false;
}

// ─────────────────────────────────────────────────────────────
// VALUE RESOLVER - Maps label → profile value (NO hardcoding)
// ─────────────────────────────────────────────────────────────
async function resolveValue(label, inputType, inputName, inputId, profile) {
    var p   = profile || {};
    var lc  = label.toLowerCase().replace(/\s+/g,' ').trim();
    var nm  = (inputName||'').toLowerCase();   // e.g. "mobilephone.countrycode"
    var id  = (inputId||'').toLowerCase();     // e.g. "locationpreference"

    // Build profile values from resume data
    var fn      = p.first_name  || (p.personal&&p.personal.first_name)  || '';
    var mn      = p.middle_name || (p.personal&&p.personal.middle_name) || '';
    var ln      = p.last_name   || (p.personal&&p.personal.last_name)   || '';
    var full    = (fn+(mn?' '+mn:'')+(ln?' '+ln:'')).trim();
    var email   = (p.contact&&p.contact.email)  || p.email  || '';
    var phone   = (p.contact&&p.contact.phone)  || p.phone  || '';
    var city    = ((p.contact&&p.contact.city)  || p.city   || '').split(',')[0].trim();
    var pstate  = (p.contact&&p.contact.state)  || p.state  || '';
    var country = (p.contact&&p.contact.country)|| p.country|| 'India';
    var zip     = (p.contact&&p.contact.postal_code)||p.postal_code||'';
    var addr    = (p.contact&&p.contact.address)||p.address||'';
    var linkedin    = (p.social&&p.social.linkedin)  || p.linkedin  || '';
    var github      = (p.social&&p.social.github)    || p.github    || '';
    var portfolio   = (p.social&&p.social.portfolio) || p.portfolio || '';
    var exp         = p.experience || [];
    var edu         = p.education  || [];
    var skills      = p.skills     || [];
    var curExp      = exp.length>0 ? exp[0] : null;
    var curEdu      = edu.length>0 ? edu[0] : null;
    if (linkedin&&!linkedin.startsWith('http')) linkedin='https://www.linkedin.com/in/'+linkedin;

    // Phone: strip country code for local-phone-only fields
    // Phone format: +917989168768 (India) = +91 + 10 digits
    var localPhone = phone;
    var phoneCC = '+91'; // default India
    if (phone && phone.startsWith('+')) {
        var digits = phone.slice(1); // remove leading +, e.g. "917989168768"
        // Known country code lengths: India(+91)=2, US(+1)=1, UK(+44)=2, etc.
        // Strategy: local numbers are 10 digits. CC = total_digits - 10
        var localLen = 10;
        var ccLen = digits.length - localLen; // e.g. 12-10=2 → CC is "91"
        if (ccLen >= 1 && ccLen <= 3) {
            phoneCC = '+' + digits.slice(0, ccLen);
            localPhone = digits.slice(ccLen);
        } else if (digits.length === 11) {
            // e.g. US: +1 + 10 digits
            phoneCC = '+' + digits.slice(0, 1);
            localPhone = digits.slice(1);
        } else {
            // Fallback: strip up to 3 leading digits
            phoneCC = '+' + digits.slice(0, 2);
            localPhone = digits.slice(2);
        }
    }

    // Total years of experience (numeric)
    var totalExpYears = '0';
    if (exp.length > 0) {
        var yrs = 0;
        exp.forEach(function(e) {
            var from = parseInt(e.from||e.start_year||e.start||0);
            var to   = parseInt(e.to||e.end_year||e.end||new Date().getFullYear());
            if (from && to) yrs += (to - from);
        });
        totalExpYears = yrs > 0 ? String(yrs) : '1';
    }
    var totalExpMonths = '0'; // default months part

    // ── KEKA / site-specific field name matching (by name= or id=) ──────────────
    // These match EXACT field names from Keka DOM audit so they always work
    if (nm==='firstname'||id==='firstname') return fn;
    if (nm==='middlename'||id==='middlename') return mn;
    if (nm==='lastname'||id==='lastname') return ln;
    if (nm==='email'||id==='email') return email;
    if (nm==='mobilephone.number'||id==='mobilephone.number') return localPhone;
    if (nm==='mobilephone.countrycode'||id==='mobilephone.countrycode') return phoneCC;
    if (nm==='gender'||id==='gender') {
        var g = (p.gender||p.personal&&p.personal.gender||'').toLowerCase();
        if (g==='male'||g==='m') return 'Male';
        if (g==='female'||g==='f') return 'Female';
        return ''; // don't guess gender
    }
    if (nm==='standardfields.dateofbirth.answer'||id==='dateofbirth') {
        return (p.date_of_birth||p.dob||p.personal&&p.personal.date_of_birth||'');
    }
    if (nm==='workexperience.years'||id==='workexperience') return totalExpYears;
    if (nm==='workexperience.months') return totalExpMonths;
    if (nm==='currentsalary.amount'||id==='currentsalary') {
        // Fresher: leave blank (no salary to declare), experienced: use profile or placeholder
        if (exp.length === 0) return '';
        return p.current_salary || p.salary || '';
    }
    if (nm==='currentsalary.currency'||id==='currentsalary.currency') return 'INR';
    if (nm==='expectedsalary.amount'||id==='expectedsalary') {
        return p.expected_salary || p.salary_expectation || '';
    }
    if (nm==='expectedsalary.currency'||id==='expectedsalary.currency') return 'INR';
    if (nm==='standardfields.availability.answer'||id==='availability') return '0';
    if (nm==='standardfields.locationpreference.answer'||id==='locationpreference') {
        // Return city first; if it doesn't match the SELECT options, the fillSelect
        // will try includes-match. If still no match, return state then country.
        return city || pstate || country;
    }
    if (nm==='standardfields.currentlocation.answer'||nm==='standardfields.currentlocation'||id==='currentlocation') return city;
    if (id==='skills') return skills.slice(0,6).join(', ');
    if (nm==='candidateconsent'||id==='candidateconsent') return 'true';
    // Keka notice period radio: "Immediate Joiner" option
    // UUID-named radio groups — value returned is used by clickRadioByLabel fallback
    if (nm.includes('b48222b0')) return 'Immediate Joiner';

    // ── LABEL-BASED matching (universal for all sites) ───────────────────────
    // NAME
    if (/^(name|full name|your name|candidate name|applicant name)$/.test(lc)) return full;
    if (/^(first name|given name|firstname)$/.test(lc)) return fn;
    if (/^(middle name|middle initial)$/.test(lc)) return mn;
    if (/^(last name|surname|family name|lastname)$/.test(lc)) return ln;
    if (/first.?name/i.test(lc)&&!/last/i.test(lc)) return fn;
    if (/last.?name|surname|family.?name/i.test(lc)) return ln;
    if (/middle.?name/i.test(lc)) return mn;
    if (/\bname\b/.test(lc)&&!/company|org|school|college|last|file|brand|user|nick/i.test(lc)) return full;

    // CONTACT
    if (/email|e-mail/.test(lc)) return email;
    if (/\bphone\b|\bmobile\b|\bcell\b|contact.*(no|number)|^tel\b/.test(lc)) return localPhone;
    if (/country.*code|dial.*code|isd/.test(lc)) return phoneCC;
    if (/\baddress\b/.test(lc)&&!/email/.test(lc)) return addr;
    if (/^city$|current.?city|city.?name/.test(lc)) return city;
    if (/\bstate\b|\bprovince\b/.test(lc)&&!/(united )?states/.test(lc)) return pstate;
    if (/\bcountry\b/.test(lc)&&!/nationality/.test(lc)) return country;
    if (/pincode|pin code|zip|postal/.test(lc)) return zip;
    if (/current.?location|preferred.?location|location.?prefer/.test(lc)) return city+(pstate?', '+pstate:'');
    if (/\blocation\b/.test(lc)&&!/office|job/.test(lc)) return city;

    // LINKS / SOCIAL
    if (/linkedin/.test(lc)) return linkedin;
    if (/github/.test(lc)) return github;
    if (/portfolio|personal.*site|personal.*url|website/.test(lc)) return portfolio||github||linkedin;
    if (/twitter|x\.com/.test(lc)) return (p.social&&p.social.twitter)||'';

    // EDUCATION
    if (/college|university|institution|school/.test(lc)&&!/high.?school|secondary/.test(lc)) {
        return curEdu ? (curEdu.institution||curEdu.school||'').split(',')[0].trim() : '';
    }
    if (/degree|qualification|highest.*edu|education.*level/.test(lc)) return curEdu?(curEdu.degree||''):'';
    if (/branch|major|specializ|field.*study|stream|discipline/.test(lc)) return curEdu?(curEdu.field_of_study||curEdu.field||''):'';
    if (/year.*pass|passout|graduation.*year|year.*grad|passed.*out/.test(lc)) return curEdu?String(curEdu.to||curEdu.end_year||''):'';
    if (/cgpa|gpa|percentage|aggregate|marks/.test(lc)) return curEdu?(curEdu.gpa||''):'';
    if (/tenth|10th|ssc|secondary/.test(lc)) {
        var tenth = edu.find(function(e){return /10th|ssc|secondary/i.test(e.degree||e.level||'');});
        return tenth ? (tenth.institution||tenth.school||'') : '';
    }
    if (/twelfth|12th|inter|intermediate|hsc|higher secondary/.test(lc)) {
        var twelfth = edu.find(function(e){return /12th|inter|hsc/i.test(e.degree||e.level||'');});
        return twelfth ? (twelfth.institution||twelfth.school||'') : '';
    }

    // EXPERIENCE
    if (/current.*company|current.*employer|present.*company/.test(lc)) return curExp?(curExp.company||''):'Fresher';
    if (/current.*designation|current.*title|current.*role|current.*position/.test(lc)) return curExp?(curExp.title||curExp.job_title||''):'Fresher';
    if (/total.*exp|years.*exp|exp.*years|work.*exp|experience.*year|no.*of.*year/.test(lc)) return totalExpYears;
    if (/relevant.*exp|experience.*role|experience.*similar/.test(lc)) return exp.length>0?totalExpYears+' year(s)':'Fresher';
    if (/months.*exp|exp.*months/.test(lc)) return totalExpMonths;

    // SKILLS
    if (/\bskills\b|technical.*skills|key.*skills/.test(lc)) return skills.slice(0,8).join(', ');

    // COMMON FACTUAL APPLICATION QUESTIONS (template, no AI needed)
    if (/notice.*period|serving.*notice/.test(lc)) return 'Immediate';
    if (/available.*join|when.*can.*join|when.*join|join.*date|available.*start|earliest.*start/.test(lc)) return 'Immediately';
    if (/current.*ctc|current.*salary|last.*drawn|current.*package/.test(lc)) return exp.length>0?(p.current_salary||'As per market standards'):'Fresher / First job';
    if (/expected.*ctc|expected.*salary|desired.*salary|expected.*package/.test(lc)) return p.expected_salary||'Open to discussion';
    if (/hours.*work|working.*hours|hrs.*work/.test(lc)) return '40';
    if (/shift.*prefer|prefer.*shift/.test(lc)) return 'Day shift';
    if (/relocat/.test(lc)) return 'Yes';
    if (/how.*hear|how.*know|how.*find|come.*know|source.*apply/.test(lc)) return 'LinkedIn';
    if (/nationality|citizen/.test(lc)) return 'Indian';
    if (/language/.test(lc)&&!/programming|coding/.test(lc)) return 'English, Telugu';
    if (/referred.*by|referral|reference/.test(lc)) return 'Online job portal';
    if (/gender/.test(lc)) {
        var g2 = (p.gender||p.personal&&p.personal.gender||'').toLowerCase();
        if (g2==='male'||g2==='m') return 'Male';
        if (g2==='female'||g2==='f') return 'Female';
        return '';
    }

    // RADIO yes/no contextual
    if (inputType === 'radio') {
        if (/do you have|are you|have you|will you|can you/.test(lc)) return 'Yes';
    }

    // AI for open-ended questions (textarea / descriptive text)
    if (inputType==='textarea' || inputType==='text' || inputType==='') {
        if (window.isAIQuestion && window.isAIQuestion(label)) {
            var aiAnswer = await window.getAIAnswer(label, profile);
            return aiAnswer || null;
        }
    }

    return null;
}

// ─────────────────────────────────────────────────────────────
// MAIN FILL FUNCTION
// ─────────────────────────────────────────────────────────────
async function uvFill(profile) {
    console.log('[UV] Starting on', location.hostname);
    var filled = 0;
    var p = profile || {};
    var handledRadioGroups = new Set(); // prevent re-processing same radio group

    // ── 1. Standard inputs ───────────────────────────────────
    var allEls = getAllElements(document);
    var visible = allEls.filter(function(el) {
        var r = el.getBoundingClientRect();
        return r.width>0 && r.height>0 && !el.disabled && !el.readOnly;
    });
    console.log('[UV] Visible inputs:', visible.length);

    // Build FieldDescriptors for all visible fields (Phase 3)
    uv.descriptors = [];

    for (var i=0; i<visible.length; i++) {
        var el = visible[i];
        if (uv.filled.has(el)) continue;

        var tag  = el.tagName.toUpperCase();
        var type = (el.type||'text').toLowerCase();
        var nm   = el.name||'';
        var id   = el.id||'';

        if (['file','submit','button','image','hidden','reset','search','captcha'].includes(type)) continue;
        if (id==='captcha'||nm==='captcha') continue; // never fill captcha

        // Skip non-empty fields (except radio/checkbox which need to be evaluated)
        if (el.value && el.value.trim()!=='' && type!=='radio' && type!=='checkbox') continue;

        var label = getLabel(el);
        // If label looks like a UUID/garbage name (from field name fallback), blank it
        // so name-based resolveValue handles it instead
        if (label && /[0-9a-f]{8}-[0-9a-f]{4}/i.test(label)) label = '';
        // If no label at all, try to use name/id as label hint for non-radio fields
        if (!label && nm && type !== 'radio') label = nm.replace(/[-_.]/g,' ').replace(/([a-z])([A-Z])/g,'$1 $2');
        if (!label && id && type !== 'radio') label = id.replace(/[-_.]/g,' ').replace(/([a-z])([A-Z])/g,'$1 $2');
        if (!label && type !== 'radio') continue;
        if (!label) label = nm; // for radio: pass raw name to resolveValue for UUID matching

        console.log('[UV] Field: "'+label.substring(0,40)+'" | '+tag+' '+type+' name='+nm.substring(0,30));

        var val = await resolveValue(label, type, nm, id, p);
        if (val===null||val===undefined||String(val)==='') continue;

        var ok = false;

        if (tag==='SELECT') {
            ok = fillSelect(el, val);
            // For location/preference selects: if value didn't match any option,
            // pick the first non-empty option (any location is better than none)
            if (!ok && (id.includes('location') || id.includes('prefer') || nm.includes('location') || nm.includes('prefer'))) {
                if (!ok) {
                    var firstOpt = Array.from(el.options).find(function(o){ return o.value && !o.disabled && !/select|choose|--/i.test(o.text); });
                    if (firstOpt) { el.value = firstOpt.value; el.dispatchEvent(new Event('change',{bubbles:true})); ok=true; }
                }
            }
        } else if (type==='radio') {
            // Each radio group (same name) should only be handled once
            var radioGroupKey = nm || id || label;
            if (handledRadioGroups.has(radioGroupKey)) { continue; }

            // Try 1: match by name+label within the group
            ok = clickRadioByValue(nm||id, val);
            // Try 2: search ALL radios on page by label text (UUID names, Keka etc.)
            if (!ok) ok = clickRadioByLabel(val);
            // Try 3: this specific radio's own label matches
            if (!ok) {
                var rl = getLabel(el).toLowerCase();
                var vl = val.toLowerCase();
                if (rl===vl || rl.includes(vl) || (vl.includes(rl) && rl.length>3)) {
                    el.click();
                    el.dispatchEvent(new Event('change',{bubbles:true}));
                    ok = true;
                }
            }
            if (ok) handledRadioGroups.add(radioGroupKey);
        } else if (type==='checkbox') {
            var shouldCheck = /^(yes|true|1|on|checked)$/i.test(String(val));
            if (shouldCheck && !el.checked) { el.click(); ok=true; }
            else if (!shouldCheck && el.checked) { el.click(); ok=true; }
            else ok = true; // already correct state
        } else {
            ok = fillInput(el, val);
        }

        if (ok) {
            uv.filled.add(el);
            filled++;
            console.log('[UV] FILLED "'+label.substring(0,35)+'" = "'+String(val).substring(0,30)+'"');
        }
        await uvDelay(60);
    }

    // ── 2. Custom dropdowns (React/Angular/Kendo/MUI/etc) ────
    var dropdownTriggers = Array.from(document.querySelectorAll([
        '[role="combobox"]',
        '[aria-haspopup="listbox"]',
        '[aria-haspopup="true"]',
        '.k-dropdownlist',
        '.k-combobox .k-input',
        '[class*="select__control"]',
        '.ant-select-selector',
        '.mat-select-trigger',
        '.vs__selected-options',
        '[class*="dropdown-toggle"]',
        '[class*="Select__control"]'
    ].join(','))).filter(function(el) {
        var r=el.getBoundingClientRect();
        return r.width>0 && r.height>0 && !uv.filled.has(el);
    });

    for (var di=0; di<dropdownTriggers.length; di++) {
        var dd = dropdownTriggers[di];
        var currentVal = dd.textContent.trim();
        if (currentVal && !/select|choose|pick|--|none/i.test(currentVal) && currentVal.length<50) continue;

        var ddNm  = dd.name||dd.getAttribute('data-name')||'';
        var ddId  = dd.id||dd.getAttribute('data-id')||'';
        var ddLabel = getLabel(dd);
        if (!ddLabel) {
            var par = dd.parentElement;
            for (var pd=0; pd<5&&par; pd++) {
                var lEls = par.querySelectorAll('label,[class*="label"],[class*="Label"]');
                for (var li2=0; li2<lEls.length; li2++) {
                    if (!lEls[li2].contains(dd)) {
                        var t2 = (lEls[li2].innerText||lEls[li2].textContent||'').trim();
                        if (t2) { ddLabel=t2; break; }
                    }
                }
                if (ddLabel) break;
                par = par.parentElement;
            }
        }
        if (!ddLabel) continue;

        var ddVal = await resolveValue(ddLabel, 'select', ddNm, ddId, p);
        if (!ddVal) continue;

        var ddOk = await fillCustomDropdown(dd, ddVal);
        if (ddOk) { uv.filled.add(dd); filled++; }
        await uvDelay(200);
    }

    console.log('[UV] Done. Total filled:', filled);

    // Expose descriptors for Field Review screen (Phase 3)
    try {
        var exportable = uv.descriptors.map(function(d){
            return { label:d.label, normalizedLabel:d.normalizedLabel, source:d.source,
                     confidence:d.confidence, value:d.value ? String(d.value).substring(0,40) : '',
                     componentType:d.componentType, required:d.required };
        });
        chrome.storage.local.set({ uvDescriptors: exportable });
    } catch(e) {}

    // ── 3. Post-pass: Handle notice period / availability radio groups ────────
    // Some sites use UUID-named radio groups that the main loop may miss.
    // Explicitly look for "Immediate Joiner" / "immediate" / "0 days" options.
    var noticePeriodOptions = ['Immediate Joiner', 'Immediate', '0 days', 'Immediately Available'];
    var noticeClicked = false;
    for (var ni = 0; ni < noticePeriodOptions.length && !noticeClicked; ni++) {
        noticeClicked = clickRadioByLabel(noticePeriodOptions[ni]);
    }
    if (noticeClicked) {
        filled++;
        console.log('[UV] Post-pass: Immediate Joiner radio clicked');
    }

    // ── Phase 6: Repair loop on required fields still empty ──
    await uvDelay(500); // wait for any React re-renders
    var failedFields = getAllElements(document).filter(function(el) {
        var r = el.getBoundingClientRect();
        if (r.width === 0 || el.disabled || el.readOnly) return false;
        if (uv.filled.has(el)) return false;
        var type6 = (el.type||'').toLowerCase();
        if (['file','submit','button','image','hidden','reset','search','checkbox','radio'].includes(type6)) return false;
        if (el.required && !(el.value||'').trim()) return true;
        return false;
    });

    if (failedFields.length > 0) {
        console.log('[UV] Repair loop: ' + failedFields.length + ' required fields still empty');
        for (var ri = 0; ri < Math.min(failedFields.length, 5); ri++) {
            var rEl = failedFields[ri];
            var rLabel = getLabel(rEl);
            if (!rLabel) continue;
            var rVal = await resolveValue(rLabel, (rEl.type||'text'), rEl.name||'', rEl.id||'', p);
            if (!rVal) continue;
            for (var attempt = 1; attempt <= 3; attempt++) {
                var repaired = await repairField(rEl, rLabel, rVal, p, attempt);
                if (repaired) { filled++; uv.filled.add(rEl); break; }
            }
        }
    }

    return filled;
}

// ─────────────────────────────────────────────────────────────
// PHASE 6a — BOUNDED REPAIR LOOP
// ─────────────────────────────────────────────────────────────
async function repairField(el, label, val, profile, attempt) {
    if (!el || attempt > 3) return false;
    var tag  = el.tagName.toUpperCase();
    var type = (el.type || 'text').toLowerCase();

    console.log('[UV] Repair attempt ' + attempt + ' for "' + label + '"');

    // Re-check element is still in DOM
    if (!document.contains(el) && !(el.getRootNode && el.getRootNode().host)) {
        var allEls = getAllElements(document);
        var found = allEls.find(function(e) {
            return getLabel(e).toLowerCase() === label.toLowerCase();
        });
        if (!found) return false;
        el = found;
    }

    if (attempt === 1) {
        // Strategy 1: click + focus + type char by char simulation
        el.click(); el.focus();
        await uvDelay(100);
        el.value = '';
        var v1 = String(val);
        for (var ci = 0; ci < v1.length; ci++) {
            el.dispatchEvent(new KeyboardEvent('keydown',  {key: v1[ci], bubbles: true}));
            el.dispatchEvent(new KeyboardEvent('keypress', {key: v1[ci], bubbles: true}));
            var proto1 = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
            if (proto1 && proto1.set) proto1.set.call(el, el.value + v1[ci]);
            else el.value = el.value + v1[ci];
            el.dispatchEvent(new KeyboardEvent('keyup', {key: v1[ci], bubbles: true}));
            el.dispatchEvent(new Event('input', {bubbles: true}));
        }
        el.dispatchEvent(new Event('change', {bubbles: true}));
        el.dispatchEvent(new Event('blur',   {bubbles: true}));
    } else if (attempt === 2) {
        // Strategy 2: execCommand insertText
        el.click(); el.focus();
        document.execCommand('selectAll', false, null);
        document.execCommand('insertText', false, String(val));
        el.dispatchEvent(new Event('change', {bubbles: true}));
    } else {
        // Strategy 3: direct assignment with all framework events
        el.value = String(val);
        ['input', 'change', 'blur'].forEach(function(ev) {
            el.dispatchEvent(new Event(ev, {bubbles: true, composed: true}));
        });
        // Also try CustomEvent for Angular/Lit
        el.dispatchEvent(new CustomEvent('spl-change', {
            bubbles: true, composed: true, detail: {value: String(val)}
        }));
    }

    await uvDelay(200);

    var verifyOk = (el.value || '').trim() !== '' && el.getAttribute('aria-invalid') !== 'true';
    if (verifyOk) {
        console.log('[UV] Repair SUCCESS attempt ' + attempt + ' for "' + label + '"');
    }
    return verifyOk;
}

// ─────────────────────────────────────────────────────────────
// PHASE 6b — MULTI-STEP / DYNAMIC PAGE OBSERVER
// ─────────────────────────────────────────────────────────────
var uvObserver = null;
var uvObserverDebounce = null;

function setupMultiStepObserver(profile) {
    if (uvObserver) return; // already active

    var lastFieldCount = 0;

    uvObserver = new MutationObserver(function(mutations) {
        clearTimeout(uvObserverDebounce);
        uvObserverDebounce = setTimeout(function() {
            if (uv.busy) return; // don't scan while filling

            var allEls = getAllElements(document);
            var visible = allEls.filter(function(el) {
                var r = el.getBoundingClientRect();
                return r.width > 0 && r.height > 0 && !el.disabled && !el.readOnly;
            });

            var newCount = visible.filter(function(el) {
                return !uv.filled.has(el);
            }).length;

            if (newCount > 0 && newCount !== lastFieldCount) {
                lastFieldCount = newCount;
                console.log('[UV] Multi-step: ' + newCount + ' new fields detected, auto-filling');
                chrome.storage.local.get(['userProfile'], function(r) {
                    var p = r && r.userProfile;
                    if (p) {
                        uvFill(p).then(function(n) {
                            if (n > 0) console.log('[UV] Multi-step filled ' + n + ' new fields');
                        }).catch(function() {});
                    }
                });
            }
        }, 1500);
    });

    if (profile) {
        uvObserver.observe(document.body, {childList: true, subtree: true});
        console.log('[UV] Multi-step observer active');
    }
}

function teardownMultiStepObserver() {
    if (uvObserver) { uvObserver.disconnect(); uvObserver = null; }
    clearTimeout(uvObserverDebounce);
}

// ─────────────────────────────────────────────────────────────
// MESSAGE LISTENER
// ─────────────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener(function(msg, sender, sendResponse) {
    if (!msg||!msg.type) return false;

    if (msg.type==='PERFORM_AUTO_FILL'||msg.type==='AUTOFILL_START'||msg.type==='AUTO_FILL_FORM') {
        if (uv.busy) { sendResponse({success:false, error:'Already filling'}); return false; }
        var profile = msg.userProfile||msg.profile||msg.data||null;
        uv.busy = true;
        if (msg.backendUrl) window.AUTOFILL_BACKEND_URL = msg.backendUrl;

        function go(p) {
            try { window.showToast('AutoFill starting...','success'); } catch(e) {}
            uvFill(p).then(function(n) {
                uv.busy = false;
                chrome.storage.local.set({fieldsFilled:n, autofillStatus:'done'}).catch(function(){});
                try { window.showToast('AutoFill: '+n+' field(s) filled.','success'); } catch(e) {}
                try { sendResponse({success:true,filled:n,result:{filledCount:n,skippedCount:0}}); } catch(e) {}
                // Phase 6d: activate multi-step observer after initial fill
                try { setupMultiStepObserver(p); } catch(e) {}
            }).catch(function(err) {
                uv.busy = false;
                console.error('[UV] Error:', err.message);
                try { sendResponse({success:false,error:err.message}); } catch(e) {}
            });
        }

        if (!profile) {
            chrome.storage.local.get(['userProfile'], function(r) {
                var sp = r&&r.userProfile;
                if (!sp) {
                    sendResponse({success:false,error:'No profile. Upload resume first.'});
                    uv.busy=false;
                    return;
                }
                go(sp);
            });
            return true;
        }
        go(profile);
        return true;
    }

    if (msg.type==='PING') { sendResponse({alive:true,platform:'universal'}); return false; }
    if (msg.type==='DETECT_PLATFORM') { sendResponse({success:true,platform:'universal'}); return false; }
    return false;
});

console.log('[Universal] autoFill-universal.js loaded on', location.hostname);
})(); // end IIFE
