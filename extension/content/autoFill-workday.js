// autoFill-workday.js - Workday ONLY
// Loaded exclusively on *myworkdayjobs.com and *.workday.com via manifest.json
// Depends on: shared.js (loaded before this file)

if (window.__workdayFillInitialized) {
    console.log('[Workday] already initialized, skipping');
} else {
window.__workdayFillInitialized = true;

var wdState = { filledElements: new Set(), isFilling: false };
// Fallback helpers if shared.js didn't load
if (typeof window.delay === 'undefined') {
    window.delay = function(ms) { return new Promise(function(r) { setTimeout(r, ms); }); };
}
if (typeof window.showToast === 'undefined') {
    window.showToast = function(msg, type) { console.log('[Toast]', type, ':', msg); };
}
if (typeof window.isFieldFillable === 'undefined') {
    window.isFieldFillable = function(el) {
        if (!el) return false;
        var r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0 && !el.disabled && !el.readOnly;
    };
}
if (typeof window.fillField === 'undefined') {
    window.fillField = function(el, value) {
        if (!el || !value) return false;
        try {
            var ns = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
            ns.call(el, value);
            el.dispatchEvent(new Event('input', {bubbles:true}));
            el.dispatchEvent(new Event('change', {bubbles:true}));
            return true;
        } catch(e) {
            el.value = value;
            return true;
        }
    };
}
if (typeof window.getLabelForElement === 'undefined') {
    window.getLabelForElement = function(el) {
        if (!el) return '';
        if (el.id) {
            var lbl = document.querySelector('label[for="' + el.id + '"]');
            if (lbl) return lbl.textContent.trim();
        }
        if (el.getAttribute('aria-label')) return el.getAttribute('aria-label');
        if (el.placeholder) return el.placeholder;
        return '';
    };
}
if (typeof window.isAIQuestion === 'undefined') {
    window.isAIQuestion = function(label) {
        var lc = label.toLowerCase();
        return lc.includes('why') || lc.includes('describe') || lc.includes('tell us') || 
               lc.includes('cover letter') || lc.includes('additional') || lc.length > 100;
    };
}
if (typeof window.getAIAnswer === 'undefined') {
    window.getAIAnswer = async function(question, profile) {
        try {
            var backendUrl = window.AUTOFILL_BACKEND_URL || 'http://127.0.0.1:5000';
            var response = await fetch(backendUrl + '/api/v1/ai/answer-question', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({question: question, profile: profile})
            });
            if (response.ok) {
                var data = await response.json();
                return data.answer || null;
            }
        } catch(e) {
            console.warn('[WD] AI answer failed:', e.message);
        }
        return null;
    };
}


// -- Helper: type value char-by-char into React input ----------
async function wdTypeInto(el, value) {
    if (!el || !value) return;
    el.focus();
    // Get native setter - must be called with .call(el, ...) not directly
    var nativeInputDesc = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value');
    var nativeTextareaDesc = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value');
    var ns = (nativeInputDesc && nativeInputDesc.set) || (nativeTextareaDesc && nativeTextareaDesc.set);
    var cur = '';
    for (var i = 0; i < value.length; i++) {
        var ch = value[i], kc = ch.charCodeAt(0);
        cur += ch;
        el.dispatchEvent(new KeyboardEvent('keydown', {key:ch, keyCode:kc, bubbles:true}));
        try { if (ns) ns.call(el, cur); else el.value = cur; } catch(e) { el.value = cur; }
        el.dispatchEvent(new InputEvent('input', {bubbles:true, inputType:'insertText', data:ch}));
        el.dispatchEvent(new KeyboardEvent('keyup', {key:ch, keyCode:kc, bubbles:true}));
        await window.delay(30);
    }
    el.dispatchEvent(new Event('change', {bubbles:true}));
    el.dispatchEvent(new Event('blur',   {bubbles:true}));
}

// -- Helper: click an "Add" or "Add Another" button by its h4 heading --
async function wdClickAddButton(sectionText) {
    // Find h4 containing the section name
    var headings = Array.from(document.querySelectorAll('h4'));
    var h = headings.find(function(h4) {
        return h4.textContent.trim().toLowerCase().includes(sectionText.toLowerCase());
    });

    if (h) {
        // Walk the parent tree looking for Add / Add Another button
        var searchRoot = h.parentElement;
        for (var depth = 0; depth < 6 && searchRoot; depth++) {
            var btns = Array.from(searchRoot.querySelectorAll('button'));
            var btn = btns.find(function(b) {
                var t = b.textContent.trim();
                return t === 'Add' || t === 'Add Another' || t === 'Add another';
            });
            if (btn) { btn.click(); await window.delay(1500); return true; }
            searchRoot = searchRoot.parentElement;
        }
    }

    // Fallback: index-based for known sections
    // Work Experience=0, Education=1, Certifications=2, Websites=3
    var allAddBtns = Array.from(document.querySelectorAll('button')).filter(function(b) {
        var t = b.textContent.trim();
        return t === 'Add' || t === 'Add Another' || t === 'Add another';
    });
    var idx = ['work experience','education','certifications','websites']
               .indexOf(sectionText.toLowerCase());
    if (idx >= 0 && allAddBtns[idx]) {
        allAddBtns[idx].click(); await window.delay(1500); return true;
    }
    return false;
}

// -- Helper: fill dialog field by label text -------------------
async function wdFillDialogField(labelText, value) {
    if (!value) return false;
    var inputs = Array.from(document.querySelectorAll('input, textarea, select'));
    for (var i = 0; i < inputs.length; i++) {
        var inp = inputs[i];
        var rect = inp.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0 || inp.disabled || inp.readOnly) continue;
        var lbl = '';
        if (inp.id) { var lE = document.querySelector('label[for="'+inp.id+'"]'); if (lE) lbl = lE.textContent.trim(); }
        if (!lbl && inp.getAttribute('aria-label')) lbl = inp.getAttribute('aria-label');
        if (!lbl && inp.placeholder) lbl = inp.placeholder;
        if (!lbl) continue;
        if (lbl.toLowerCase().includes(labelText.toLowerCase())) {
            if (inp.tagName === 'SELECT') {
                for (var j = 0; j < inp.options.length; j++) {
                    if (inp.options[j].text.toLowerCase().includes(value.toLowerCase())) {
                        inp.selectedIndex = j; inp.dispatchEvent(new Event('change',{bubbles:true})); return true;
                    }
                }
            } else {
                await wdTypeInto(inp, value);
                await window.delay(400);
                var opts = Array.from(document.querySelectorAll('[role="option"],[class*="option"]')).filter(function(o){
                    var r2 = o.getBoundingClientRect(); return r2.width>0 && r2.height>0;
                });
                if (opts.length > 0) {
                    var match = opts.find(function(o){ return o.textContent.trim().toLowerCase().includes(value.toLowerCase()); }) || opts[0];
                    match.click(); await window.delay(200);
                }
                return true;
            }
        }
    }
    return false;
}

// -- Helper: click Save/OK inside dialog -----------------------
async function wdClickDialogSave() {
    await window.delay(300);
    var saveBtn = Array.from(document.querySelectorAll('button')).find(function(b) {
        var t = b.textContent.trim().toLowerCase();
        return t === 'save' || t === 'ok' || t === 'done';
    });
    if (saveBtn) { saveBtn.click(); await window.delay(800); return true; }
    return false;
}

// --------------------------------------------------------------
// SECTION 1: MY INFORMATION
// --------------------------------------------------------------
async function wdFillMyInformation(p) {
    console.log('[WD] Section 1: My Information START');
    var filled = 0;
    var firstName  = p.first_name  || (p.personal && p.personal.first_name)  || '';
    var middleName = p.middle_name || (p.personal && p.personal.middle_name) || '';
    var lastName   = p.last_name   || (p.personal && p.personal.last_name)   || '';
    var phoneRaw   = (p.contact && p.contact.phone)       || p.phone       || '';
    var address    = (p.contact && p.contact.address)     || p.address     || '';
    var city       = ((p.contact && p.contact.city) || p.city || '').split(',')[0].trim();
    var postalCode = (p.contact && p.contact.postal_code) || p.postal_code || '';
    var country    = (p.contact && p.contact.country)     || p.country     || '';
    var extension  = (p.contact && p.contact.phone_extension) || '';
    var hasWorked  = p.has_worked_at_workday === true;

    // Strip country code from phone e.g. +917989168768 ? 7989168768
    var phone = phoneRaw;
    if (phoneRaw.startsWith('+')) {
        var d = phoneRaw.slice(1);
        if (d.length === 12)      phone = d.slice(2);
        else if (d.length === 11) phone = d.slice(1);
        else if (d.length === 13) phone = d.slice(3);
        else phone = d.replace(/^\d{1,3}/, '') || d;
    }

    // Derive country name from phone prefix
    var ccMap = {'+1':'United States','+44':'United Kingdom','+91':'India','+61':'Australia',
        '+49':'Germany','+33':'France','+81':'Japan','+82':'South Korea','+86':'China',
        '+55':'Brazil','+52':'Mexico','+65':'Singapore','+60':'Malaysia','+971':'United Arab Emirates'};
    var phoneCountryName = '';
    if (phoneRaw.startsWith('+')) {
        for (var pc in ccMap) { if (phoneRaw.startsWith(pc)) { phoneCountryName = ccMap[pc]; break; } }
    }
    if (!phoneCountryName) phoneCountryName = country;

    // Fill text fields by confirmed Workday IDs
    var textFields = [
        {id:'name--legalName--firstName',    v:firstName,  lbl:'Given Name'},
        {id:'name--legalName--middleName',   v:middleName, lbl:'Middle Name'},
        {id:'name--legalName--lastName',     v:lastName,   lbl:'Family Name'},
        {id:'name--legalName--firstNameLocal', v:firstName, lbl:'Local Given Name'},
        {id:'name--legalName--lastNameLocal',  v:lastName,  lbl:'Local Family Name'},
        {id:'address--addressLine1',  v:address,    lbl:'Address'},
        {id:'address--city',          v:city,       lbl:'City'},
        {id:'address--postalCode',    v:postalCode, lbl:'Postal Code'},
        {id:'phoneNumber--phoneNumber', v:phone,    lbl:'Phone'},
        {id:'phoneNumber--extension',   v:extension, lbl:'Extension'}
    ];
    for (var ti = 0; ti < textFields.length; ti++) {
        var tf = textFields[ti];
        if (!tf.v) continue;
        var el = document.getElementById(tf.id);
        if (el && window.isFieldFillable(el) && !wdState.filledElements.has(el)) {
            if (window.fillField(el, tf.v)) { wdState.filledElements.add(el); filled++; console.log('[WD] filled:', tf.lbl); }
        }
        await window.delay(80);
    }
    return { filled: filled, phoneCountryName: phoneCountryName, country: country, hasWorked: hasWorked };
}

// -- Phone Country Code ----------------------------------------
async function wdFillPhoneCountryCode(desiredCountry) {
    var ccInput = document.getElementById('phoneNumber--countryPhoneCode');
    if (!ccInput || wdState.filledElements.has(ccInput)) return 0;
    if (!desiredCountry) return 0;
    var nsDesc = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value');
    var ns = nsDesc && nsDesc.set;
    // STEP 1: Clear and focus
    ccInput.click(); ccInput.focus(); await window.delay(150);
    try { if (ns) ns.call(ccInput, ''); else ccInput.value = ''; } catch(e) { ccInput.value = ''; }
    ccInput.dispatchEvent(new InputEvent('input', {bubbles:true}));
    await window.delay(100);
    // STEP 2: Type country name char-by-char
    var cur = '';
    for (var i = 0; i < desiredCountry.length; i++) {
        var ch = desiredCountry[i], kc = ch.charCodeAt(0);
        cur += ch;
        ccInput.dispatchEvent(new KeyboardEvent('keydown',  {key:ch, keyCode:kc, which:kc, bubbles:true, cancelable:true}));
        ccInput.dispatchEvent(new KeyboardEvent('keypress', {key:ch, keyCode:kc, which:kc, charCode:kc, bubbles:true, cancelable:true}));
        try { if (ns) ns.call(ccInput, cur); else ccInput.value = cur; } catch(e) { ccInput.value = cur; }
        ccInput.dispatchEvent(new InputEvent('input', {bubbles:true, inputType:'insertText', data:ch}));
        ccInput.dispatchEvent(new KeyboardEvent('keyup', {key:ch, keyCode:kc, which:kc, bubbles:true, cancelable:true}));
        await window.delay(40);
    }
    await window.delay(200);
    // STEP 3: Press Enter to show dropdown
    ccInput.dispatchEvent(new KeyboardEvent('keydown',  {key:'Enter', keyCode:13, which:13, bubbles:true, cancelable:true}));
    ccInput.dispatchEvent(new KeyboardEvent('keypress', {key:'Enter', keyCode:13, which:13, charCode:13, bubbles:true, cancelable:true}));
    ccInput.dispatchEvent(new KeyboardEvent('keyup',    {key:'Enter', keyCode:13, which:13, bubbles:true, cancelable:true}));
    await window.delay(1000);
    // STEP 4: Find and TICK the radio button for matching option
    // Dropdown shows: radio + "India (+91)", radio + "British Indian Ocean Territory (+246)"
    var lc = desiredCountry.toLowerCase();
    for (var attempt = 0; attempt < 20; attempt++) {
        await window.delay(300);
        var radios = Array.from(document.querySelectorAll('input[type="radio"]')).filter(function(r) {
            var rect = r.getBoundingClientRect(); return rect.width > 0 && rect.height > 0;
        });
        console.log('[WD] Phone CC attempt', attempt, '- radios visible:', radios.length);
        if (radios.length === 0) continue;
        // Find radio whose option text starts with country name
        var radioTarget = null;
        for (var ri = 0; ri < radios.length; ri++) {
            var r = radios[ri];
            // Walk up to find option container text
            var node = r.parentElement;
            var optionText = '';
            for (var depth = 0; depth < 5 && node; depth++) {
                var txt = node.textContent.trim().toLowerCase();
                if (txt.length > 0 && txt !== lc) {
                    optionText = txt; break;
                }
                node = node.parentElement;
            }
            console.log('[WD]   radio', ri, 'optionText:', optionText);
            if (optionText.startsWith(lc)) { radioTarget = r; break; }
        }
        if (!radioTarget) {
            // Fallback: first radio that contains country name at start
            for (var ri2 = 0; ri2 < radios.length; ri2++) {
                var node2 = radios[ri2].parentElement;
                var txt2 = '';
                for (var d2 = 0; d2 < 5 && node2; d2++) {
                    if (node2.textContent.trim().length > 2) { txt2 = node2.textContent.trim().toLowerCase(); break; }
                    node2 = node2.parentElement;
                }
                if (txt2.indexOf(lc) === 0) { radioTarget = radios[ri2]; break; }
            }
        }
        if (radioTarget) {
            // Tick the radio button with multiple events to ensure React registers
            radioTarget.focus();
            await window.delay(100);
            radioTarget.click();
            radioTarget.dispatchEvent(new MouseEvent('mousedown', {bubbles:true, cancelable:true}));
            radioTarget.dispatchEvent(new MouseEvent('mouseup',   {bubbles:true, cancelable:true}));
            radioTarget.dispatchEvent(new MouseEvent('click',     {bubbles:true, cancelable:true}));
            radioTarget.dispatchEvent(new Event('change', {bubbles:true}));
            await window.delay(300);
            // Also click the parent option container
            var optContainer = radioTarget.closest('[role="option"]') || radioTarget.parentElement;
            if (optContainer) { optContainer.click(); }
            await window.delay(300);
            wdState.filledElements.add(ccInput);
            var displayNode = radioTarget.parentElement;
            for (var dn = 0; dn < 4 && displayNode; dn++) {
                if (displayNode.textContent.trim().length > 3) { break; }
                displayNode = displayNode.parentElement;
            }
            console.log('[WD] Phone country ticked:', displayNode ? displayNode.textContent.trim() : desiredCountry);
            document.body.click();
            await window.delay(400);
            return 1;
        }
        // Also try [role="option"] click directly
        var opts2 = Array.from(document.querySelectorAll('[role="option"]')).filter(function(o) {
            var r = o.getBoundingClientRect(); return r.width > 0 && r.height > 0;
        });
        var optTarget = opts2.find(function(o) { return o.textContent.trim().toLowerCase().startsWith(lc); });
        if (optTarget) {
            optTarget.click();
            optTarget.dispatchEvent(new MouseEvent('click', {bubbles:true, cancelable:true}));
            wdState.filledElements.add(ccInput);
            console.log('[WD] Phone country selected (opt):', optTarget.textContent.trim());
            await window.delay(400);
            document.body.click();
            return 1;
        }
    }
    console.log('[WD] Phone country not found:', desiredCountry);
    document.body.click(); return 0;
}

// -- Country/Territory dropdown --------------------------------
async function wdFillCountryDropdown(country) {
    var inp = document.querySelector('#country--country');
    if (!inp || wdState.filledElements.has(inp)) return 0;

    // Same flow as skills: type ' Enter ' poll dropdown ' click option
    var nsDesc = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value');
    var ns = nsDesc && nsDesc.set;

    // STEP 1: Clear and focus
    inp.click(); inp.focus(); await window.delay(200);
    try { if (ns) ns.call(inp, ''); else inp.value = ''; } catch(e) { inp.value = ''; }
    inp.dispatchEvent(new InputEvent('input', {bubbles:true}));
    await window.delay(100);

    // STEP 2: Type char-by-char
    var cur = '';
    for (var i = 0; i < country.length; i++) {
        var ch = country[i], kc = ch.charCodeAt(0);
        cur += ch;
        inp.dispatchEvent(new KeyboardEvent('keydown',  {key:ch, keyCode:kc, which:kc, bubbles:true, cancelable:true}));
        inp.dispatchEvent(new KeyboardEvent('keypress', {key:ch, keyCode:kc, which:kc, charCode:kc, bubbles:true, cancelable:true}));
        try { if (ns) ns.call(inp, cur); else inp.value = cur; } catch(e) { inp.value = cur; }
        inp.dispatchEvent(new InputEvent('input', {bubbles:true, inputType:'insertText', data:ch}));
        inp.dispatchEvent(new KeyboardEvent('keyup',    {key:ch, keyCode:kc, which:kc, bubbles:true, cancelable:true}));
        await window.delay(40);
    }
    await window.delay(200);

    // STEP 3: Press Enter to show dropdown
    inp.dispatchEvent(new KeyboardEvent('keydown',  {key:'Enter', keyCode:13, which:13, bubbles:true, cancelable:true}));
    inp.dispatchEvent(new KeyboardEvent('keypress', {key:'Enter', keyCode:13, which:13, charCode:13, bubbles:true, cancelable:true}));
    inp.dispatchEvent(new KeyboardEvent('keyup',    {key:'Enter', keyCode:13, which:13, bubbles:true, cancelable:true}));
    await window.delay(600);

    // STEP 4: Poll for options and click match
    var lc = country.toLowerCase();
    for (var attempt = 0; attempt < 15; attempt++) {
        await window.delay(200);
        var opts = Array.from(document.querySelectorAll('[role="option"],[class*="select__option"]')).filter(function(o) {
            var r = o.getBoundingClientRect(); return r.width > 0 && r.height > 0 && o.textContent.trim() !== '';
        });
        if (opts.length === 0) continue;
        var target = opts.find(function(o) { return o.textContent.trim().toLowerCase() === lc; })
                  || opts.find(function(o) { return o.textContent.trim().toLowerCase().startsWith(lc); })
                  || opts.find(function(o) { return o.textContent.trim().toLowerCase().includes(lc); });
        if (target) {
            target.click();
            wdState.filledElements.add(inp);
            console.log('[WD] Country set:', target.textContent.trim());
            await window.delay(200);
            document.body.click();
            return 1;
        }
    }
    console.log('[WD] Country not found:', country);
    document.body.click();
    return 0;
}

// -- Helper: fill a search/list input (type ? poll ? click option) -
async function wdFillSearchField(labelText, value) {
    if (!value) return false;
    // Find input whose label contains labelText
    var inputs = Array.from(document.querySelectorAll('input, textarea'));
    var inp = null;
    for (var i = 0; i < inputs.length; i++) {
        var el = inputs[i];
        var rect = el.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0 || el.disabled || el.readOnly) continue;
        var lbl = '';
        if (el.id) { var lE = document.querySelector('label[for="'+el.id+'"]'); if(lE) lbl = lE.textContent.trim(); }
        if (!lbl && el.getAttribute('aria-label')) lbl = el.getAttribute('aria-label');
        if (!lbl && el.placeholder) lbl = el.placeholder;
        if (lbl.toLowerCase().includes(labelText.toLowerCase())) { inp = el; break; }
    }
    if (!inp) return false;

    inp.focus(); await window.delay(200);
    await wdTypeInto(inp, value);
    await window.delay(300);

    // Press Enter to trigger search
    inp.dispatchEvent(new KeyboardEvent('keydown', {key:'Enter', keyCode:13, bubbles:true}));
    inp.dispatchEvent(new KeyboardEvent('keyup',   {key:'Enter', keyCode:13, bubbles:true}));

    // Poll for options
    var opts = [];
    for (var p = 0; p < 10; p++) {
        await window.delay(350);
        var lb = document.querySelector('[role="listbox"]');
        if (lb) {
            opts = Array.from(lb.querySelectorAll('[role="option"]')).filter(function(o) {
                var r = o.getBoundingClientRect();
                return r.width>0 && r.height>0 && o.textContent.trim() !== 'No Items.';
            });
            if (opts.length > 0) break;
        }
    }

    if (opts.length === 0) {
        // No search results - just leave the typed value as-is
        inp.dispatchEvent(new Event('blur', {bubbles:true}));
        console.log('[WD] Search field "' + labelText + '" - no dropdown results, leaving typed value');
        return true;
    }

    var lc = value.toLowerCase();
    var match = opts.find(function(o){ return o.textContent.trim().toLowerCase() === lc; })
             || opts.find(function(o){ return o.textContent.trim().toLowerCase().startsWith(lc); })
             || opts.find(function(o){ return o.textContent.trim().toLowerCase().includes(lc); })
             || opts[0];
    match.click();
    await window.delay(400);
    console.log('[WD] Search field "' + labelText + '" ? selected:', match.textContent.trim());
    return true;
}

// -- Helper: fill a native <select> by label -------------------
async function wdFillNativeSelect(labelText, value) {
    if (!value) return false;
    var selects = Array.from(document.querySelectorAll('select'));
    for (var i = 0; i < selects.length; i++) {
        var sel = selects[i];
        var rect = sel.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) continue;
        var lbl = '';
        if (sel.id) { var lE = document.querySelector('label[for="'+sel.id+'"]'); if(lE) lbl = lE.textContent.trim(); }
        if (!lbl && sel.getAttribute('aria-label')) lbl = sel.getAttribute('aria-label');
        if (!lbl.toLowerCase().includes(labelText.toLowerCase())) continue;

        var lc = value.toLowerCase();
        // Try exact match on option text, then partial
        for (var j = 0; j < sel.options.length; j++) {
            if (sel.options[j].text.toLowerCase() === lc) {
                sel.selectedIndex = j; sel.dispatchEvent(new Event('change',{bubbles:true}));
                console.log('[WD] Native select "' + labelText + '" ? ' + sel.options[j].text);
                return true;
            }
        }
        for (var k = 0; k < sel.options.length; k++) {
            if (sel.options[k].text.toLowerCase().includes(lc)) {
                sel.selectedIndex = k; sel.dispatchEvent(new Event('change',{bubbles:true}));
                console.log('[WD] Native select "' + labelText + '" ? ' + sel.options[k].text);
                return true;
            }
        }
    }
    return false;
}

// --------------------------------------------------------------
// SECTION 2: MY EXPERIENCE
// --------------------------------------------------------------
async function wdFillMyExperience(p) {
    console.log('[WD] Section 2: My Experience START');
    var filled = 0;
    var linkedin   = (p.social && p.social.linkedin) || p.linkedin || '';
    var education  = p.education  || [];
    var experience = p.experience || [];
    var skills     = p.skills     || [];

    // LinkedIn - id confirmed from console audit
    var liEl = document.getElementById('socialNetworkAccounts--linkedInAccount');
    if (liEl && window.isFieldFillable(liEl) && !wdState.filledElements.has(liEl) && linkedin) {
        if (!linkedin.startsWith('http')) linkedin = 'https://www.linkedin.com/in/' + linkedin;
        await wdTypeInto(liEl, linkedin);
        wdState.filledElements.add(liEl); filled++;
        console.log('[WD] LinkedIn filled');
    }
    await window.delay(200);

    // Skills LAST - after education (degree dropdown can leave stale listbox)
    // Move skills fill to AFTER education so degree dropdown is fully closed

    // -- Work Experience entries ----------------------------------
    // Confirmed field IDs: workExperience-{N}--jobTitle, --companyName, --location,
    // --currentlyWorkHere, --startDate-dateSectionMonth-input, --startDate-dateSectionYear-input,
    // --endDate-dateSectionMonth-input, --endDate-dateSectionYear-input, --roleDescription
    // Date format: SEPARATE month and year inputs (not MM/YYYY combined)
    for (var ei = 0; ei < experience.length; ei++) {
        var exp = experience[ei];
        var company = exp.company || '';
        var title   = exp.title || exp.job_title || '';
        var loc     = exp.location || '';
        var startRaw = String(exp.from || exp.start_year || '');
        var endRaw   = String(exp.to  || exp.end_year   || '');
        var desc    = exp.description || '';
        var isCurrent = (endRaw.toLowerCase() === 'present' || !endRaw);

        // Parse month and year from values like "2025", "01/2025", "2025-01"
        var startMonth = '01', startYear = startRaw.replace(/\D/g,'').slice(0,4);
        var endMonth   = '12', endYear   = endRaw.replace(/\D/g,'').slice(0,4);
        if (startRaw.includes('/')) { var sp=startRaw.split('/'); startMonth=sp[0]; startYear=sp[1]||sp[0]; }
        if (endRaw.includes('/'))   { var ep=endRaw.split('/');   endMonth=ep[0];   endYear=ep[1]||ep[0]; }

        console.log('[WD] Work Experience', ei+1, ':', company, '/', title);

        // Click Add / Add Another button
        var addExpBtn = Array.from(document.querySelectorAll('[data-automation-id="add-button"]')).find(function(b){
            // Must be inside the Work Experience section - check ancestor text
            var node = b.parentElement; var d2 = 0;
            while (node && d2 < 10) {
                if (/work experience/i.test(node.getAttribute('data-automation-id')||'')) return true;
                node = node.parentElement; d2++;
            }
            // Fallback: first or second add-button (Work Exp=0 initially, then Add Another)
            return false;
        }) || document.querySelector('[data-automation-id="add-button"]');

        if (!addExpBtn) { console.log('[WD] No Add button for Work Experience'); break; }
        addExpBtn.click();
        await window.delay(1500);

        // Find the LAST work experience entry (highest N in workExperience-{N}--)
        var allJobTitles = Array.from(document.querySelectorAll('input[id*="--jobTitle"]')).filter(function(el){
            var r=el.getBoundingClientRect(); return r.width>0&&r.height>0 && el.value==='';
        });
        if (allJobTitles.length === 0) { console.log('[WD] No empty Job Title found'); continue; }
        // Get the last empty entry's ID prefix
        var lastTitle = allJobTitles[allJobTitles.length - 1];
        var idBase = lastTitle.id.replace('--jobTitle',''); // e.g. "workExperience-58"

        // Fill all fields using exact IDs - use native setter directly (confirmed working from audit)
        function wdSetVal(id, value) {
            var el = document.getElementById(id);
            if (!el) return false;
            var r = el.getBoundingClientRect();
            if (r.width === 0 || r.height === 0) return false;
            var ns = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')
                  || Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value');
            var setter = ns && ns.set;
            try { if (setter) setter.call(el, value); else el.value = value; } catch(e) { el.value = value; }
            el.dispatchEvent(new Event('input',  {bubbles:true}));
            el.dispatchEvent(new Event('change', {bubbles:true}));
            return true;
        }

        wdSetVal(idBase + '--jobTitle',    title);   await window.delay(200);
        wdSetVal(idBase + '--companyName', company); await window.delay(200);
        if (loc) { wdSetVal(idBase + '--location', loc); await window.delay(200); }

        // "I currently work here" checkbox
        var cbEl = document.getElementById(idBase + '--currentlyWorkHere');
        if (cbEl) {
            if (isCurrent && !cbEl.checked) {
                cbEl.click(); await window.delay(300);
                console.log('[WD] Checked "I currently work here"');
            } else if (!isCurrent && cbEl.checked) {
                cbEl.click(); await window.delay(300);
            }
        }

        // Start date - confirmed working: native setter + input/change events
        // Month and Year are SEPARATE inputs (confirmed from audit)
        var startMonthEl = document.getElementById(idBase + '--startDate-dateSectionMonth-input');
        var startYearEl  = document.getElementById(idBase + '--startDate-dateSectionYear-input');
        if (startMonthEl && startYear) {
            var nsSM = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
            startMonthEl.focus(); startMonthEl.click();
            try { nsSM.call(startMonthEl, startMonth); } catch(e) { startMonthEl.value = startMonth; }
            startMonthEl.dispatchEvent(new Event('input',  {bubbles:true}));
            startMonthEl.dispatchEvent(new Event('change', {bubbles:true}));
            await window.delay(150);
        }
        if (startYearEl && startYear) {
            var nsSY = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
            startYearEl.focus(); startYearEl.click();
            try { nsSY.call(startYearEl, startYear); } catch(e) { startYearEl.value = startYear; }
            startYearEl.dispatchEvent(new Event('input',  {bubbles:true}));
            startYearEl.dispatchEvent(new Event('change', {bubbles:true}));
            await window.delay(300);
            console.log('[WD] Start date filled:', startMonth + '/' + startYear);
        }

        // End date (only if not current)
        if (!isCurrent && endYear) {
            var endMonthEl = document.getElementById(idBase + '--endDate-dateSectionMonth-input');
            var endYearEl  = document.getElementById(idBase + '--endDate-dateSectionYear-input');
            if (endMonthEl) {
                var nsEM = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
                endMonthEl.focus(); endMonthEl.click();
                try { nsEM.call(endMonthEl, endMonth); } catch(e) { endMonthEl.value = endMonth; }
                endMonthEl.dispatchEvent(new Event('input',  {bubbles:true}));
                endMonthEl.dispatchEvent(new Event('change', {bubbles:true}));
                await window.delay(150);
            }
            if (endYearEl) {
                var nsEY = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
                endYearEl.focus(); endYearEl.click();
                try { nsEY.call(endYearEl, endYear); } catch(e) { endYearEl.value = endYear; }
                endYearEl.dispatchEvent(new Event('input',  {bubbles:true}));
                endYearEl.dispatchEvent(new Event('change', {bubbles:true}));
                await window.delay(300);
                console.log('[WD] End date filled:', endMonth + '/' + endYear);
            }
        }

        // Role Description - textarea needs HTMLTextAreaElement native setter
        if (desc) {
            var descEl = document.getElementById(idBase + '--roleDescription');
            if (descEl) {
                var nsTa = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value');
                var setterTa = nsTa && nsTa.set;
                try { if (setterTa) setterTa.call(descEl, desc); else descEl.value = desc; } catch(e) { descEl.value = desc; }
                descEl.dispatchEvent(new Event('input',  {bubbles:true}));
                descEl.dispatchEvent(new Event('change', {bubbles:true}));
                await window.delay(200);
                console.log('[WD] Role Description filled');
            }
        }

        filled++;
        console.log('[WD] Work Exp filled: ' + idBase);
        await window.delay(400);
    }

    // -- Education entries ----------------------------------------
    // CONFIRMED from audit:
    //   education-{N}--school      ? input[type=text] with = icon overlay (fill by ID, skip rect check)
    //   education-{N}--degree      ? button "Select One" (click to open dropdown, pick option)
    //   education-{N}--fieldOfStudy ? input[type=text] with = icon overlay (fill by ID, skip rect check)
    //   NO date fields on this Workday instance
    //   Add button index: 1 (0=WorkExp Add, 1=Education Add, 2=Certifications Add, 3=Websites AddAnother)

    // Close any open listbox before starting education
    document.body.click(); await window.delay(400);

    for (var edi = 0; edi < education.length; edi++) {
        var edu    = education[edi];
        var schoolRaw = edu.institution || edu.school || '';
        var degree = edu.degree || '';
        var field  = edu.field_of_study || edu.field || '';

        // Extract ONLY the institution name (remove city, state, country)
        // Examples:
        //   "Kalasalingam University, Virudhunagar, Tamil Nadu" ? "Kalasalingam University"
        //   "IIT Bombay, Mumbai, Maharashtra, India" ? "IIT Bombay"
        //   "Stanford University" ? "Stanford University"
        var school = schoolRaw;
        if (schoolRaw.includes(',')) {
            // Take only the part before the first comma
            school = schoolRaw.split(',')[0].trim();
        }

        console.log('[WD] Education', edi+1, ':', school, '(raw:', schoolRaw + ')');

        // Get all add-buttons and find Education one (index depends on state)
        // After Work Exp Add, the order is: Work Exp "Add Another"(0), Education "Add"(1), Certifications "Add"(2), Websites "Add Another"(3)
        var allAddBtns2 = Array.from(document.querySelectorAll('[data-automation-id="add-button"]'));

        // Find the Education Add button: look for "Add" (not "Add Another") that's
        // between Work Experience and Certifications sections on the page
        var eduAddBtn = null;
        var h4List = Array.from(document.querySelectorAll('h4'));
        var eduH4 = h4List.find(function(h){ return /^education$/i.test(h.textContent.trim()); });
        var certH4 = h4List.find(function(h){ return /^certif/i.test(h.textContent.trim()); });

        if (eduH4) {
            // Walk forward from education h4 to find next Add button
            var walker = eduH4.nextElementSibling || eduH4.parentElement;
            var depth3 = 0;
            while (walker && depth3 < 20) {
                if (walker.tagName === 'BUTTON' &&
                    walker.getAttribute('data-automation-id') === 'add-button' &&
                    (walker.textContent.trim() === 'Add' || walker.textContent.trim() === 'Add Another')) {
                    eduAddBtn = walker; break;
                }
                var b2 = walker.querySelector && walker.querySelector('[data-automation-id="add-button"]');
                if (b2 && (b2.textContent.trim() === 'Add' || b2.textContent.trim() === 'Add Another')) {
                    // Make sure it's before Certifications
                    if (certH4) {
                        var bRect = b2.getBoundingClientRect();
                        var cRect = certH4.getBoundingClientRect();
                        if (bRect.top < cRect.top) { eduAddBtn = b2; break; }
                    } else {
                        eduAddBtn = b2; break;
                    }
                }
                walker = walker.nextElementSibling; depth3++;
            }
        }

        // Final fallback: second add-button from top
        if (!eduAddBtn && allAddBtns2.length > 1) eduAddBtn = allAddBtns2[1];
        if (!eduAddBtn) { console.log('[WD] Education Add button not found'); break; }

        eduAddBtn.click();
        await window.delay(1500);

        // Find the LAST education entry by looking for empty education--school inputs
        // School input has = overlay - must query by ID pattern, not by rect visibility
        var allSchoolEls = Array.from(document.querySelectorAll('input[id*="education"][id*="--school"]'));
        if (allSchoolEls.length === 0) {
            console.log('[WD] No education--school inputs found');
            continue;
        }

        // Last one is the newest entry
        var schoolEl = allSchoolEls[allSchoolEls.length - 1];
        var eduN = schoolEl.id.replace(/--school$/,''); // e.g. "education-180"
        console.log('[WD] Education ID base:', eduN);

        // Fill School - direct native setter (skip rect check, input is covered by icon)
        var nsEdu = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;

        // School: SEARCHABLE DROPDOWN - type ? Enter ? select from dropdown ? body.click
        if (school) {
            schoolEl.focus(); await window.delay(150);
            nsEdu.call(schoolEl, '');
            schoolEl.dispatchEvent(new InputEvent('input', {bubbles:true}));
            await window.delay(100);

            // Type char-by-char
            for (var sci = 0; sci < school.length; sci++) {
                var sch = school[sci], ksc = sch.charCodeAt(0);
                var scur = school.substring(0, sci + 1);
                schoolEl.dispatchEvent(new KeyboardEvent('keydown',  {key:sch, keyCode:ksc, which:ksc, bubbles:true, cancelable:true}));
                schoolEl.dispatchEvent(new KeyboardEvent('keypress', {key:sch, keyCode:ksc, which:ksc, charCode:ksc, bubbles:true, cancelable:true}));
                nsEdu.call(schoolEl, scur);
                schoolEl.dispatchEvent(new InputEvent('input', {bubbles:true, inputType:'insertText', data:sch}));
                schoolEl.dispatchEvent(new KeyboardEvent('keyup',   {key:sch, keyCode:ksc, which:ksc, bubbles:true, cancelable:true}));
                await window.delay(50);
            }
            await window.delay(250);

            // Press Enter to show dropdown
            schoolEl.dispatchEvent(new KeyboardEvent('keydown',  {key:'Enter', keyCode:13, which:13, bubbles:true, cancelable:true}));
            schoolEl.dispatchEvent(new KeyboardEvent('keypress', {key:'Enter', keyCode:13, which:13, charCode:13, bubbles:true, cancelable:true}));
            schoolEl.dispatchEvent(new KeyboardEvent('keyup',    {key:'Enter', keyCode:13, which:13, bubbles:true, cancelable:true}));
            await window.delay(600);

            // Find and click matching option
            var schoolOptionClicked = false;
            for (var schAttempt = 0; schAttempt < 15; schAttempt++) {
                await window.delay(200);
                var schoolOpts = Array.from(document.querySelectorAll('[role="option"]')).filter(function(opt) {
                    var r = opt.getBoundingClientRect();
                    return r.width > 0 && r.height > 0 && opt.textContent.trim() !== '' && opt.textContent.trim() !== 'No Items.';
                });
                if (schoolOpts.length === 0) continue;
                var lsc = school.toLowerCase();
                var matchedOpt = schoolOpts.find(function(o){ return o.textContent.trim().toLowerCase() === lsc; })
                              || schoolOpts.find(function(o){ return o.textContent.trim().toLowerCase().startsWith(lsc); })
                              || schoolOpts.find(function(o){ return o.textContent.trim().toLowerCase().includes(lsc); })
                              || schoolOpts[0];
                if (matchedOpt) {
                    console.log('[WD]   ? Clicking school option:', matchedOpt.textContent.trim());
                    matchedOpt.click();
                    schoolOptionClicked = true;
                    await window.delay(400);
                    break;
                }
            }
            if (!schoolOptionClicked) {
                console.log('[WD]   ? School dropdown not found, leaving typed value');
                schoolEl.dispatchEvent(new KeyboardEvent('keydown', {key:'Escape', keyCode:27, bubbles:true}));
                await window.delay(300);
            } else {
                document.body.click();
                await window.delay(400);
                console.log('[WD] ? School selected:', school);
            }
        }

        // Degree - confirmed as a BUTTON (id="education-{N}--degree", text="Select One")
        // Click to open dropdown, then pick matching option
        var degreeBtn = document.getElementById(eduN + '--degree');
        if (degreeBtn && degree) {
            degreeBtn.click();
            await window.delay(800);

            // Degree options are <li role="option"> inside a dropdown UL
            // Filter ONLY options that have data-value attribute (confirmed from audit)
            // Exclude progress bar li items (they don't have data-value)
            var degreeOpts = Array.from(document.querySelectorAll('li[role="option"][data-value]')).filter(function(o){
                var r = o.getBoundingClientRect();
                return r.width > 0 && r.height > 0 && o.textContent.trim() !== 'Select One';
            });

            console.log('[WD] Degree options:', degreeOpts.length, degreeOpts.slice(0,3).map(function(o){return o.textContent.trim();}));

            if (degreeOpts.length > 0) {
                var degreeLc = degree.toLowerCase();
                // Exact degree mapping based on confirmed Workday options:
                // Bachelor of Engineering, Bachelor of Arts, Bachelor of Science, etc.
                // Master of Arts, Master of Science, Master of Business Administration
                // High School, GED, Post Graduate Diploma, Doctor of Philosophy
                var degMatch = null;

                // Try exact text match first
                degMatch = degreeOpts.find(function(o){ return o.textContent.trim().toLowerCase() === degreeLc; });

                if (!degMatch) {
                    // Smart mapping
                    if (/b\.?tech|b\.?e\b|bachelor.*engineer/i.test(degree)) {
                        degMatch = degreeOpts.find(function(o){ return /bachelor.*engineer/i.test(o.textContent); });
                    } else if (/b\.?sc|bachelor.*science/i.test(degree)) {
                        degMatch = degreeOpts.find(function(o){ return /bachelor.*science/i.test(o.textContent); });
                    } else if (/b\.?com|bachelor.*commerce/i.test(degree)) {
                        degMatch = degreeOpts.find(function(o){ return /bachelor.*commerce/i.test(o.textContent); });
                    } else if (/b\.?a\b|bachelor.*art/i.test(degree)) {
                        degMatch = degreeOpts.find(function(o){ return /bachelor.*art/i.test(o.textContent); });
                    } else if (/b\.?b\.?m|bachelor.*business/i.test(degree)) {
                        degMatch = degreeOpts.find(function(o){ return /bachelor.*business/i.test(o.textContent); });
                    } else if (/m\.?tech|m\.?e\b|master.*engineer/i.test(degree)) {
                        degMatch = degreeOpts.find(function(o){ return /master.*science/i.test(o.textContent); });
                    } else if (/m\.?sc|master.*science/i.test(degree)) {
                        degMatch = degreeOpts.find(function(o){ return /master.*science/i.test(o.textContent); });
                    } else if (/mba|master.*business/i.test(degree)) {
                        degMatch = degreeOpts.find(function(o){ return /master.*business/i.test(o.textContent); });
                    } else if (/m\.?a\b|master.*art/i.test(degree)) {
                        degMatch = degreeOpts.find(function(o){ return /master.*art/i.test(o.textContent); });
                    } else if (/phd|ph\.d|doctor.*phil/i.test(degree)) {
                        degMatch = degreeOpts.find(function(o){ return /doctor.*phil/i.test(o.textContent); });
                    } else if (/post.?grad|pg.?dip/i.test(degree)) {
                        degMatch = degreeOpts.find(function(o){ return /post.*grad/i.test(o.textContent); });
                    } else if (/inter|12th|hsc|plus.?two|higher.?secondary/i.test(degree)) {
                        degMatch = degreeOpts.find(function(o){ return /high.?school/i.test(o.textContent); });
                    } else if (/10th|ssc|secondary|matricul/i.test(degree)) {
                        degMatch = degreeOpts.find(function(o){ return /high.?school/i.test(o.textContent); });
                    } else if (/associate/i.test(degree)) {
                        degMatch = degreeOpts.find(function(o){ return /associate/i.test(o.textContent); });
                    } else if (/bachelor/i.test(degree)) {
                        degMatch = degreeOpts.find(function(o){ return /bachelor/i.test(o.textContent); });
                    } else if (/master/i.test(degree)) {
                        degMatch = degreeOpts.find(function(o){ return /master/i.test(o.textContent); });
                    }
                }

                if (!degMatch) {
                    // Partial match fallback
                    var firstWord = degreeLc.split(/\s+/)[0];
                    degMatch = degreeOpts.find(function(o){ return o.textContent.trim().toLowerCase().includes(firstWord) && o.textContent.trim() !== 'Select One'; });
                }

                if (degMatch) {
                    degMatch.click();
                    await window.delay(400);
                    console.log('[WD] Degree selected:', degMatch.textContent.trim());
                } else {
                    document.body.click(); await window.delay(300);
                    console.log('[WD] Degree not matched for:', degree);
                }
            } else {
                document.body.click(); await window.delay(300);
            }
        }
        await window.delay(300);

        // Field of Study - same as School, has = overlay, fill by ID
        var fieldEl = document.getElementById(eduN + '--fieldOfStudy');
        if (fieldEl && field) {
            fieldEl.focus(); await window.delay(100);
            try { nsEdu.call(fieldEl, field); } catch(e) { fieldEl.value = field; }
            fieldEl.dispatchEvent(new Event('input',  {bubbles:true}));
            fieldEl.dispatchEvent(new Event('change', {bubbles:true}));
            fieldEl.dispatchEvent(new Event('blur',   {bubbles:true}));
            await window.delay(300);
            console.log('[WD] Field of Study filled:', field);
        }

        filled++;
        console.log('[WD] Education', edi+1, 'filled');
        await window.delay(500);
    }

    // -- Skills - MANUAL FLOW SIMULATION ----------------------------------------
    // Exact manual steps:
    // 1. Type skill name (char-by-char)
    // 2. Press Enter ? dropdown appears
    // 3. Click checkbox next to matching skill
    // 4. Click outside (body.click) ? dropdown closes, pill appears
    // 5. Repeat for next skill
    
    document.body.click(); await window.delay(600);
    var skillsEl = document.getElementById('skills--skills');
    if (skillsEl && window.isFieldFillable(skillsEl)) {
        var skillList = Array.isArray(skills) ? skills : [skills];
        var skillsAdded = 0;

        for (var si = 0; si < skillList.length; si++) {
            var skill = (skillList[si] || '').trim();
            if (!skill) continue;

            console.log('[WD] Skill', (si+1) + '/' + skillList.length + ':', skill);

            // STEP 1: Clear and type skill name
            skillsEl.focus();
            var nsClear = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
            nsClear.call(skillsEl, '');
            skillsEl.dispatchEvent(new InputEvent('input', {bubbles:true}));
            await window.delay(150);

            // Type char-by-char with full keyboard events
            for (var ci = 0; ci < skill.length; ci++) {
                var ch = skill[ci], kc = ch.charCodeAt(0);
                var cur = skill.substring(0, ci + 1);
                skillsEl.dispatchEvent(new KeyboardEvent('keydown',  {key:ch, keyCode:kc, which:kc, bubbles:true, cancelable:true}));
                skillsEl.dispatchEvent(new KeyboardEvent('keypress', {key:ch, keyCode:kc, which:kc, charCode:kc, bubbles:true, cancelable:true}));
                nsClear.call(skillsEl, cur);
                skillsEl.dispatchEvent(new InputEvent('input', {bubbles:true, inputType:'insertText', data:ch}));
                skillsEl.dispatchEvent(new KeyboardEvent('keyup',   {key:ch, keyCode:kc, which:kc, bubbles:true, cancelable:true}));
                await window.delay(50);
            }
            await window.delay(250);

            // STEP 2: Press Enter to show dropdown
            skillsEl.dispatchEvent(new KeyboardEvent('keydown',  {key:'Enter', keyCode:13, which:13, bubbles:true, cancelable:true}));
            skillsEl.dispatchEvent(new KeyboardEvent('keypress', {key:'Enter', keyCode:13, which:13, charCode:13, bubbles:true, cancelable:true}));
            skillsEl.dispatchEvent(new KeyboardEvent('keyup',    {key:'Enter', keyCode:13, which:13, bubbles:true, cancelable:true}));
            await window.delay(600); // Wait for /skillsearch API and dropdown render

            // STEP 3: Find and click the checkbox
            var checkboxClicked = false;
            for (var attempt = 0; attempt < 15; attempt++) {
                await window.delay(200);

                // Get ALL visible checkboxes (excluding "currentlyWorkHere")
                var allCbs = Array.from(document.querySelectorAll('input[type="checkbox"]')).filter(function(cb) {
                    if (cb.id && cb.id.indexOf('currentlyWorkHere') !== -1) return false;
                    var r = cb.getBoundingClientRect();
                    return r.width > 0 && r.height > 0;
                });

                if (allCbs.length === 0) continue; // Dropdown not ready yet

                // Search for checkbox whose ancestor contains the skill name
                var lc = skill.toLowerCase();
                var matchedCb = null;

                for (var cbIdx = 0; cbIdx < allCbs.length; cbIdx++) {
                    var cb = allCbs[cbIdx];
                    // Walk up parent tree to find menuItem or listbox item
                    var walker = cb.parentElement;
                    for (var depth = 0; depth < 6 && walker; depth++) {
                        var walkerId = (walker.id || '').toLowerCase();
                        var walkerText = walker.textContent.trim().toLowerCase();
                        
                        // Match by id="menuItem-Python" or text content
                        if ((walkerId.indexOf('menuitem') !== -1 && walkerId.indexOf(lc.replace(/\s+/g, '')) !== -1) ||
                            (walkerText === lc || walkerText.startsWith(lc + ' ') || walkerText.startsWith(lc + '('))) {
                            matchedCb = cb;
                            break;
                        }
                        walker = walker.parentElement;
                    }
                    if (matchedCb) break;
                }

                // Fallback: first unchecked checkbox (usually the top result)
                if (!matchedCb && allCbs.length > 0) {
                    matchedCb = allCbs.find(function(cb) { return !cb.checked; });
                }

                if (matchedCb && !matchedCb.checked) {
                    console.log('[WD]   ? Clicking checkbox');
                    matchedCb.click();
                    checkboxClicked = true;
                    await window.delay(400);
                    break;
                }
            }

            if (!checkboxClicked) {
                console.log('[WD]   ? Checkbox not found, skipping');
                // Press Escape to close dropdown
                skillsEl.dispatchEvent(new KeyboardEvent('keydown', {key:'Escape', keyCode:27, bubbles:true}));
                await window.delay(300);
                continue; // Next skill
            }

            // STEP 4: Click outside to close dropdown (mimics manual click on empty space)
            document.body.click();
            await window.delay(600); // Wait for dropdown animation and pill render

            // STEP 5: Verify pill was added
            var pills = Array.from(document.querySelectorAll('li[data-automation-id="menuItem"][class*="css-"]')).filter(function(li) {
                var r = li.getBoundingClientRect();
                return r.width > 0 && r.height > 0 && li.textContent.trim().toLowerCase().includes(lc);
            });
            
            if (pills.length > 0) {
                skillsAdded++;
                console.log('[WD]   ? Added:', skill);
            } else {
                console.log('[WD]   ? Pill not visible, but may have been added');
                skillsAdded++; // Count it anyway since we clicked the checkbox
            }

            await window.delay(400); // Pause before next skill
        }

        filled += skillsAdded;
        console.log('[WD] Skills complete:', skillsAdded + '/' + skillList.length);
        if (skillsAdded > 0) window.showToast('Added ' + skillsAdded + ' skills', 'success');
    }
    await window.delay(300);

    console.log('[WD] Section 2 DONE, filled:', filled);
    return filled;
}

// --------------------------------------------------------------
// SECTION 3: APPLICATION QUESTIONS (AI answers)
// --------------------------------------------------------------
async function wdFillAppQuestions(p) {
    console.log('[WD] Section 3: Application Questions START');
    var filled = 0;

    var questionButtons = Array.from(document.querySelectorAll('button[aria-haspopup="listbox"]')).filter(function(b) {
        return b.textContent.trim() === 'Select One' && b.id.indexOf('primaryQuestionnaire') !== -1;
    });
    console.log('[WD] Found', questionButtons.length, 'Application Question dropdowns');
    if (questionButtons.length === 0) { return 0; }

    // Determine yes/no intent from question text
    function getIntent(question) {
        var q = question.toLowerCase();
        if (q.indexOf('authorized to work') !== -1 || q.indexOf('eligible to work') !== -1) { return 'yes'; }
        if (q.indexOf('non-compete') !== -1 || q.indexOf('non-solicitation') !== -1) { return 'no'; }
        if ((q.indexOf('visa') !== -1 || q.indexOf('sponsorship') !== -1 || q.indexOf('immigration') !== -1) && q.indexOf('require') !== -1) { return 'no'; }
        if (q.indexOf('united states government') !== -1 || q.indexOf('u.s. government') !== -1) { return 'no'; }
        if (q.indexOf('iran') !== -1 || q.indexOf('cuba') !== -1 || q.indexOf('north korea') !== -1) { return 'no'; }
        if (q.indexOf('related to') !== -1 && q.indexOf('workday employee') !== -1) { return 'no'; }
        if (q.indexOf('related to') !== -1 && (q.indexOf('customer') !== -1 || q.indexOf('government official') !== -1)) { return 'no'; }
        if (q.indexOf('ernst') !== -1 || q.indexOf('auditor') !== -1) { return 'no'; }
        if (q.indexOf('workday system') !== -1 || q.indexOf('work on the workday') !== -1) {
            var hasWD = false;
            if (p && p.skills) { hasWD = p.skills.some(function(s) { return /workday/i.test(s); }); }
            return hasWD ? 'yes' : 'no';
        }
        if (q.indexOf('relocat') !== -1) { return 'yes'; }
        if (q.indexOf('acknowledge') !== -1 || q.indexOf('certif') !== -1 || q.indexOf('agree') !== -1) { return 'yes'; }
        return null;
    }

    // ONE-STEP per question: open -> get question text -> get options -> pick -> click -> close
    for (var qi = 0; qi < questionButtons.length; qi++) {
        var btn = questionButtons[qi];

        // Get question text BEFORE opening dropdown
        var questionText = '';
        var lblId = btn.getAttribute('aria-labelledby');
        if (lblId) {
            var lblEl = document.getElementById(lblId);
            if (lblEl) questionText = lblEl.textContent.replace(/\*/g, '').trim();
        }
        if (!questionText) {
            var cur = btn.parentElement;
            for (var lvl = 0; lvl < 5 && cur; lvl++) {
                var prev = cur.previousElementSibling;
                if (prev && prev.textContent.indexOf('?') !== -1 && prev.textContent.length > 20) {
                    questionText = prev.textContent.replace(/\*/g, '').trim(); break;
                }
                var ch = Array.from(cur.children);
                for (var ci = 0; ci < ch.length; ci++) {
                    if (ch[ci].contains(btn)) continue;
                    var ctxt = ch[ci].textContent.replace(/\*/g, '').trim();
                    if (ctxt.indexOf('?') !== -1 && ctxt.length > 20 && ctxt.indexOf('Select One') === -1) {
                        questionText = ctxt; break;
                    }
                }
                if (questionText) break;
                cur = cur.parentElement;
            }
        }

        // Determine intent from question
        var intent = getIntent(questionText);
        console.log('[WD] Q' + (qi+1) + ': "' + questionText.substring(0, 70) + '" intent=' + intent);
        if (!intent) { console.log('[WD] Q' + (qi+1) + ': no intent determined, skipping'); continue; }

        // Open dropdown
        btn.click();
        await window.delay(600);

        // Get listbox
        var lb = document.querySelector('[role="listbox"]');
        if (!lb) { console.warn('[WD] Q' + (qi+1) + ': no listbox appeared'); continue; }

        // Get options NOW from the OPEN dropdown
        var opts = Array.from(lb.querySelectorAll('[role="option"]')).filter(function(o) {
            var r = o.getBoundingClientRect();
            return r.width > 0 && r.height > 0 && o.textContent.trim() !== 'Select One';
        });
        console.log('[WD] Q' + (qi+1) + ' options:', opts.map(function(o) { return o.textContent.trim(); }));

        // Pick the best matching option for the intent
        var picked = opts.find(function(o) { return o.textContent.trim().toLowerCase() === intent; })
                  || opts.find(function(o) { return o.textContent.trim().toLowerCase().startsWith(intent + ','); })
                  || opts.find(function(o) { return o.textContent.trim().toLowerCase().startsWith(intent + ' '); })
                  || opts.find(function(o) { return o.textContent.trim().toLowerCase().split(',')[0].trim() === intent; });

        if (picked) {
            console.log('[WD] Q' + (qi+1) + ' picking: "' + picked.textContent.trim() + '"');
            // Full mouse event sequence to ensure React registers the selection
            picked.dispatchEvent(new MouseEvent('mouseover', {bubbles:true, cancelable:true}));
            picked.dispatchEvent(new MouseEvent('mouseenter', {bubbles:true, cancelable:true}));
            picked.dispatchEvent(new MouseEvent('mousedown', {bubbles:true, cancelable:true}));
            picked.dispatchEvent(new MouseEvent('mouseup',   {bubbles:true, cancelable:true}));
            picked.click();
            picked.dispatchEvent(new MouseEvent('click',     {bubbles:true, cancelable:true}));
            filled++;
            await window.delay(500);
            console.log('[WD] Q' + (qi+1) + ' FILLED: "' + picked.textContent.trim() + '"');
        } else {
            console.warn('[WD] Q' + (qi+1) + ': no option matches intent="' + intent + '" in', opts.map(function(o){return o.textContent.trim();}));
            document.body.click();
            await window.delay(300);
        }

        // Always ensure dropdown is closed before next question
        document.body.click();
        await window.delay(400);
    }

    // Handle acknowledgment text field ("please enter yes")
    var allInputs = Array.from(document.querySelectorAll('input[type="text"], textarea'));
    for (var ii = 0; ii < allInputs.length; ii++) {
        var ackInp = allInputs[ii];
        if (ackInp.value) continue;
        var ackRect = ackInp.getBoundingClientRect();
        if (ackRect.width === 0 || ackRect.height === 0) continue;
        var ackParent = ackInp.parentElement;
        for (var pi = 0; pi < 6 && ackParent; pi++) {
            var pTxt = ackParent.textContent.toLowerCase();
            if (pTxt.indexOf('acknowledge') !== -1 && (pTxt.indexOf("'yes'") !== -1 || pTxt.indexOf('"yes"') !== -1 || pTxt.indexOf('enter yes') !== -1)) {
                var nset = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
                ackInp.focus();
                nset.call(ackInp, 'yes');
                ackInp.dispatchEvent(new Event('input', {bubbles:true}));
                ackInp.dispatchEvent(new Event('change', {bubbles:true}));
                filled++;
                console.log('[WD] Acknowledgment filled: yes');
                break;
            }
            ackParent = ackParent.parentElement;
        }
    }

    if (filled > 0) { try { window.showToast('Answered ' + filled + ' questions', 'success'); } catch(e) {} }
    console.log('[WD] Section 3 DONE, filled:', filled);
    return filled;
}


// --------------------------------------------------------------
// SECTION 4: VOLUNTARY DISCLOSURES
// --------------------------------------------------------------
async function wdFillVoluntaryDisclosures(p) {
    console.log('[WD] Section 4: Voluntary Disclosures START');
    var filled = 0;

    // Check consent/acknowledge checkboxes
    var cbs = Array.from(document.querySelectorAll('input[type="checkbox"]')).filter(function(cb){
        var r=cb.getBoundingClientRect(); return r.width>0&&r.height>0&&!cb.disabled;
    });
    for (var ci = 0; ci < cbs.length; ci++) {
        var cb = cbs[ci];
        if (wdState.filledElements.has(cb)) continue;
        var lbl = window.getLabelForElement(cb).toLowerCase();
        if (/acknowledge|agree|consent|certif|accept/i.test(lbl) && !cb.checked) {
            cb.click(); cb.dispatchEvent(new Event('change',{bubbles:true}));
            wdState.filledElements.add(cb); filled++;
            console.log('[WD] Consent checked:', lbl.substring(0,60));
        }
        await window.delay(100);
    }

    // Pick safe-default radio options for disclosures
    var radios = Array.from(document.querySelectorAll('input[type="radio"]')).filter(function(r){
        var rect=r.getBoundingClientRect(); return rect.width>0&&rect.height>0;
    });
    for (var ri = 0; ri < radios.length; ri++) {
        var rb = radios[ri];
        if (wdState.filledElements.has(rb) || rb.checked) continue;
        var rlbl = window.getLabelForElement(rb).toLowerCase();
        if (/decline|not a protected veteran|no.*disab|i don.t have/i.test(rlbl)) {
            rb.click(); rb.dispatchEvent(new Event('change',{bubbles:true}));
            wdState.filledElements.add(rb); filled++;
            console.log('[WD] Disclosure radio:', rlbl.substring(0,60));
        }
        await window.delay(100);
    }
    console.log('[WD] Section 4 DONE, filled:', filled);
    return filled;
}

// --------------------------------------------------------------
// MAIN ENTRY POINT - detects section and routes to correct fn
// --------------------------------------------------------------
async function fillWorkday(profile) {
    console.log('[AutoFill] fillWorkday start');
    var p = profile || {};
    var filled = 0;
    wdState.filledElements = new Set();

    var h3 = document.querySelector('h3');
    var section = h3 ? h3.textContent.trim() : '';
    console.log('[WD] Section heading:', section);

    if (/my experience/i.test(section)) {
        filled = await wdFillMyExperience(p);

    } else if (/application questions/i.test(section)) {
        filled = await wdFillAppQuestions(p);

    } else if (/voluntary/i.test(section)) {
        filled = await wdFillVoluntaryDisclosures(p);

    } else if (/review/i.test(section)) {
        window.showToast('All sections filled! Please review and click Submit.', 'success');
        console.log('[WD] Review - user clicks Submit manually');
        filled = 0;

    } else {
        // Section 1: My Information
        var s1 = await wdFillMyInformation(p);
        filled += s1.filled;
        filled += await wdFillPhoneCountryCode(s1.phoneCountryName);
        filled += await wdFillCountryDropdown(s1.country);

        // Previous worker radio: tv5q4=No (default), tv5q3=Yes
        var rbId = s1.hasWorked ? 'tv5q3' : 'tv5q4';
        var rb = document.getElementById(rbId);
        if (rb && !rb.checked && !wdState.filledElements.has(rb)) {
            rb.click(); rb.dispatchEvent(new Event('change',{bubbles:true}));
            wdState.filledElements.add(rb); filled++;
            console.log('[WD] Previous worker:', s1.hasWorked ? 'Yes' : 'No');
        }
    }

    console.log('[AutoFill] fillWorkday done, filled:', filled);
    return filled;
}

// -- Message listener - same interface as autoFill.js ---------
chrome.runtime.onMessage.addListener(function(message, sender, sendResponse) {
    if (!message || !message.type) return false;

    if (message.type === 'PERFORM_AUTO_FILL' ||
        message.type === 'AUTOFILL_START'    ||
        message.type === 'AUTO_FILL_FORM') {

        if (wdState.isFilling) { sendResponse({success:false, error:'Already filling'}); return false; }

        var profile  = message.userProfile || message.profile || message.data || null;
        wdState.isFilling = true;
        if (message.backendUrl) window.AUTOFILL_BACKEND_URL = message.backendUrl;

        function doFill(p) {
            console.log('[WD] Starting autofill | name:', (p && (p.name||p.first_name)) || 'unknown');
            console.log('[WD] Profile data:', p);
            try {
                window.showToast('Workday AutoFill starting...', 'success');
            } catch (toastErr) {
                console.warn('[WD] showToast not available:', toastErr.message);
            }
            fillWorkday(p)
                .then(function(n) {
                    wdState.isFilling = false;
                    console.log('[WD] AutoFill complete:', n, 'fields filled');
                    try {
                        window.showToast('Workday AutoFill: ' + n + ' field(s) filled.', 'success');
                    } catch (toastErr) {}
                    try { 
                        sendResponse({success:true, filled:n, result:{filledCount:n, skippedCount:0}}); 
                    } catch(e) {
                        console.warn('[WD] sendResponse failed:', e.message);
                    }
                })
                .catch(function(err) {
                    wdState.isFilling = false;
                    console.error('[WD] AutoFill error:', err);
                    console.error('[WD] Error stack:', err.stack);
                    try { 
                        sendResponse({success:false, error:err.message}); 
                    } catch(e) {
                        console.warn('[WD] sendResponse failed:', e.message);
                    }
                });
        }

        if (!profile) {
            chrome.storage.local.get(['userProfile'], function(r) {
                var sp = r && r.userProfile;
                if (!sp) { sendResponse({success:false, error:'No profile. Upload resume first.'}); wdState.isFilling=false; return; }
                doFill(sp);
            });
            return true;
        }
        doFill(profile);
        return true;
    }

    if (message.type === 'PING') { sendResponse({alive:true, platform:'workday'}); return false; }
    if (message.type === 'DETECT_PLATFORM') { sendResponse({success:true, platform:'workday'}); return false; }
    return false;
});

console.log('[Workday] autoFill-workday.js loaded');
console.log('[Workday] fillWorkday function:', typeof fillWorkday !== 'undefined' ? 'DEFINED' : 'UNDEFINED');
console.log('[Workday] Message listener:', chrome.runtime.onMessage.hasListeners() ? 'REGISTERED' : 'NOT REGISTERED');
console.log('[Workday] Helper functions check:', {
    delay: typeof window.delay !== 'undefined',
    showToast: typeof window.showToast !== 'undefined',
    isFieldFillable: typeof window.isFieldFillable !== 'undefined'
});
} // end __workdayFillInitialized guard


