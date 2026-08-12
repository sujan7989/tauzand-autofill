// autoFill-smartrecruiters.js - SmartRecruiters ONLY
// SPL Web Components with nested shadow DOM.
// All inputs live inside SPL-* custom elements.
// Key: document.execCommand('insertText') fills them correctly.

if (window.__smartRecruitersFillInitialized) {
    console.log('[SR] already initialized, skipping');
} else {
window.__smartRecruitersFillInitialized = true;

var srState = { filledElements: new Set(), isFilling: false };

// "" Recursively find input inside any nested shadow roots """""
function findInputDeep(root, depth) {
    if (!root || (depth || 0) > 7) return null;
    var inp = root.querySelector('input, textarea');
    if (inp) return inp;
    var found = null;
    Array.from(root.querySelectorAll('*')).filter(function(n) { return n.shadowRoot; }).forEach(function(h) {
        if (!found) found = findInputDeep(h.shadowRoot, (depth || 0) + 1);
    });
    return found;
}

// "" Find all visible [role="option"] in any nested shadow """"""
function findOptsDeep(root, depth) {
    if (!root || (depth || 0) > 8) return [];
    var opts = Array.from(root.querySelectorAll('[role="option"]')).filter(function(o) {
        var r = o.getBoundingClientRect(); return r.width > 0 && r.height > 0;
    });
    Array.from(root.querySelectorAll('*')).filter(function(n) { return n.shadowRoot; }).forEach(function(h) {
        opts = opts.concat(findOptsDeep(h.shadowRoot, (depth || 0) + 1));
    });
    return opts.filter(function(o, i, a) { return a.indexOf(o) === i; });
}

// "" Fill SPL-INPUT or SPL-TEXTAREA via execCommand """"""""""""
async function srFill(splId, value) {
    if (!value) return false;
    var splEl = document.querySelector('[id="' + splId + '"]');
    if (!splEl) { console.log('[SR] srFill: not found', splId); return false; }
    if (srState.filledElements.has(splEl)) return false;
    var rect = splEl.getBoundingClientRect();
    if (rect.width === 0) { console.log('[SR] srFill: not visible', splId); return false; }
    var shadow = splEl.shadowRoot;
    if (!shadow) return false;
    var inner = shadow.querySelector('input, textarea');
    if (!inner) return false;
    inner.click(); inner.focus();
    await window.delay(80);
    document.execCommand('selectAll', false);
    document.execCommand('delete', false);
    var ok = document.execCommand('insertText', false, value);
    if (!ok || inner.value !== value) {
        var desc = Object.getOwnPropertyDescriptor(inner.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype, 'value');
        try { if (desc && desc.set) desc.set.call(inner, value); else inner.value = value; } catch(e) { inner.value = value; }
        inner.dispatchEvent(new InputEvent('input', {bubbles:true}));
        inner.dispatchEvent(new Event('change', {bubbles:true}));
    }
    splEl.setAttribute('value', value);
    var filled = inner.value.length > 0;
    if (filled) { srState.filledElements.add(splEl); console.log('[SR] srFill "' + splId + '" =', value.substring(0, 40)); }
    return filled;
}

// "" Fill SPL-AUTOCOMPLETE """"""""""""""""""""""""""""""""""""""
// allowcustomvalues=true: setAttribute + type + Enter (Title, Company, Institution)
// allowcustomvalues=false: type + click first dropdown option (City, School location)
async function srFillAuto(splId, value) {
    if (!value) return false;
    var splEl = document.querySelector('[id="' + splId + '"]');
    if (!splEl) { console.log('[SR] srFillAuto: not found', splId); return false; }
    if (srState.filledElements.has(splEl)) return false;
    var rect = splEl.getBoundingClientRect();
    if (rect.width === 0) { console.log('[SR] srFillAuto: not visible', splId); return false; }

    var inner = findInputDeep(splEl.shadowRoot);
    if (!inner) { console.log('[SR] srFillAuto: no inner input', splId); return false; }

    inner.click(); inner.focus();
    await window.delay(80);
    document.execCommand('selectAll', false);
    document.execCommand('delete', false);
    // Type char by char
    for (var ci = 0; ci < value.length; ci++) {
        document.execCommand('insertText', false, value[ci]);
        inner.dispatchEvent(new InputEvent('input', {bubbles:true, inputType:'insertText', data:value[ci]}));
        await window.delay(20);
    }
    await window.delay(600);

    // For allowcustomvalues: press Enter to confirm
    if (splEl.hasAttribute('allowcustomvalues')) {
        var opts = findOptsDeep(document);
        if (opts.length > 0) { opts[0].click(); await window.delay(300); }
        else {
            inner.dispatchEvent(new KeyboardEvent('keydown', {key:'Enter', keyCode:13, bubbles:true}));
            inner.dispatchEvent(new KeyboardEvent('keyup',   {key:'Enter', keyCode:13, bubbles:true}));
            await window.delay(200);
        }
        splEl.setAttribute('value', value);
        srState.filledElements.add(splEl);
        console.log('[SR] srFillAuto custom "' + splId + '" =', value.substring(0, 40));
        return true;
    }

    // For search autocomplete: click first option
    var opts2 = findOptsDeep(document);
    console.log('[SR] srFillAuto search "' + splId + '" opts:', opts2.length);
    if (opts2.length > 0) {
        opts2[0].click();
        await window.delay(400);
        srState.filledElements.add(splEl);
        console.log('[SR] srFillAuto picked opt[0] for', splId);
        return true;
    }
    // No options - leave typed
    inner.dispatchEvent(new Event('change', {bubbles:true}));
    splEl.setAttribute('value', value);
    srState.filledElements.add(splEl);
    return true;
}

// "" Fill SPL-DATE-FIELD """"""""""""""""""""""""""""""""""""""""
// Format accepted: MM/YYYY (e.g. "09/2022")
async function srFillDate(splId, year, month) {
    if (!year) return false;
    var splEl = document.querySelector('spl-date-field[id="' + splId + '"]');
    if (!splEl) { console.log('[SR] srFillDate: not found', splId); return false; }
    var inp = findInputDeep(splEl.shadowRoot);
    if (!inp) { console.log('[SR] srFillDate: no input in', splId); return false; }
    var dateStr = (month || '01') + '/' + year;
    inp.click(); inp.focus();
    await window.delay(80);
    document.execCommand('selectAll', false);
    document.execCommand('delete', false);
    document.execCommand('insertText', false, dateStr);
    inp.dispatchEvent(new Event('input',  {bubbles:true}));
    inp.dispatchEvent(new Event('change', {bubbles:true}));
    inp.dispatchEvent(new KeyboardEvent('keydown', {key:'Enter', keyCode:13, bubbles:true}));
    await window.delay(300);
    console.log('[SR] srFillDate', splId, '=', dateStr, '| inner.value:', inp.value);
    return inp.value.length > 0;
}

// "" Fill SPL-PHONE-FIELD """""""""""""""""""""""""""""""""""""""
async function srFillPhone(phoneRaw) {
    var splPhone = document.querySelector('spl-phone-field');
    if (!splPhone || !splPhone.shadowRoot) return false;
    var splInput = splPhone.shadowRoot.querySelector('spl-input');
    if (!splInput || !splInput.shadowRoot) return false;
    var telInp = splInput.shadowRoot.querySelector('input');
    if (!telInp) return false;
    var phone = phoneRaw;
    if (phoneRaw && phoneRaw.startsWith('+')) {
        var d = phoneRaw.slice(1);
        if (d.length === 12) phone = d.slice(2);
        else if (d.length === 11) phone = d.slice(1);
        else if (d.length === 13) phone = d.slice(3);
        else phone = d.replace(/^\d{1,3}/, '') || d;
    }
    telInp.click(); telInp.focus();
    await window.delay(80);
    document.execCommand('selectAll', false);
    document.execCommand('delete', false);
    document.execCommand('insertText', false, phone);
    telInp.dispatchEvent(new Event('input',  {bubbles:true}));
    telInp.dispatchEvent(new Event('change', {bubbles:true}));
    console.log('[SR] Phone =', phone, '| inner.value:', telInp.value);
    return telInp.value.length > 0;
}

// "" Main autofill """""""""""""""""""""""""""""""""""""""""""""
async function fillSmartRecruiters(profile) {
    console.log('[SR] fillSmartRecruiters start');
    var p = profile || {};
    var filled = 0;

    var firstName = p.first_name  || (p.personal && p.personal.first_name)  || '';
    var lastName  = p.last_name   || (p.personal && p.personal.last_name)   || '';
    var email     = (p.contact && p.contact.email)   || p.email   || '';
    var phoneRaw  = (p.contact && p.contact.phone)   || p.phone   || '';
    var city      = ((p.contact && p.contact.city)   || p.city    || '').split(',')[0].trim();
    var linkedin  = (p.social && p.social.linkedin)  || p.linkedin || '';
    if (linkedin && !linkedin.startsWith('http')) linkedin = 'https://www.linkedin.com/in/' + linkedin;

    var experience = p.experience || [];
    var education  = (p.education  || []).slice().reverse(); // reverse: B.Tech first, then Inter, then 10th

    // "" Personal fields """"""""""""""""""""""""""""""""""""""""
    var personalMap = [
        ['first-name-input',    firstName],
        ['last-name-input',     lastName],
        ['email-input',         email],
        ['confirm-email-input', email],
        ['linkedin-input',      linkedin]
    ];
    for (var i = 0; i < personalMap.length; i++) {
        if (!personalMap[i][1]) continue;
        if (await srFill(personalMap[i][0], personalMap[i][1])) filled++;
        await window.delay(60);
    }

    // "" Phone """"""""""""""""""""""""""""""""""""""""""""""""""
    if (phoneRaw) { if (await srFillPhone(phoneRaw)) filled++; await window.delay(100); }

    // "" City (SPL-AUTOCOMPLETE search field) """""""""""""""""""
    if (city) {
        var cityEl = document.querySelector('spl-autocomplete[id="spl-form-element_10"]');
        if (cityEl) { if (await srFillAuto('spl-form-element_10', city)) filled++; }
        await window.delay(300);
    }

    // "" Experience entries """""""""""""""""""""""""""""""""""""
    for (var expIdx = 0; expIdx < experience.length; expIdx++) {
        var exp = experience[expIdx];
        var expTitle    = exp.title || exp.job_title || '';
        var expCompany  = exp.company || '';
        var expDesc     = exp.description || '';
        var expFromRaw  = String(exp.from || exp.start_year || exp.start_date || '');
        var expToRaw    = String(exp.to   || exp.end_year   || exp.end_date   || '');
        var expFromYear = expFromRaw.replace(/\D/g, '').slice(0, 4);
        var expFromMon  = expFromRaw.indexOf('/') > -1 ? expFromRaw.split('/')[0].padStart(2, '0') : '01';
        var expToYear   = expToRaw.replace(/\D/g, '').slice(0, 4);
        var expToMon    = expToRaw.indexOf('/') > -1 ? expToRaw.split('/')[0].padStart(2, '0') : '12';
        var expCurrent  = /present|current|now/i.test(expToRaw) || !expToRaw;

        console.log('[SR] Experience', expIdx + 1, ':', expTitle, '@', expCompany);

        // Click first SPL-BUTTON "Add"
        var addBtns = Array.from(document.querySelectorAll('spl-button')).filter(function(b) {
            return b.getBoundingClientRect().width > 0 && b.textContent.trim() === 'Add';
        });
        var expAddBtn = addBtns[0];
        if (!expAddBtn) { console.log('[SR] No Experience Add button'); break; }
        expAddBtn.click();
        await window.delay(1500);

        // Title (allowcustomvalues=true, label="Title")
        var titleEl = document.querySelector('spl-autocomplete[label="Title"]');
        if (expTitle && titleEl) {
            await srFillAuto(titleEl.id, expTitle);
            // Extra: dispatch blur to trigger SPL validation
            var titleInner = findInputDeep(titleEl.shadowRoot);
            if (titleInner) { titleInner.dispatchEvent(new Event('blur', {bubbles:true})); }
            await window.delay(200);
        }

        // Company (allowcustomvalues=true, label="Company")
        var compEl = document.querySelector('spl-autocomplete[label="Company"]');
        if (expCompany && compEl) { await srFillAuto(compEl.id, expCompany); await window.delay(200); }

        // Description
        var descEl = Array.from(document.querySelectorAll('spl-textarea[id^="exp-desc-"]')).pop();
        if (descEl && expDesc && !srState.filledElements.has(descEl)) {
            if (await srFill(descEl.id, expDesc)) filled++;
        }

        // From date
        if (expFromYear) {
            var expFromEl = Array.from(document.querySelectorAll('spl-date-field[id^="exp-from-"]')).pop();
            if (expFromEl) { if (await srFillDate(expFromEl.id, expFromYear, expFromMon)) filled++; }
        }

        // To date or "I currently work here"
        if (!expCurrent && expToYear) {
            var expToEl = Array.from(document.querySelectorAll('spl-date-field[id^="exp-to-"]')).pop();
            if (expToEl) { if (await srFillDate(expToEl.id, expToYear, expToMon)) filled++; }
        } else if (expCurrent) {
            // Find checkbox (may be in shadow DOM)
            var curCb = document.querySelector('input[type="checkbox"]');
            if (!curCb) {
                document.querySelectorAll('*').forEach(function(el) {
                    if (!curCb && el.shadowRoot) {
                        curCb = el.shadowRoot.querySelector('input[type="checkbox"]');
                    }
                });
            }
            if (curCb && !curCb.checked) { curCb.click(); curCb.dispatchEvent(new Event('change', {bubbles:true})); await window.delay(200); }
        }

        filled++;
        await window.delay(300);

        // Save every entry including last
        var saveBtns = Array.from(document.querySelectorAll('spl-button')).filter(function(b) {
            return b.getBoundingClientRect().width > 0 && b.textContent.trim() === 'Save';
        });
        if (saveBtns.length > 0) { saveBtns[0].click(); await window.delay(1500); console.log('[SR] Exp', expIdx + 1, 'saved'); }
    }
    await window.delay(500);

    // "" Education entries """"""""""""""""""""""""""""""""""""""
    var filledInstIds = [];
    var filledDegIds  = [];
    var filledMajIds  = [];

    for (var eduIdx = 0; eduIdx < education.length; eduIdx++) {
        var edu      = education[eduIdx];
        var school   = (edu.institution || edu.school || '').split(',')[0].trim();
        var degree   = edu.degree || '';
        var major    = edu.field_of_study || edu.field || '';
        var eduFromRaw  = String(edu.from || edu.start_year || edu.start_date || '');
        var eduToRaw    = String(edu.to   || edu.end_year   || edu.end_date   || '');
        var eduFromYear = eduFromRaw.replace(/\D/g, '').slice(0, 4);
        var eduToYear   = eduToRaw.replace(/\D/g, '').slice(0, 4);

        console.log('[SR] Education', eduIdx + 1, ':', school, degree);
        if (!school && !degree) continue;

        // Click second SPL-BUTTON "Add" (Education Add)
        var addBtns2 = Array.from(document.querySelectorAll('spl-button')).filter(function(b) {
            return b.getBoundingClientRect().width > 0 && b.textContent.trim() === 'Add';
        });
        var eduAddBtn = addBtns2[1] || addBtns2[0];
        if (!eduAddBtn) { console.log('[SR] No Education Add button'); break; }
        eduAddBtn.click();
        await window.delay(1500);

        // Institution: find the NEW unfilled one (not in filledInstIds)
        var allInstEls = Array.from(document.querySelectorAll('spl-autocomplete[label="Institution"]'));
        var instEl = allInstEls.find(function(el) { return filledInstIds.indexOf(el.id) === -1; });
        if (school && instEl) {
            var instInner = findInputDeep(instEl.shadowRoot);
            if (instInner) {
                instInner.click(); instInner.focus(); await window.delay(80);
                document.execCommand('selectAll', false); document.execCommand('delete', false);
                for (var ci = 0; ci < school.length; ci++) {
                    document.execCommand('insertText', false, school[ci]);
                    await window.delay(20);
                }
                await window.delay(600);
                var instOpts = findOptsDeep(document);
                if (instOpts.length > 0) { instOpts[0].click(); await window.delay(300); }
                else {
                    instInner.dispatchEvent(new KeyboardEvent('keydown', {key:'Enter', keyCode:13, bubbles:true}));
                    instInner.dispatchEvent(new KeyboardEvent('keyup',   {key:'Enter', keyCode:13, bubbles:true}));
                    instEl.setAttribute('value', school);
                    await window.delay(200);
                }
            } else { instEl.setAttribute('value', school); }
            filledInstIds.push(instEl.id); filled++;
            console.log('[SR] Institution:', instEl.id, '=', school);
        }

        // Degree and Major: find NEW unfilled ones
        var allDeg = Array.from(document.querySelectorAll('spl-input[id^="edu-degree-"]'));
        var allMaj = Array.from(document.querySelectorAll('spl-input[id^="edu-major-"]'));
        var degEl = allDeg.find(function(el) { return filledDegIds.indexOf(el.id) === -1; });
        var majEl = allMaj.find(function(el) { return filledMajIds.indexOf(el.id) === -1; });
        if (degEl && degree) { if (await srFill(degEl.id, degree)) { filled++; filledDegIds.push(degEl.id); } }
        if (majEl && major)  { if (await srFill(majEl.id, major))  { filled++; filledMajIds.push(majEl.id); } }

        // Dates: use UUID from degree/major ID to find matching date fields
        var uuid = degEl ? degEl.id.replace('edu-degree-', '') : (majEl ? majEl.id.replace('edu-major-', '') : '');
        if (uuid) {
            var eduFromEl = document.querySelector('spl-date-field[id="edu-from-' + uuid + '"]');
            var eduToEl   = document.querySelector('spl-date-field[id="edu-to-'   + uuid + '"]');
            if (eduFromEl && eduFromYear) { if (await srFillDate(eduFromEl.id, eduFromYear, '09')) filled++; }
            if (eduToEl   && eduToYear)   { if (await srFillDate(eduToEl.id,   eduToYear,   '05')) filled++; }
        }

        filled++;
        await window.delay(300);

        // Save every entry (including the last one)
        var saveBtns2 = Array.from(document.querySelectorAll('spl-button')).filter(function(b) {
            return b.getBoundingClientRect().width > 0 && b.textContent.trim() === 'Save';
        });
        if (saveBtns2.length > 0) { saveBtns2[0].click(); await window.delay(1500); console.log('[SR] Edu', eduIdx + 1, 'saved'); }
    }
    await window.delay(500);

    // "" Message to Hiring Team """""""""""""""""""""""""""""""""
    var msgEl = document.querySelector('spl-textarea[id="hiring-manager-message-input"]');
    if (msgEl && !srState.filledElements.has(msgEl)) {
        var msgAns = await window.getAIAnswer('Message to the Hiring Team - express your interest in working at this company', p);
        if (msgAns) { if (await srFill('hiring-manager-message-input', msgAns)) filled++; }
    }

    // "" Screening / Preliminary Questions """"""""""""""""""""""""
    // SmartRecruiters stores ALL question labels in the JSON `definition`
    // attribute on <sr-screening-questions-form>. Each spl-input has
    // id="question_<uuid>" matching the JSON. We parse the JSON to get
    // the label, generate an answer, then fill via srFill().
    await window.delay(300);

    var srForm = document.querySelector('sr-screening-questions-form');
    if (srForm) {
        console.log('[SR] Screening questions form found');

        // Build answer helper from profile
        var skills   = (p.skills || []).slice(0, 6).join(', ');
        var expYears = '0';
        if (experience.length > 0) {
            var yrs2 = 0;
            experience.forEach(function(ex2) {
                var f2 = parseInt(ex2.from || ex2.start_year || 0);
                var t2 = parseInt(ex2.to   || ex2.end_year   || new Date().getFullYear());
                if (f2 && t2 && t2 >= f2) yrs2 += (t2 - f2);
            });
            expYears = yrs2 > 0 ? String(yrs2) : '1';
        }

        function getScreeningAnswer(label, qtype) {
            var lc = (label || '').toLowerCase().trim();
            // Reason for job change
            if (/reason.*job.*change|why.*chang|why.*leav|why.*look/.test(lc))
                return 'I am seeking better growth opportunities and a challenging role that aligns with my skills in ' + (skills || 'software development') + '.';
            // Current salary
            if (/current.*salary|current.*ctc|current.*package|last.*drawn/.test(lc))
                return experience.length > 0 ? (p.current_salary || '0') : '0';
            // Salary expectation
            if (/salary.*expect|expect.*salary|expect.*ctc|desired.*salary/.test(lc))
                return p.expected_salary || '0';            // Willing to relocate
            if (/relocat/.test(lc))
                return 'Yes, I am willing to relocate.';
            // Telephonic/Web interview
            if (/telephon|web.*interview|phone.*interview/.test(lc))
                return 'Immediate / Any time as per your schedule';
            // F2F interview
            if (/f2f|face.*face/.test(lc))
                return 'Available as per your convenience';
            // Availability (generic)
            if (/availab/.test(lc))
                return 'Immediately available';
            // Relevant experience
            if (/relevant.*exp|experience.*role|years.*exp|total.*exp/.test(lc))
                return expYears + ' year(s)' + (skills ? ' working with ' + skills : '');
            // Notice period
            if (/notice.*period|serving.*notice/.test(lc))
                return 'Immediate';
            // Location
            if (/current.*location|where.*located/.test(lc))
                return city || 'Kurnool, Andhra Pradesh';
            // Language
            if (/language/.test(lc) && !/programming/.test(lc))
                return 'English, Telugu';
            // Skills
            if (/key.*skills|your.*skills|technical.*skills/.test(lc))
                return skills || 'Python, JavaScript, React, Node.js';
            // Generic fallback for currency type
            if (qtype === 'currency') return '0';
            return null;
        }

        // Parse the definition JSON to get question id → label mapping
        var defAttr = srForm.getAttribute('definition') || '';
        var questions = [];
        try {
            var def = JSON.parse(defAttr);
            questions = def.questions || [];
        } catch (e) {
            console.log('[SR] definition parse failed:', e.message);
        }

        // spl-input elements live inside sr-screening-questions-form's shadow DOM
        // document.querySelector won't find them — must search the shadow root
        function findSplById(id) {
            // Try main DOM first
            var el = document.querySelector('spl-input[id="' + id + '"], spl-number-field[id="' + id + '"]');
            if (el) return el;
            // Search in sr-screening-questions-form shadow root
            if (srForm.shadowRoot) {
                el = srForm.shadowRoot.querySelector('spl-input[id="' + id + '"], spl-number-field[id="' + id + '"]');
                if (el) return el;
            }
            // Deep search through all shadow roots on page
            var found = null;
            function searchShadow(root, depth) {
                if (!root || depth > 8 || found) return;
                var res = root.querySelectorAll('spl-input[id="' + id + '"], spl-number-field[id="' + id + '"]');
                if (res.length > 0) { found = res[0]; return; }
                Array.from(root.querySelectorAll('*')).forEach(function(n) {
                    if (n.shadowRoot) searchShadow(n.shadowRoot, depth + 1);
                });
            }
            searchShadow(document, 0);
            return found;
        }

        for (var qi = 0; qi < questions.length; qi++) {
            var q     = questions[qi];
            var qId   = 'question_' + q.id;
            var qLbl  = q.label || '';
            var qType = q.type  || 'text';

            // Find spl element — must search shadow DOM via findSplById
            var splEl = findSplById(qId);
            if (!splEl) { console.log('[SR] Screening: no spl element for', qId); continue; }
            if (srState.filledElements.has(splEl)) continue;

            var ans = getScreeningAnswer(qLbl, qType);
            if (!ans && (qType === 'text' || qType === 'textarea')) {
                try { ans = await window.getAIAnswer(qLbl, p); } catch (e) {}
            }
            if (!ans || ans === '') { console.log('[SR] Screening: no answer for "' + qLbl + '"'); continue; }

            // Fill spl-number-field or spl-input using the correct method:
            // These are LitElements — set .value property then call requestUpdate()
            // Angular listens to 'spl-change' CustomEvent for form binding updates

            if (splEl.tagName === 'SPL-NUMBER-FIELD') {
                // Set value on the LitElement property
                splEl.value = String(ans);
                if (splEl.requestUpdate) splEl.requestUpdate();
                // Dispatch spl-change so Angular zone picks it up
                splEl.dispatchEvent(new CustomEvent('spl-change', {
                    bubbles: true, composed: true, detail: { value: String(ans) }
                }));
                splEl.dispatchEvent(new Event('change', {bubbles:true, composed:true}));
                // Also set on inner spl-input
                var midSpl = splEl.shadowRoot ? splEl.shadowRoot.querySelector('spl-input') : null;
                if (midSpl) {
                    midSpl.value = String(ans);
                    if (midSpl.requestUpdate) midSpl.requestUpdate();
                    midSpl.dispatchEvent(new CustomEvent('spl-change', {
                        bubbles:true, composed:true, detail:{value:String(ans)}
                    }));
                    // Also fill the deepest native input via execCommand
                    var deepInner = findInputDeep(midSpl.shadowRoot);
                    if (deepInner) {
                        deepInner.focus();
                        document.execCommand('selectAll', false);
                        document.execCommand('insertText', false, String(ans));
                        deepInner.dispatchEvent(new InputEvent('input', {bubbles:true, inputType:'insertText', data:String(ans)}));
                        deepInner.dispatchEvent(new Event('change', {bubbles:true}));
                    }
                }
                await window.delay(150);
            } else {
                // spl-input: use execCommand on the inner native input
                var innerEl = findInputDeep(splEl.shadowRoot);
                if (!innerEl) { console.log('[SR] Screening: no inner input in', qId); continue; }
                innerEl.click();
                innerEl.focus();
                await window.delay(80);
                document.execCommand('selectAll', false);
                document.execCommand('delete', false);
                var execOk = document.execCommand('insertText', false, String(ans));
                if (!execOk || !innerEl.value) {
                    var pd2 = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
                    if (pd2 && pd2.set) pd2.set.call(innerEl, String(ans));
                    else innerEl.value = String(ans);
                }
                innerEl.dispatchEvent(new InputEvent('input', {bubbles:true, inputType:'insertText', data:String(ans)}));
                innerEl.dispatchEvent(new Event('change', {bubbles:true}));
                innerEl.dispatchEvent(new Event('blur',   {bubbles:true}));
                // Also set value on host and dispatch spl-change
                splEl.value = String(ans);
                if (splEl.requestUpdate) splEl.requestUpdate();
                splEl.dispatchEvent(new CustomEvent('spl-change', {
                    bubbles:true, composed:true, detail:{value:String(ans)}
                }));
                splEl.setAttribute('value', String(ans));
            }

            srState.filledElements.add(splEl);
            filled++;
            console.log('[SR] Screening "' + qLbl.substring(0,40) + '" = "' + String(ans).substring(0,40) + '"');
            await window.delay(120);
        }

        // Tick the consent/privacy checkbox (id="noPolicy", inside spl-checkbox)
        var noPolicyCb = document.querySelector('input#noPolicy');
        if (!noPolicyCb) {
            // It's inside spl-checkbox shadow DOM
            var splCb = document.querySelector('spl-checkbox#noPolicy');
            if (splCb && splCb.shadowRoot) noPolicyCb = splCb.shadowRoot.querySelector('input[type="checkbox"]');
        }
        if (noPolicyCb && !noPolicyCb.checked) {
            noPolicyCb.click();
            noPolicyCb.dispatchEvent(new Event('change', {bubbles:true}));
            filled++;
            console.log('[SR] Consent checkbox (noPolicy) ticked');
        }
    }

    console.log('[SR] done, filled:', filled);
    return filled;
}

// "" Message listener """"""""""""""""""""""""""""""""""""""""""
chrome.runtime.onMessage.addListener(function(message, sender, sendResponse) {
    if (!message || !message.type) return false;
    if (message.type === 'PERFORM_AUTO_FILL' || message.type === 'AUTOFILL_START' || message.type === 'AUTO_FILL_FORM') {
        if (srState.isFilling) { sendResponse({success:false, error:'Already filling'}); return false; }
        var profile = message.userProfile || message.profile || message.data || null;
        srState.isFilling = true;
        if (message.backendUrl) window.AUTOFILL_BACKEND_URL = message.backendUrl;
        function doFill(p) {
            try { window.showToast('SmartRecruiters AutoFill starting...', 'success'); } catch(e) {}
            fillSmartRecruiters(p)
                .then(function(n) {
                    srState.isFilling = false;
                    try { window.showToast('SmartRecruiters: ' + n + ' field(s) filled.', 'success'); } catch(e) {}
                    try { sendResponse({success:true, filled:n, result:{filledCount:n, skippedCount:0}}); } catch(e) {}
                })
                .catch(function(err) {
                    srState.isFilling = false;
                    console.error('[SR] Error:', err.message, err.stack);
                    try { sendResponse({success:false, error:err.message}); } catch(e) {}
                });
        }
        if (!profile) {
            chrome.storage.local.get(['userProfile'], function(r) {
                var sp = r && r.userProfile;
                if (!sp) { sendResponse({success:false, error:'No profile.'}); srState.isFilling = false; return; }
                doFill(sp);
            });
            return true;
        }
        doFill(profile);
        return true;
    }
    if (message.type === 'PING') { sendResponse({alive:true, platform:'smartrecruiters'}); return false; }
    if (message.type === 'DETECT_PLATFORM') { sendResponse({success:true, platform:'smartrecruiters'}); return false; }
    return false;
});

console.log('[SmartRecruiters] autoFill-smartrecruiters.js loaded');
} // end guard
