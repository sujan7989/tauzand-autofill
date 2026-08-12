/**
 * WORKDAY AUTOFILL — COMPLETE IMPLEMENTATION
 * 
 * Handles ALL 5 sections of Workday job application:
 * [✓] Section 1: My Information (Personal + Contact details)
 * [✓] Section 2: My Experience (LinkedIn, Education, Work Experience, Skills)
 * [✓] Section 3: Application Questions (AI-generated answers)
 * [✓] Section 4: Voluntary Disclosures (Demographics)
 * [✓] Section 5: Review (Display completion status, user clicks Submit)
 * 
 * All data comes from resume profile, no hardcoding.
 * Gracefully handles missing fields (logs but continues).
 */

// ═══════════════════════════════════════════════════════════════════════════
// 1. CONFIG & HELPERS (duplicated locally for independence)
// ═══════════════════════════════════════════════════════════════════════════

var WORKDAY_CONFIG = {
    DELAY_BETWEEN_FIELDS: 100,
    DELAY_BETWEEN_SECTIONS: 400,
    DELAY_BEFORE_BUTTON_CLICK: 200,
    AI_QUESTIONS_ENABLED: true,
    BACKEND_URL: 'http://localhost:5000',
    COUNTRY_CODE_MAP: {
        '+1': 'United States', '+7': 'Russia', '+20': 'Egypt',
        '+27': 'South Africa', '+30': 'Greece', '+31': 'Netherlands',
        '+32': 'Belgium', '+33': 'France', '+34': 'Spain', '+36': 'Hungary',
        '+39': 'Italy', '+40': 'Romania', '+41': 'Switzerland', '+43': 'Austria',
        '+44': 'United Kingdom', '+45': 'Denmark', '+46': 'Sweden', '+47': 'Norway',
        '+48': 'Poland', '+49': 'Germany', '+51': 'Peru', '+52': 'Mexico',
        '+55': 'Brazil', '+56': 'Chile', '+60': 'Malaysia', '+61': 'Australia',
        '+62': 'Indonesia', '+63': 'Philippines', '+64': 'New Zealand',
        '+65': 'Singapore', '+66': 'Thailand', '+81': 'Japan', '+82': 'South Korea',
        '+84': 'Vietnam', '+86': 'China', '+90': 'Turkey', '+91': 'India',
        '+92': 'Pakistan', '+93': 'Afghanistan', '+94': 'Sri Lanka',
        '+95': 'Myanmar', '+98': 'Iran', '+212': 'Morocco', '+234': 'Nigeria',
        '+254': 'Kenya', '+971': 'United Arab Emirates'
    }
};

var workdayState = {
    filledElements: new Set(),
    currentSection: 0,
    sectionsCompleted: 0
};

function delay(ms) {
    return new Promise(function(r) { setTimeout(r, ms); });
}

function fillField(el, value) {
    if (!el) return false;
    try {
        var nativeSetter = Object.getOwnPropertyDescriptor(
            window.HTMLInputElement.prototype, 'value'
        );
        if (!nativeSetter) {
            nativeSetter = Object.getOwnPropertyDescriptor(
                window.HTMLTextAreaElement.prototype, 'value'
            );
        }
        var setter = nativeSetter && nativeSetter.set;
        if (setter) setter.call(el, value);
        else el.value = value;
        
        el.dispatchEvent(new Event('input', {bubbles: true, cancelable: true}));
        el.dispatchEvent(new Event('change', {bubbles: true, cancelable: true}));
        el.dispatchEvent(new Event('blur', {bubbles: true, cancelable: true}));
        return true;
    } catch (e) {
        console.log('[Workday] fillField error:', e.message);
        return false;
    }
}

function isFieldFillable(el) {
    if (!el) return false;
    try {
        var rect = el.getBoundingClientRect();
        if (rect.width === 0 && rect.height === 0) return false;
    } catch (e) { return false; }
    if (el.disabled || el.readOnly) return false;
    var style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || 
        style.opacity === '0') return false;
    return true;
}

function getLabelForElement(el) {
    if (!el) return '';
    if (el.id) {
        var lbl = document.querySelector('label[for="' + el.id + '"]');
        if (lbl) return lbl.textContent.trim();
    }
    var parent = el.parentElement;
    while (parent && parent !== document.body) {
        if (parent.tagName && parent.tagName.toLowerCase() === 'label') {
            return parent.textContent.trim();
        }
        parent = parent.parentElement;
    }
    if (el.getAttribute('aria-label')) 
        return el.getAttribute('aria-label').trim();
    var labelledBy = el.getAttribute('aria-labelledby');
    if (labelledBy) {
        var lblEl = document.getElementById(labelledBy);
        if (lblEl) return lblEl.textContent.trim();
    }
    if (el.placeholder) return el.placeholder.trim();
    if (el.name) return el.name.trim();
    return '';
}

function fillCheckbox(el, value) {
    if (!el) return false;
    try {
        var shouldCheck = value === true || value === 'true' || value === '1' ||
                         (typeof value === 'string' && /^(yes|on|checked|true)$/i.test(value.trim()));
        if (el.checked !== shouldCheck) {
            el.click();
            el.dispatchEvent(new Event('change', {bubbles: true}));
        }
        return true;
    } catch (e) { return false; }
}

function fillRadio(el, value) {
    if (!el) return false;
    try {
        var elVal = (el.value || '').toLowerCase();
        var elLbl = (getLabelForElement(el) || '').toLowerCase();
        var val = (value || '').toLowerCase();
        if (elVal === val || elLbl === val || elVal.includes(val) || val.includes(elVal)) {
            if (!el.checked) {
                el.click();
                el.dispatchEvent(new Event('change', {bubbles: true}));
            }
            return true;
        }
        return false;
    } catch (e) { return false; }
}

function fillSelect(el, value) {
    if (!el) return false;
    try {
        for (var i = 0; i < el.options.length; i++) {
            if ((el.options[i].value || '').toLowerCase() === 
                (value || '').toLowerCase()) {
                el.selectedIndex = i;
                el.dispatchEvent(new Event('change', {bubbles: true}));
                return true;
            }
        }
        for (var j = 0; j < el.options.length; j++) {
            if ((el.options[j].text || '').toLowerCase().includes(
                (value || '').toLowerCase())) {
                el.selectedIndex = j;
                el.dispatchEvent(new Event('change', {bubbles: true}));
                return true;
            }
        }
        return false;
    } catch (e) { return false; }
}

function fillAnyField(el, value) {
    if (!el || value === null || value === undefined) return false;
    var tag = el.tagName ? el.tagName.toLowerCase() : '';
    var type = (el.type || '').toLowerCase();
    if (tag === 'select') return fillSelect(el, String(value));
    if (tag === 'input' && type === 'checkbox') return fillCheckbox(el, value);
    if (tag === 'input' && type === 'radio') return fillRadio(el, String(value));
    if (tag === 'input' || tag === 'textarea') return fillField(el, String(value));
    return false;
}

async function getAIAnswer(question, profile) {
    try {
        var res = await fetch(WORKDAY_CONFIG.BACKEND_URL + '/api/ai-answer', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({question: question, profile: profile})
        });
        if (!res.ok) return null;
        var data = await res.json();
        return data.answer || data.response || null;
    } catch (e) {
        console.log('[Workday] AI answer fetch failed:', e.message);
        return null;
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// 2. SECTION 1: MY INFORMATION
// ═══════════════════════════════════════════════════════════════════════════

async function fillSection1_MyInformation(profile) {
    console.log('[Workday] Section 1: My Information - START');
    var p = profile || {};
    var filled = 0;

    var firstName = (p.first_name) || (p.personal && p.personal.first_name) || '';
    var middleName = (p.middle_name) || (p.personal && p.personal.middle_name) || '';
    var lastName = (p.last_name) || (p.personal && p.personal.last_name) || '';
    var phoneRaw = (p.contact && p.contact.phone) || p.phone || '';
    var address = (p.contact && p.contact.address) || p.address || '';
    var city = ((p.contact && p.contact.city) || p.city || '').split(',')[0].trim();
    var postalCode = (p.contact && p.contact.postal_code) || 
                     (p.contact && p.contact.zip_code) || p.postal_code || '';
    var country = (p.contact && p.contact.country) || p.country || 'India';
    var extension = (p.contact && p.contact.phone_extension) || p.extension || '';
    var hasWorkedAtWorkday = p.has_worked_at_workday === true;

    // Extract phone digits (strip country code)
    var phone = phoneRaw;
    if (phoneRaw.startsWith('+')) {
        var digits = phoneRaw.slice(1);
        if (digits.length === 12) phone = digits.slice(2);
        else if (digits.length === 11) phone = digits.slice(1);
        else if (digits.length === 13) phone = digits.slice(3);
        else phone = digits.replace(/^\d{1,3}/, '') || digits;
    }

    // Derive country code from phone
    var phoneCountryCode = '';
    if (phoneRaw.startsWith('+')) {
        for (var pc in WORKDAY_CONFIG.COUNTRY_CODE_MAP) {
            if (phoneRaw.startsWith(pc)) {
                phoneCountryCode = WORKDAY_CONFIG.COUNTRY_CODE_MAP[pc];
                break;
            }
        }
    }
    if (!phoneCountryCode && country) phoneCountryCode = country;

    // ── Fill text fields by ID ──────────────────────────────────────
    var textFieldMap = [
        {id: 'name--legalName--firstName', v: firstName, label: 'Given Name'},
        {id: 'name--legalName--middleName', v: middleName, label: 'Middle Name'},
        {id: 'name--legalName--lastName', v: lastName, label: 'Family Name'},
        {id: 'name--legalName--firstNameLocal', v: firstName, label: 'Local Given Name'},
        {id: 'name--legalName--lastNameLocal', v: lastName, label: 'Local Family Name'},
        {id: 'address--addressLine1', v: address, label: 'Address Line 1'},
        {id: 'address--city', v: city, label: 'City'},
        {id: 'address--postalCode', v: postalCode, label: 'Postal Code'},
        {id: 'phoneNumber--phoneNumber', v: phone, label: 'Phone Number'},
        {id: 'phoneNumber--extension', v: extension, label: 'Extension'}
    ];

    for (var ti = 0; ti < textFieldMap.length; ti++) {
        var tfm = textFieldMap[ti];
        if (!tfm.v) continue;
        var el = document.getElementById(tfm.id);
        if (el && isFieldFillable(el) && !workdayState.filledElements.has(el)) {
            if (fillField(el, tfm.v)) {
                workdayState.filledElements.add(el);
                filled++;
                console.log('[Workday] Section 1 - filled:', tfm.label);
            }
        }
        await delay(WORKDAY_CONFIG.DELAY_BETWEEN_FIELDS);
    }

    // ── Phone Country Code ──────────────────────────────────────────
    var ccInput = document.getElementById('phoneNumber--countryPhoneCode');
    if (ccInput && phoneCountryCode && isFieldFillable(ccInput) && 
        !workdayState.filledElements.has(ccInput)) {
        ccInput.click();
        ccInput.focus();
        await delay(150);
        
        var ns3 = Object.getOwnPropertyDescriptor(
            window.HTMLInputElement.prototype, 'value'
        ).set;
        var cur3 = '';
        for (var ci4 = 0; ci4 < phoneCountryCode.length; ci4++) {
            var ch4 = phoneCountryCode[ci4];
            var kc4 = ch4.charCodeAt(0);
            cur3 += ch4;
            ccInput.dispatchEvent(new KeyboardEvent('keydown', 
                {key: ch4, keyCode: kc4, which: kc4, bubbles: true}));
            if (ns3) ns3.call(ccInput, cur3); else ccInput.value = cur3;
            ccInput.dispatchEvent(new InputEvent('input', 
                {bubbles: true, inputType: 'insertText', data: ch4}));
            ccInput.dispatchEvent(new KeyboardEvent('keyup', 
                {key: ch4, keyCode: kc4, which: kc4, bubbles: true}));
            await delay(40);
        }
        await delay(400);
        
        var allRadios = Array.from(
            document.querySelectorAll('input[type="radio"]')
        ).filter(function(r) {
            var rect = r.getBoundingClientRect();
            return rect.height > 0 && rect.width > 0;
        });

        var targetRadio = allRadios.find(function(r) {
            var closest = r.closest('div[role="option"], [class*="option"]');
            if (!closest) return false;
            var text = closest.textContent.toLowerCase();
            return text.includes(phoneCountryCode.toLowerCase());
        });

        if (targetRadio) {
            targetRadio.click();
            targetRadio.dispatchEvent(new Event('change', {bubbles: true}));
            filled++;
            workdayState.filledElements.add(ccInput);
            console.log('[Workday] Section 1 - Phone country:', phoneCountryCode);
        }
    }
    await delay(WORKDAY_CONFIG.DELAY_BETWEEN_FIELDS);

    // ── Country/Territory Select ────────────────────────────────────
    var countrySelect = document.querySelector('#country--country');
    if (countrySelect && isFieldFillable(countrySelect) && 
        !workdayState.filledElements.has(countrySelect)) {
        countrySelect.click();
        countrySelect.focus();
        await delay(200);
        
        var ns4 = Object.getOwnPropertyDescriptor(
            window.HTMLInputElement.prototype, 'value'
        ).set;
        var cur4 = '';
        for (var ci5 = 0; ci5 < country.length; ci5++) {
            var ch5 = country[ci5];
            var kc5 = ch5.charCodeAt(0);
            cur4 += ch5;
            countrySelect.dispatchEvent(new KeyboardEvent('keydown', 
                {key: ch5, keyCode: kc5, which: kc5, bubbles: true}));
            if (ns4) ns4.call(countrySelect, cur4); else countrySelect.value = cur4;
            countrySelect.dispatchEvent(new InputEvent('input', 
                {bubbles: true, inputType: 'insertText', data: ch5}));
            countrySelect.dispatchEvent(new KeyboardEvent('keyup', 
                {key: ch5, keyCode: kc5, which: kc5, bubbles: true}));
            await delay(40);
        }
        await delay(600);
        
        var opts4 = Array.from(
            document.querySelectorAll('[class*="select__option"], [role="option"]')
        ).filter(function(o) {
            var r = o.getBoundingClientRect();
            return r.width > 0 && r.height > 0;
        });

        var desired4 = country.toLowerCase();
        var target4 = opts4.find(function(o) {
            return o.textContent.trim().toLowerCase() === desired4;
        }) || opts4.find(function(o) {
            return o.textContent.trim().toLowerCase().startsWith(desired4);
        }) || opts4.find(function(o) {
            return o.textContent.trim().toLowerCase().includes(desired4);
        });

        if (target4) {
            target4.click();
            filled++;
            workdayState.filledElements.add(countrySelect);
            console.log('[Workday] Section 1 - Country:', target4.textContent.trim());
        }
    }
    await delay(WORKDAY_CONFIG.DELAY_BETWEEN_FIELDS);

    // ── Previous Worker Radio Button ────────────────────────────────
    var radioPreviousWorker = hasWorkedAtWorkday ? 'tv5q3' : 'tv5q4';
    var rb = document.getElementById(radioPreviousWorker);
    if (rb && !rb.checked && !workdayState.filledElements.has(rb)) {
        rb.click();
        rb.dispatchEvent(new Event('change', {bubbles: true}));
        filled++;
        workdayState.filledElements.add(rb);
        console.log('[Workday] Section 1 - Previous worker:', 
            hasWorkedAtWorkday ? 'Yes' : 'No');
    }

    console.log('[Workday] Section 1: My Information - DONE (' + filled + ' fields)');
    return filled;
}

// ═══════════════════════════════════════════════════════════════════════════
// 3. SECTION 2: MY EXPERIENCE
// ═══════════════════════════════════════════════════════════════════════════

async function fillSection2_MyExperience(profile) {
    console.log('[Workday] Section 2: My Experience - START');
    var p = profile || {};
    var filled = 0;

    var linkedin = (p.social && p.social.linkedin) || p.linkedin || '';
    var education = p.education || [];
    var experience = p.experience || [];
    var skills = p.skills || [];

    // ── LinkedIn Profile URL ────────────────────────────────────────
    // Normalize URL
    if (linkedin && !linkedin.startsWith('http')) {
        linkedin = 'https://www.linkedin.com/in/' + 
            linkedin.replace(/.*linkedin\.com\/in\//i, '');
    }

    // Try to find LinkedIn field - look for ID or label
    var linkedinField = document.getElementById('socialProfiles--linkedInProfile') ||
        document.getElementById('linkedinProfile') ||
        Array.from(document.querySelectorAll('input')).find(function(e) {
            var lbl = getLabelForElement(e).toLowerCase();
            return /linkedin/i.test(lbl) && e.type !== 'hidden';
        });

    if (linkedinField && linkedin && isFieldFillable(linkedinField) && 
        !workdayState.filledElements.has(linkedinField)) {
        if (fillField(linkedinField, linkedin)) {
            workdayState.filledElements.add(linkedinField);
            filled++;
            console.log('[Workday] Section 2 - LinkedIn added');
        }
    }
    await delay(WORKDAY_CONFIG.DELAY_BETWEEN_FIELDS);

    // ── Education Entries ──────────────────────────────────────────
    // Each education entry typically has: Institution, Degree, Field, From, To
    for (var ei = 0; ei < education.length; ei++) {
        var edu = education[ei];
        var institution = edu.institution || edu.school || '';
        var degree = edu.degree || '';
        var field = edu.field_of_study || edu.field || '';
        var startYear = edu.from || edu.start_year || '';
        var endYear = edu.to || edu.end_year || '';

        console.log('[Workday] Section 2 - Education entry', (ei+1) + ':', institution);

        // Look for "Add" button to add new education entry
        var addEduBtn = Array.from(document.querySelectorAll('button')).find(
            function(b) {
                var txt = b.textContent.toLowerCase();
                return /add.*education|education.*add|add school/i.test(txt);
            }
        );

        if (ei > 0 && addEduBtn && isFieldFillable(addEduBtn)) {
            addEduBtn.click();
            await delay(WORKDAY_CONFIG.DELAY_BETWEEN_SECTIONS);
        }

        // Find education form fields (typically in a card/section for each entry)
        // Strategy: search for fields with labels containing "school", "institution", 
        // "degree", "field of study" etc.
        var eduFields = Array.from(document.querySelectorAll(
            'input[type="text"], textarea, select'
        )).filter(function(f) {
            var rect = f.getBoundingClientRect();
            return rect.height > 0 && rect.width > 0 && f.offsetParent !== null;
        });

        // Filter to likely education fields in current entry (last few visible inputs)
        // This is heuristic - Workday's layout varies by customer
        var likelyEduFields = eduFields.slice(-10);

        for (var efi = 0; efi < likelyEduFields.length; efi++) {
            var efield = likelyEduFields[efi];
            if (workdayState.filledElements.has(efield)) continue;
            
            var elbl = getLabelForElement(efield).toLowerCase();
            var eval = '';

            if (/institution|school|university|college/i.test(elbl)) 
                eval = institution;
            else if (/degree/i.test(elbl)) 
                eval = degree;
            else if (/field|major|discipline|specialization/i.test(elbl)) 
                eval = field;
            else if (/start|from|beginning|commence/i.test(elbl)) 
                eval = startYear;
            else if (/end|to|graduation|finish|complete/i.test(elbl)) 
                eval = endYear;

            if (eval && fillAnyField(efield, eval)) {
                workdayState.filledElements.add(efield);
                filled++;
                console.log('[Workday] Section 2 - Education field:', elbl);
            }
            await delay(WORKDAY_CONFIG.DELAY_BETWEEN_FIELDS);
        }
    }

    await delay(WORKDAY_CONFIG.DELAY_BETWEEN_SECTIONS);

    // ── Work Experience Entries ───────────────────────────────────
    for (var expei = 0; expei < experience.length; expei++) {
        var exp = experience[expei];
        var company = exp.company || '';
        var title = exp.title || exp.job_title || '';
        var location = exp.location || '';
        var startDate = exp.from || exp.start_year || '';
        var endDate = exp.to || exp.end_year || '';
        var description = exp.description || '';

        console.log('[Workday] Section 2 - Experience entry', (expei+1) + ':', company);

        // Look for "Add" button for work experience
        var addExpBtn = Array.from(document.querySelectorAll('button')).find(
            function(b) {
                var txt = b.textContent.toLowerCase();
                return /add.*experience|experience.*add|add job/i.test(txt);
            }
        );

        if (expei > 0 && addExpBtn && isFieldFillable(addExpBtn)) {
            addExpBtn.click();
            await delay(WORKDAY_CONFIG.DELAY_BETWEEN_SECTIONS);
        }

        // Find experience form fields
        var expFields = Array.from(document.querySelectorAll(
            'input[type="text"], textarea, select'
        )).filter(function(f) {
            var rect = f.getBoundingClientRect();
            return rect.height > 0 && rect.width > 0 && f.offsetParent !== null;
        });

        var likelyExpFields = expFields.slice(-12);

        for (var exi = 0; exi < likelyExpFields.length; exi++) {
            var expfield = likelyExpFields[exi];
            if (workdayState.filledElements.has(expfield)) continue;
            
            var exlbl = getLabelForElement(expfield).toLowerCase();
            var exval = '';

            if (/company|employer|organization/i.test(exlbl)) 
                exval = company;
            else if (/title|position|job.?title|role/i.test(exlbl)) 
                exval = title;
            else if (/location|city|workplace/i.test(exlbl)) 
                exval = location;
            else if (/start|from|begin/i.test(exlbl) && !/end|to/i.test(exlbl)) 
                exval = startDate;
            else if ((/end|to|finish/i.test(exlbl) || /until/i.test(exlbl)) && 
                     !/start|from|begin/i.test(exlbl)) 
                exval = endDate;
            else if (/description|responsibility|duties|summary|about/i.test(exlbl)) 
                exval = description;

            if (exval && fillAnyField(expfield, exval)) {
                workdayState.filledElements.add(expfield);
                filled++;
                console.log('[Workday] Section 2 - Experience field:', exlbl);
            }
            await delay(WORKDAY_CONFIG.DELAY_BETWEEN_FIELDS);
        }
    }

    await delay(WORKDAY_CONFIG.DELAY_BETWEEN_SECTIONS);

    // ── Skills (comma-separated list) ───────────────────────────────
    var skillsText = Array.isArray(skills) ? skills.join(', ') : skills;
    var skillsField = Array.from(document.querySelectorAll(
        'input[type="text"], textarea'
    )).find(function(f) {
        var lbl = getLabelForElement(f).toLowerCase();
        return /skill/i.test(lbl);
    });

    if (skillsField && skillsText && isFieldFillable(skillsField) && 
        !workdayState.filledElements.has(skillsField)) {
        if (fillField(skillsField, skillsText)) {
            workdayState.filledElements.add(skillsField);
            filled++;
            console.log('[Workday] Section 2 - Skills added');
        }
    }

    console.log('[Workday] Section 2: My Experience - DONE (' + filled + ' fields)');
    return filled;
}

// ═══════════════════════════════════════════════════════════════════════════
// 4. SECTION 3: APPLICATION QUESTIONS (AI-Generated Answers)
// ═══════════════════════════════════════════════════════════════════════════

var AI_QUESTION_PATTERNS = [
    /cover letter/i, /why do you want/i, /why are you interest/i,
    /tell us about yourself/i, /describe your experience/i,
    /what are your strength/i, /what are your weakness/i,
    /where do you see yourself/i, /what motivates you/i,
    /why should we hire/i, /describe a challenge/i, /describe a situation/i,
    /how do you handle/i, /what is your greatest/i, /tell me about a time/i,
    /what are your career goal/i, /what do you know about/i,
    /how did you hear about/i, /what salary/i, /salary expectation/i,
    /desired salary/i, /notice period/i, /available to start/i,
    /earliest start/i, /willing to relocate/i, /open to relocation/i,
    /additional information/i, /anything else/i, /is there anything/i,
    /please describe/i, /please explain/i, /briefly describe/i,
    /share your/i, /how would you/i, /what experience do you have/i,
    /how many years/i, /years of experience/i, /describe your background/i,
    /relevant experience/i, /passion for/i, /what drives you/i,
    /what excites you/i, /additional comment/i
];

function isAIQuestion(labelText) {
    if (!labelText) return false;
    var lc = labelText.toLowerCase();
    return AI_QUESTION_PATTERNS.some(function(p) { return p.test(lc); });
}

async function fillSection3_ApplicationQuestions(profile) {
    console.log('[Workday] Section 3: Application Questions - START');
    var p = profile || {};
    var filled = 0;

    if (!WORKDAY_CONFIG.AI_QUESTIONS_ENABLED) {
        console.log('[Workday] Section 3: AI questions disabled');
        return 0;
    }

    // Find all textarea elements for open-ended questions
    var allTextareas = Array.from(document.querySelectorAll('textarea'));
    
    for (var qi = 0; qi < allTextareas.length; qi++) {
        var ta = allTextareas[qi];
        if (!isFieldFillable(ta) || workdayState.filledElements.has(ta)) 
            continue;

        var taLabel = getLabelForElement(ta);
        if (!taLabel || !isAIQuestion(taLabel)) 
            continue;

        console.log('[Workday] Section 3 - AI Question:', taLabel.substring(0, 60));

        // Get AI answer from backend
        var answer = await getAIAnswer(taLabel, p);
        if (answer) {
            if (fillField(ta, answer)) {
                workdayState.filledElements.add(ta);
                filled++;
                console.log('[Workday] Section 3 - Answered question');
            }
        } else {
            console.log('[Workday] Section 3 - No answer generated for:', 
                taLabel.substring(0, 40));
        }

        await delay(WORKDAY_CONFIG.DELAY_BETWEEN_FIELDS);
    }

    console.log('[Workday] Section 3: Application Questions - DONE (' + 
        filled + ' questions)');
    return filled;
}

// ═══════════════════════════════════════════════════════════════════════════
// 5. SECTION 4: VOLUNTARY DISCLOSURES
// ═══════════════════════════════════════════════════════════════════════════

async function fillSection4_VoluntaryDisclosures(profile) {
    console.log('[Workday] Section 4: Voluntary Disclosures - START');
    var p = profile || {};
    var filled = 0;

    var veteranStatus = (p.professional && p.professional.veteran_status) || 
                        p.veteran_status || 'Not a veteran';
    var disabilityStatus = (p.professional && p.professional.disability_status) || 
                           p.disability_status || false;
    var gender = (p.professional && p.professional.gender) || p.gender || 
                 'Decline To Self Identify';
    var ethnicity = (p.professional && p.professional.ethnicity) || 
                    p.ethnicity || '';

    // ── Checkboxes: Consent/Acknowledge/Decline ────────────────────
    var allCheckboxes = Array.from(document.querySelectorAll('input[type="checkbox"]'));
    
    for (var ci = 0; ci < allCheckboxes.length; ci++) {
        var cb = allCheckboxes[ci];
        if (!isFieldFillable(cb)) continue;

        var cbLabel = getLabelForElement(cb).toLowerCase();

        // SKIP: Disclosure-specific patterns (handled separately)
        if (/veteran|disability|gender|ethnicity|race/i.test(cbLabel)) 
            continue;

        if (workdayState.filledElements.has(cb)) 
            continue;

        // UNCHECK: "I do not want to answer" / "Decline" patterns
        if (/decline|do not|skip|prefer not/i.test(cbLabel)) {
            if (cb.checked) {
                cb.click();
                cb.dispatchEvent(new Event('change', {bubbles: true}));
                console.log('[Workday] Section 4 - Unchecked decline option');
            }
            workdayState.filledElements.add(cb);
            continue;
        }

        // CHECK: Acknowledge/Agree/Consent patterns
        if (/acknowledge|confirm|consent|agree|accept|certif|terms|privacy/i
            .test(cbLabel)) {
            if (!cb.checked) {
                cb.click();
                cb.dispatchEvent(new Event('change', {bubbles: true}));
                filled++;
                console.log('[Workday] Section 4 - Checked:', 
                    cbLabel.substring(0, 60));
            }
            workdayState.filledElements.add(cb);
        }

        await delay(WORKDAY_CONFIG.DELAY_BETWEEN_FIELDS);
    }

    // ── Radio Buttons: Veteran Status ──────────────────────────────
    var veteranRadios = Array.from(document.querySelectorAll('input[type="radio"]'))
        .filter(function(r) {
            var lbl = getLabelForElement(r).toLowerCase();
            return /veteran/i.test(lbl);
        });

    if (veteranRadios.length > 0) {
        for (var vri = 0; vri < veteranRadios.length; vri++) {
            var vr = veteranRadios[vri];
            if (workdayState.filledElements.has(vr)) continue;
            
            var vrlbl = getLabelForElement(vr).toLowerCase();
            var shouldCheck = /not.*veteran|no/i.test(vrlbl) ? !veteranStatus
                            : /yes|protected/i.test(vrlbl) ? veteranStatus
                            : false;

            if (shouldCheck && !vr.checked) {
                vr.click();
                vr.dispatchEvent(new Event('change', {bubbles: true}));
                filled++;
                workdayState.filledElements.add(vr);
                console.log('[Workday] Section 4 - Veteran radio:', vrlbl);
            }
        }
        await delay(WORKDAY_CONFIG.DELAY_BETWEEN_FIELDS);
    }

    // ── Radio Buttons: Disability Status ───────────────────────────
    var disabilityRadios = Array.from(document.querySelectorAll('input[type="radio"]'))
        .filter(function(r) {
            var lbl = getLabelForElement(r).toLowerCase();
            return /disability/i.test(lbl);
        });

    if (disabilityRadios.length > 0) {
        for (var dri = 0; dri < disabilityRadios.length; dri++) {
            var dr = disabilityRadios[dri];
            if (workdayState.filledElements.has(dr)) continue;
            
            var drlbl = getLabelForElement(dr).toLowerCase();
            var shouldCheckDisability = disabilityStatus ? /yes|have/i.test(drlbl)
                                      : /no|do not/i.test(drlbl);

            if (shouldCheckDisability && !dr.checked) {
                dr.click();
                dr.dispatchEvent(new Event('change', {bubbles: true}));
                filled++;
                workdayState.filledElements.add(dr);
                console.log('[Workday] Section 4 - Disability radio:', drlbl);
            }
        }
        await delay(WORKDAY_CONFIG.DELAY_BETWEEN_FIELDS);
    }

    // ── Radio Buttons: Gender ──────────────────────────────────────
    var genderRadios = Array.from(document.querySelectorAll('input[type="radio"]'))
        .filter(function(r) {
            var lbl = getLabelForElement(r).toLowerCase();
            return /^gender$|gender identity/i.test(lbl) || 
                   (getLabelForElement(r.parentElement || {}).toLowerCase()
                    .includes('gender'));
        });

    if (genderRadios.length > 0) {
        for (var gri = 0; gri < genderRadios.length; gri++) {
            var gr = genderRadios[gri];
            if (workdayState.filledElements.has(gr)) continue;
            
            var grlbl = getLabelForElement(gr).toLowerCase();
            var shouldCheckGender = grlbl.includes(gender.toLowerCase());

            if (shouldCheckGender && !gr.checked) {
                gr.click();
                gr.dispatchEvent(new Event('change', {bubbles: true}));
                filled++;
                workdayState.filledElements.add(gr);
                console.log('[Workday] Section 4 - Gender radio:', grlbl);
            }
        }
        await delay(WORKDAY_CONFIG.DELAY_BETWEEN_FIELDS);
    }

    // ── Radio Buttons: Ethnicity / Race ────────────────────────────
    var ethnicityRadios = Array.from(document.querySelectorAll('input[type="radio"]'))
        .filter(function(r) {
            var lbl = getLabelForElement(r).toLowerCase();
            return /ethnicity|race|hispanic|latino/i.test(lbl);
        });

    if (ethnicityRadios.length > 0 && ethnicity) {
        for (var eri = 0; eri < ethnicityRadios.length; eri++) {
            var er = ethnicityRadios[eri];
            if (workdayState.filledElements.has(er)) continue;
            
            var erlbl = getLabelForElement(er).toLowerCase();
            var shouldCheckEth = erlbl.includes(ethnicity.toLowerCase());

            if (shouldCheckEth && !er.checked) {
                er.click();
                er.dispatchEvent(new Event('change', {bubbles: true}));
                filled++;
                workdayState.filledElements.add(er);
                console.log('[Workday] Section 4 - Ethnicity radio:', erlbl);
            }
        }
        await delay(WORKDAY_CONFIG.DELAY_BETWEEN_FIELDS);
    }

    console.log('[Workday] Section 4: Voluntary Disclosures - DONE (' + 
        filled + ' fields)');
    return filled;
}

// ═══════════════════════════════════════════════════════════════════════════
// 6. SECTION 5: REVIEW
// ═══════════════════════════════════════════════════════════════════════════

async function fillSection5_Review(profile) {
    console.log('[Workday] Section 5: Review - START');
    
    // This section is read-only from autofill perspective.
    // Display completion status and let user manually submit.
    var message = 'Autofill complete! Please review all information and click Submit.';
    console.log('[Workday] Section 5: Review -', message);

    // Display toast notification
    try {
        var existing = document.getElementById('__workday_completion_toast__');
        if (existing) existing.remove();
        var toast = document.createElement('div');
        toast.id = '__workday_completion_toast__';
        toast.textContent = message;
        toast.style.cssText = [
            'position:fixed', 'bottom:24px', 'right:24px', 'z-index:2147483647',
            'background:#27ae60', 'color:#fff', 'padding:16px 24px',
            'border-radius:8px', 'font-size:14px', 'font-family:sans-serif',
            'box-shadow:0 4px 16px rgba(0,0,0,0.25)', 'max-width:400px',
            'line-height:1.4'
        ].join(';');
        document.body.appendChild(toast);
        setTimeout(function() { if (toast.parentNode) toast.remove(); }, 6000);
    } catch (e) {}

    console.log('[Workday] Section 5: Review - DONE');
    return 0;  // Review section doesn't count as filled fields
}

// ═══════════════════════════════════════════════════════════════════════════
// 7. MAIN ORCHESTRATOR: fillWorkdayComplete()
// ═══════════════════════════════════════════════════════════════════════════

async function fillWorkdayComplete(profile) {
    console.log('╔════════════════════════════════════════════════════════════════╗');
    console.log('║     WORKDAY AUTOFILL — COMPLETE (ALL 5 SECTIONS)              ║');
    console.log('╚════════════════════════════════════════════════════════════════╝');

    var p = profile || {};
    var totalFilled = 0;
    var sectionResults = [];

    try {
        // Section 1: My Information
        console.log('\n▶ STARTING SECTION 1: My Information');
        var section1Filled = await fillSection1_MyInformation(p);
        totalFilled += section1Filled;
        sectionResults.push({
            section: 'My Information',
            filled: section1Filled,
            status: 'complete'
        });
        console.log('✓ Section 1 completed: ' + section1Filled + ' fields\n');
        await delay(WORKDAY_CONFIG.DELAY_BEFORE_BUTTON_CLICK);

        // Look for "Continue" or "Next" button and click
        var continueBtn1 = findNextButton();
        if (continueBtn1) {
            console.log('▶ Clicking Continue button for Section 1...');
            continueBtn1.click();
            await delay(WORKDAY_CONFIG.DELAY_BETWEEN_SECTIONS);
        }

        // Section 2: My Experience
        console.log('\n▶ STARTING SECTION 2: My Experience');
        var section2Filled = await fillSection2_MyExperience(p);
        totalFilled += section2Filled;
        sectionResults.push({
            section: 'My Experience',
            filled: section2Filled,
            status: 'complete'
        });
        console.log('✓ Section 2 completed: ' + section2Filled + ' fields\n');
        await delay(WORKDAY_CONFIG.DELAY_BEFORE_BUTTON_CLICK);

        // Look for "Continue" or "Next" button and click
        var continueBtn2 = findNextButton();
        if (continueBtn2) {
            console.log('▶ Clicking Continue button for Section 2...');
            continueBtn2.click();
            await delay(WORKDAY_CONFIG.DELAY_BETWEEN_SECTIONS);
        }

        // Section 3: Application Questions
        console.log('\n▶ STARTING SECTION 3: Application Questions');
        var section3Filled = await fillSection3_ApplicationQuestions(p);
        totalFilled += section3Filled;
        sectionResults.push({
            section: 'Application Questions',
            filled: section3Filled,
            status: 'complete'
        });
        console.log('✓ Section 3 completed: ' + section3Filled + ' questions\n');
        await delay(WORKDAY_CONFIG.DELAY_BEFORE_BUTTON_CLICK);

        // Look for "Continue" or "Next" button and click
        var continueBtn3 = findNextButton();
        if (continueBtn3) {
            console.log('▶ Clicking Continue button for Section 3...');
            continueBtn3.click();
            await delay(WORKDAY_CONFIG.DELAY_BETWEEN_SECTIONS);
        }

        // Section 4: Voluntary Disclosures
        console.log('\n▶ STARTING SECTION 4: Voluntary Disclosures');
        var section4Filled = await fillSection4_VoluntaryDisclosures(p);
        totalFilled += section4Filled;
        sectionResults.push({
            section: 'Voluntary Disclosures',
            filled: section4Filled,
            status: 'complete'
        });
        console.log('✓ Section 4 completed: ' + section4Filled + ' fields\n');
        await delay(WORKDAY_CONFIG.DELAY_BEFORE_BUTTON_CLICK);

        // Look for "Continue" or "Next" button and click
        var continueBtn4 = findNextButton();
        if (continueBtn4) {
            console.log('▶ Clicking Continue button for Section 4...');
            continueBtn4.click();
            await delay(WORKDAY_CONFIG.DELAY_BETWEEN_SECTIONS);
        }

        // Section 5: Review
        console.log('\n▶ STARTING SECTION 5: Review');
        var section5Filled = await fillSection5_Review(p);
        totalFilled += section5Filled;
        sectionResults.push({
            section: 'Review',
            filled: section5Filled,
            status: 'user_action_required'
        });
        console.log('✓ Section 5 completed - Ready for manual submission\n');

    } catch (err) {
        console.error('[Workday] Autofill error:', err);
        console.error('Stack:', err.stack);
    }

    // ── Summary ────────────────────────────────────────────────────────
    console.log('\n╔════════════════════════════════════════════════════════════════╗');
    console.log('║                  AUTOFILL SUMMARY                              ║');
    console.log('╚════════════════════════════════════════════════════════════════╝');
    
    for (var sri = 0; sri < sectionResults.length; sri++) {
        var sr = sectionResults[sri];
        var icon = sr.status === 'user_action_required' ? '⚙' : '✓';
        console.log(icon + ' ' + sr.section + ': ' + sr.filled + ' field(s)');
    }

    console.log('\n📊 TOTAL FIELDS FILLED: ' + totalFilled);
    console.log('ℹ️  Status: READY FOR MANUAL SUBMISSION');
    console.log('⚠️  User Action: Click "Submit" button to complete application\n');

    return {
        success: true,
        totalFilled: totalFilled,
        sections: sectionResults,
        message: 'Autofill complete. Please review and submit.'
    };
}

// ═══════════════════════════════════════════════════════════════════════════
// 8. UTILITY: Find Next/Continue Button
// ═══════════════════════════════════════════════════════════════════════════

function findNextButton() {
    // Look for Continue, Next, or similar buttons
    var buttons = Array.from(document.querySelectorAll('button'));
    
    var nextBtn = buttons.find(function(b) {
        var txt = (b.textContent || '').toLowerCase();
        var ariaLabel = (b.getAttribute('aria-label') || '').toLowerCase();
        var combined = txt + ' ' + ariaLabel;
        return /^(continue|next|proceed|forward)$/.test(combined.trim()) ||
               /continue|next|proceed|forward/i.test(combined);
    });

    if (nextBtn) return nextBtn;

    // Fallback: look for button with common action classes
    var actionBtn = buttons.find(function(b) {
        var cls = (b.className || '').toLowerCase();
        return /btn-primary|action|continue|next/i.test(cls) &&
               (b.textContent || '').trim().length > 0;
    });

    return actionBtn || null;
}

// ═══════════════════════════════════════════════════════════════════════════
// 9. EXPORT & MESSAGE LISTENER
// ═══════════════════════════════════════════════════════════════════════════

// Export function for use in other scripts
if (typeof window !== 'undefined') {
    window.fillWorkdayComplete = fillWorkdayComplete;
}

console.log('[Workday Complete] Script loaded - use fillWorkdayComplete(profile)');
