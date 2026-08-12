"""
Complete rewrite of fillWorkday experience section using EXACT automation-ids from console:
- formField-jobTitle → input inside
- formField-companyName → input inside
- formField-location → input inside
- formField-startDate → dateSectionMonth-input + dateSectionYear-input INSIDE
- formField-endDate   → dateSectionMonth-input + dateSectionYear-input INSIDE
- formField-school → multiSelectContainer (list-selector, need promptIcon click)
- formField-degree → select[data-automation-id="formField-degree"] — but actually a <select> inside formField-degree
- formField-fieldOfStudy → multiSelectContainer (list-selector)
- formField-skills → multiSelectContainer (list-selector)
- formField-url → input inside for websites URL
- formField-linkedInAccount → already handled
"""
import subprocess

path = 'c:/Users/sujan/OneDrive/Desktop/intern/extension/content/autoFill.js'
with open(path, encoding='utf-8') as f:
    src = f.read()

# Find the experience section start and end
exp_i = src.find("section === 'experience'")
exp_j = src.find("section === 'questions'", exp_i)
assert exp_i != -1 and exp_j != -1

NEW_EXP_SECTION = r"""section === 'experience') {
        /**
         * My Experience — exact Workday automation-ids confirmed from console:
         * formField-jobTitle, formField-companyName, formField-location
         * formField-startDate > dateSectionMonth-input + dateSectionYear-input
         * formField-endDate   > dateSectionMonth-input + dateSectionYear-input
         * formField-school (multiSelectContainer list-selector)
         * formField-degree (native <select>)
         * formField-fieldOfStudy (multiSelectContainer list-selector)
         * formField-skills (multiSelectContainer list-selector)
         * formField-url (simple text URL)
         */

        // ── Helper: fill input inside a formField container ────────────────
        async function fillFormField(automationId, value) {
            var container = document.querySelector('[data-automation-id="' + automationId + '"]');
            if (!container || !value || !value.trim()) return false;
            var inp = container.querySelector('input[type="text"],input:not([type]),textarea');
            if (!inp || !isFieldFillable(inp) || fillState.filledElements.has(inp)) return false;
            await fillField(inp, value.trim(), 'text');
            inp.dispatchEvent(new Event('change', {bubbles:true}));
            fillState.filledElements.add(inp);
            filled++;
            console.log('[AutoFill] Workday formField:', automationId, '=', value.substring(0, 30));
            return true;
        }

        // ── Helper: fill Workday split date (month + year inputs) ──────────
        async function fillWorkdayDate(formFieldId, monthVal, yearVal) {
            var container = document.querySelector('[data-automation-id="' + formFieldId + '"]');
            if (!container) { console.log('[AutoFill] Workday date container not found:', formFieldId); return; }
            var monthInp = container.querySelector('[data-automation-id="dateSectionMonth-input"]');
            var yearInp  = container.querySelector('[data-automation-id="dateSectionYear-input"]');
            console.log('[AutoFill] Workday date', formFieldId, '| month:', !!monthInp, 'year:', !!yearInp);
            if (monthInp && isFieldFillable(monthInp) && !fillState.filledElements.has(monthInp)) {
                monthInp.focus();
                await fillField(monthInp, monthVal, 'text');
                monthInp.dispatchEvent(new Event('change', {bubbles:true}));
                monthInp.dispatchEvent(new Event('blur', {bubbles:true}));
                fillState.filledElements.add(monthInp); filled++;
                await delay(150);
            }
            if (yearInp && isFieldFillable(yearInp) && !fillState.filledElements.has(yearInp)) {
                yearInp.focus();
                await fillField(yearInp, yearVal, 'text');
                yearInp.dispatchEvent(new Event('change', {bubbles:true}));
                yearInp.dispatchEvent(new Event('blur', {bubbles:true}));
                fillState.filledElements.add(yearInp); filled++;
                await delay(150);
            }
        }

        // ── Helper: fill Workday multiSelectContainer (list-selector) ──────
        async function fillWorkdayMultiSelect(automationId, searchText) {
            if (!searchText || !searchText.trim()) return false;
            var container = document.querySelector('[data-automation-id="' + automationId + '"]');
            if (!container) { console.log('[AutoFill] Workday multiSelect not found:', automationId); return false; }
            // Click the promptIcon (≡ list icon) to open the picker
            var promptIcon = container.querySelector('[data-automation-id="promptIcon"]');
            var inp = container.querySelector('input');
            if (!promptIcon && !inp) { console.log('[AutoFill] Workday multiSelect no icon/input:', automationId); return false; }
            // Type into search input if available
            if (inp && isFieldFillable(inp)) {
                inp.focus(); await delay(200);
                var setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
                if (setter) setter.call(inp, searchText.trim()); else inp.value = searchText.trim();
                inp.dispatchEvent(new InputEvent('input', {bubbles:true, cancelable:true}));
                await delay(600);
            }
            // Click list icon to open
            if (promptIcon) { promptIcon.click(); await delay(500); }
            // Wait for options
            var opts = [];
            for (var t = 0; t < 8; t++) {
                await delay(300);
                opts = Array.from(document.querySelectorAll('[role="option"],[data-automation-id*="listItem"],[data-automation-id*="promptOption"]')).filter(function(o) {
                    try { var r = o.getBoundingClientRect(); return r.width > 0 && r.height > 0; } catch(e) { return false; }
                });
                if (opts.length > 0) break;
            }
            if (opts.length === 0) {
                console.log('[AutoFill] Workday multiSelect no options for:', automationId, searchText);
                // Close any open picker
                document.dispatchEvent(new KeyboardEvent('keydown', {key:'Escape', keyCode:27, bubbles:true}));
                await delay(200);
                return false;
            }
            // Pick best match or first
            var best = opts.find(function(o) { return o.textContent.trim().toLowerCase().includes(searchText.toLowerCase().substring(0,10)); }) || opts[0];
            best.click(); await delay(400);
            // Check/confirm by clicking OK/Done if modal shows
            var confirmBtn = document.querySelector('[data-automation-id="promptConfirm"],[data-automation-id="done"],[data-automation-id="selectButton"]') ||
                Array.from(document.querySelectorAll('button')).find(function(b) { return /^(ok|done|select|confirm)$/i.test(b.textContent.trim()); });
            if (confirmBtn) { confirmBtn.click(); await delay(400); }
            filled++;
            console.log('[AutoFill] Workday multiSelect selected:', automationId, '=', best.textContent.trim().substring(0, 40));
            return true;
        }

        // ════════════════════════════════════════════════════════════════════
        // WORK EXPERIENCE
        // ════════════════════════════════════════════════════════════════════
        var expList = experience.filter(function(e){ return e && e.title && e.title.trim(); });
        console.log('[AutoFill] Workday experience entries:', expList.length);

        if (expList.length > 0) {
            var exp = expList[0];
            var isPresent = /present|current/i.test(exp.to || '');
            var expMonth = '01'; // Workday expects just the month number
            var expFromYear  = exp.from ? String(exp.from).replace(/\D/g,'').substring(0,4) : '';
            var expToYear    = isPresent ? '' : (exp.to ? String(exp.to).replace(/\D/g,'').substring(0,4) : '');
            console.log('[AutoFill] Workday exp:', exp.title, '|', exp.company, '|', expFromYear, '-', expToYear || 'present');

            // Fill Job Title
            await fillFormField('formField-jobTitle', exp.title);
            await delay(100);
            // Fill Company
            await fillFormField('formField-companyName', exp.company || 'Freelance');
            await delay(100);
            // Fill Location
            await fillFormField('formField-location', city.split(',')[0].trim());
            await delay(100);

            // Fill Start Date (separate month + year inputs)
            if (expFromYear) {
                await fillWorkdayDate('formField-startDate', expMonth, expFromYear);
            }
            // Fill End Date
            if (expToYear) {
                await fillWorkdayDate('formField-endDate', expMonth, expToYear);
            }

            // "I currently work here" checkbox
            if (isPresent) {
                var currContainer = document.querySelector('[data-automation-id="formField-currentlyWorkHere"]');
                if (currContainer) {
                    var currCb = currContainer.querySelector('input[type="checkbox"]') || currContainer.querySelector('[role="checkbox"]');
                    if (currCb && !currCb.checked) { currCb.click(); filled++; await delay(300); }
                }
            }

            // Role Description
            if (exp.description || summary) {
                var roleContainer = document.querySelector('[data-automation-id="formField-roleDescription"]');
                if (roleContainer) {
                    var roleTA = roleContainer.querySelector('textarea,input');
                    if (roleTA && isFieldFillable(roleTA) && !fillState.filledElements.has(roleTA)) {
                        await fillField(roleTA, (exp.description || summary || '').substring(0, 500), roleTA.tagName.toLowerCase());
                        roleTA.dispatchEvent(new Event('change', {bubbles:true}));
                        fillState.filledElements.add(roleTA); filled++;
                    }
                }
            }
            await delay(300);
        }

        // ════════════════════════════════════════════════════════════════════
        // EDUCATION (one entry only — Workday pre-created 3 but we fill the first)
        // ════════════════════════════════════════════════════════════════════
        var eduList = education.filter(function(e){ return e && e.institution; });
        console.log('[AutoFill] Workday education entries:', eduList.length);

        if (eduList.length > 0) {
            var edu = eduList[0];
            var rawDeg = (edu.degree || '').toLowerCase();
            var degreeValue = rawDeg.includes('b.tech') || rawDeg.includes('bachelor') ? "Bachelor's"
                : rawDeg.includes('m.tech') || rawDeg.includes('master') ? "Master's"
                : rawDeg.includes('intermediate') || rawDeg.includes('12th') || rawDeg.includes('hsc') ? 'High School Diploma'
                : rawDeg.includes('10th') || rawDeg.includes('ssc') ? 'Secondary School'
                : "Bachelor's";
            var majM = (edu.degree || '').match(/in\s+(.+)/i);
            var major = majM ? majM[1].replace(/\([^)]+\)/,'').trim() : 'Computer Science';

            // School or University — multiSelectContainer (list-selector)
            // Find the FIRST formField-school container
            var schoolContainers = document.querySelectorAll('[data-automation-id="formField-school"]');
            if (schoolContainers.length > 0) {
                var firstSchool = schoolContainers[0];
                var schInp = firstSchool.querySelector('input');
                if (schInp && isFieldFillable(schInp)) {
                    var setter2 = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
                    schInp.focus(); await delay(200);
                    if (setter2) setter2.call(schInp, edu.institution); else schInp.value = edu.institution;
                    schInp.dispatchEvent(new InputEvent('input', {bubbles:true, cancelable:true}));
                    await delay(700);
                    var schOpts = Array.from(document.querySelectorAll('[role="option"],[data-automation-id*="listItem"]')).filter(function(o){
                        try { var r = o.getBoundingClientRect(); return r.width > 0 && r.height > 0; } catch(e) { return false; }
                    });
                    if (schOpts.length > 0) { schOpts[0].click(); await delay(400); filled++; }
                    else {
                        // Trigger promptIcon if no options
                        var pIcon = firstSchool.querySelector('[data-automation-id="promptIcon"]');
                        if (pIcon) { pIcon.click(); await delay(400); }
                    }
                }
            }

            // Degree — native <select> — find FIRST unfilled one
            var degSelects = Array.from(document.querySelectorAll('[data-automation-id="formField-degree"]')).map(function(c){
                return c.querySelector('select');
            }).filter(function(s){ return s && isFieldFillable(s) && !fillState.filledElements.has(s); });
            if (degSelects.length > 0) {
                fillSelectByLabel(degSelects[0], degreeValue) || fillSelect(degSelects[0], degreeValue);
                fillState.filledElements.add(degSelects[0]); filled++;
                await delay(200);
            }

            // Field of Study — multiSelectContainer — first unfilled
            var fosContainers = document.querySelectorAll('[data-automation-id="formField-fieldOfStudy"]');
            if (fosContainers.length > 0 && major) {
                var fosInp2 = fosContainers[0].querySelector('input');
                if (fosInp2 && isFieldFillable(fosInp2)) {
                    var setter3 = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
                    fosInp2.focus(); await delay(200);
                    if (setter3) setter3.call(fosInp2, major); else fosInp2.value = major;
                    fosInp2.dispatchEvent(new InputEvent('input', {bubbles:true, cancelable:true}));
                    await delay(600);
                    var fosOpts2 = Array.from(document.querySelectorAll('[role="option"],[data-automation-id*="listItem"]')).filter(function(o){
                        try { var r = o.getBoundingClientRect(); return r.width > 0 && r.height > 0; } catch(e) { return false; }
                    });
                    if (fosOpts2.length > 0) { fosOpts2[0].click(); filled++; await delay(300); }
                }
            }
            await delay(300);
        }

        // ════════════════════════════════════════════════════════════════════
        // SKILLS — formField-skills is a multiSelectContainer
        // ════════════════════════════════════════════════════════════════════
        if (skills) {
            var skillList2 = skills.split(',').map(function(s){return s.trim();}).filter(Boolean);
            var skillsContainer = document.querySelector('[data-automation-id="formField-skills"]');
            if (skillsContainer) {
                for (var ski = 0; ski < Math.min(skillList2.length, 5); ski++) {
                    var sk = skillList2[ski];
                    var skInp = skillsContainer.querySelector('input');
                    if (!skInp || !isFieldFillable(skInp)) break;
                    var setter4 = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
                    skInp.focus(); await delay(200);
                    if (setter4) setter4.call(skInp, sk); else skInp.value = sk;
                    skInp.dispatchEvent(new InputEvent('input', {bubbles:true, cancelable:true}));
                    await delay(700);
                    var skOpts = Array.from(document.querySelectorAll('[role="option"],[data-automation-id*="listItem"]')).filter(function(o){
                        try { var r = o.getBoundingClientRect(); return r.width > 0 && r.height > 0; } catch(e) { return false; }
                    });
                    if (skOpts.length > 0) {
                        // Pick best match or first
                        var skBest = skOpts.find(function(o){ return o.textContent.toLowerCase().includes(sk.toLowerCase().substring(0,5)); }) || skOpts[0];
                        skBest.click(); filled++; await delay(400);
                    } else {
                        // Trigger list icon
                        var skIcon = skillsContainer.querySelector('[data-automation-id="promptIcon"]');
                        if (skIcon) { skIcon.click(); await delay(300); }
                    }
                    await delay(200);
                }
            }
        }

        // ════════════════════════════════════════════════════════════════════
        // WEBSITES URL — formField-url
        // ════════════════════════════════════════════════════════════════════
        if (portfolio || linkedin) {
            var urlContainer = document.querySelector('[data-automation-id="formField-url"]');
            if (urlContainer) {
                var urlInp = urlContainer.querySelector('input');
                if (urlInp && isFieldFillable(urlInp) && !fillState.filledElements.has(urlInp)) {
                    await fillField(urlInp, portfolio || linkedin, 'text');
                    urlInp.dispatchEvent(new Event('change', {bubbles:true}));
                    fillState.filledElements.add(urlInp); filled++;
                    console.log('[AutoFill] Workday: websites URL =', (portfolio||linkedin).substring(0,40));
                }
            }
        }

        // Resume upload hint
        var resumeUpload = document.querySelector('input[type="file"]');
        if (resumeUpload) showToast('\uD83D\uDCCE Please attach your Resume/CV file manually', 'warning');

        await clickSaveAndContinue();
        return filled;
    }"""

# Replace the entire experience section
src = src[:exp_i] + NEW_EXP_SECTION + src[exp_j:]

with open(path, 'w', encoding='utf-8') as f:
    f.write(src)

r = subprocess.run(['node','-e',"try{new Function(require('fs').readFileSync('"+path+"','utf8'));process.stdout.write('OK')}catch(e){process.stdout.write('ERR:'+e.message)}"],capture_output=True,text=True)
print(f'Syntax: {r.stdout.strip()}')
print('Length:', len(src))
