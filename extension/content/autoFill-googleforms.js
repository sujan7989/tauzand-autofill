// autoFill-googleforms.js - Google Forms ONLY
// Handles: text, email, textarea, radio, checkbox, dropdown, date fields
// Loaded on docs.google.com/forms/* via manifest.json

if (window.__googleFormsFillInitialized) {
    console.log('[GF] already initialized, skipping');
} else {
window.__googleFormsFillInitialized = true;

var gfState = { filledElements: new Set(), isFilling: false };

// "" Get question title text """""""""""""""""""""""""""""""""""
function gfGetTitle(container) {
    var el = container.querySelector(
        '.M7eMe, .z23kMc, .iHLJ6e, .freebirdFormviewerViewItemsItemItemTitle, [role="heading"]'
    );
    return el ? el.textContent.trim().replace(/\s+/g,' ') : '';
}

// "" Get all question containers """""""""""""""""""""""""""""""
function gfGetQuestions() {
    // Multiple possible container selectors across Google Form versions
    var containers = Array.from(document.querySelectorAll(
        '.freebirdFormviewerViewItemsItemItem,' +
        '.freebirdFormviewerViewNumberedItemContainer,' +
        '.Qr7Oae,' +
        '[data-item-id]'
    )).filter(function(el) {
        var r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
    });
    // Deduplicate - keep only leaf containers
    return containers.filter(function(c) {
        return !containers.some(function(other) { return other !== c && other.contains(c); });
    });
}

// "" Fill a text/email/textarea input """""""""""""""""""""""""
function gfFillText(inp, value) {
    if (!inp || !value) return false;
    inp.focus();
    // Use native setter for React-like inputs
    var desc = Object.getOwnPropertyDescriptor(
        inp.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype,
        'value'
    );
    try { if (desc && desc.set) desc.set.call(inp, value); else inp.value = value; } catch(e) { inp.value = value; }
    inp.dispatchEvent(new Event('input',  {bubbles:true}));
    inp.dispatchEvent(new Event('change', {bubbles:true}));
    inp.dispatchEvent(new Event('blur',   {bubbles:true}));
    return true;
}

// "" Click a radio option by partial text match """""""""""""""""
function gfClickRadio(container, value) {
    if (!value) return false;
    var lc = value.toLowerCase();
    // Google Forms radio: .docssharedWizToggleLabeledControl or .appsMaterialWizToggleRadiogroupElContainer
    var options = Array.from(container.querySelectorAll(
        '.docssharedWizToggleLabeledControl, .appsMaterialWizToggleRadiogroupElContainer, [role="radio"]'
    )).filter(function(o) { return o.getBoundingClientRect().width > 0; });

    if (options.length === 0) return false;

    var target = options.find(function(o) { return o.textContent.trim().toLowerCase() === lc; })
              || options.find(function(o) { return o.textContent.trim().toLowerCase().startsWith(lc); })
              || options.find(function(o) { return o.textContent.trim().toLowerCase().includes(lc); })
              || (lc === 'yes' ? options[0] : null)
              || (lc === 'no'  ? options[options.length - 1] : null);

    if (target) {
        target.click();
        console.log('[GF] Radio clicked:', target.textContent.trim().substring(0, 30));
        return true;
    }
    return false;
}

// "" Click a checkbox option by partial text match """""""""""""
function gfClickCheckbox(container, value) {
    if (!value) return false;
    var lc = value.toLowerCase();
    var options = Array.from(container.querySelectorAll(
        '.docssharedWizToggleLabeledControl, [role="checkbox"]'
    )).filter(function(o) { return o.getBoundingClientRect().width > 0; });

    var target = options.find(function(o) { return o.textContent.trim().toLowerCase().includes(lc); });
    if (target) { target.click(); return true; }
    return false;
}

// "" Select a dropdown option """"""""""""""""""""""""""""""""""
async function gfSelectDropdown(container, value) {
    if (!value) return false;
    var lc = value.toLowerCase();

    // Click to open dropdown
    var selector = container.querySelector('[role="listbox"],[aria-haspopup],[class*="select"]');
    if (selector) {
        selector.click();
        await window.delay(400);
    }

    // Find and click matching option
    var opts = Array.from(document.querySelectorAll(
        '[role="option"], .quantumWizMenuPaperselectOption, .exportSelectPopup li'
    )).filter(function(o) { return o.getBoundingClientRect().width > 0; });

    var target = opts.find(function(o) { return o.textContent.trim().toLowerCase() === lc; })
              || opts.find(function(o) { return o.textContent.trim().toLowerCase().includes(lc); });

    if (target) {
        target.click();
        return true;
    }
    // Close if no match
    document.body.click();
    return false;
}

// "" Determine the answer for a question """""""""""""""""""""""
async function gfGetAnswer(qText, qType, options, profile) {
    var p = profile || {};
    var firstName  = p.first_name  || (p.personal && p.personal.first_name)  || '';
    var lastName   = p.last_name   || (p.personal && p.personal.last_name)   || '';
    var email      = (p.contact && p.contact.email)   || p.email   || '';
    var phone      = (p.contact && p.contact.phone)   || p.phone   || '';
    var city       = ((p.contact && p.contact.city)   || p.city    || '').split(',')[0].trim();
    var linkedin   = (p.social && p.social.linkedin)  || p.linkedin  || '';
    var github     = (p.social && p.social.github)    || p.github    || '';
    var fullName   = (firstName + ' ' + lastName).trim();
    var experience = p.experience || [];
    var education  = p.education  || [];
    var qLow = qText.toLowerCase();

    // "" Profile-based factual answers """"""""""""""""""""""""
    if (/^(full\s*)?name\s*\*?$|^(your\s*)?name$/i.test(qText.trim()))         return fullName;
    if (/first.?name/i.test(qLow))                                               return firstName;
    if (/last.?name|surname|family.?name/i.test(qLow))                          return lastName;
    if (/\bemail\b/i.test(qLow))                                                 return email;
    if (/\bphone\b|\bmobile\b|\bcontact.*number/i.test(qLow))                   return phone;
    if (/\bcity\b|current.*location|^location$/i.test(qLow))                    return city;
    if (/linkedin/i.test(qLow))                                                  return linkedin;
    if (/github|portfolio/i.test(qLow))                                          return github || linkedin;

    // DOB - use a placeholder (not in resume typically)
    if (/date.*birth|dob|born/i.test(qLow))                                     return '';

    // Education fields
    if (/\bcollege\b|\buniversity\b|\binstitution\b/i.test(qLow)) {
        return education.length > 0 ? ((education[0].institution || education[0].school || '').split(',')[0].trim()) : '';
    }
    if (/degree|qualification|highest.*edu/i.test(qLow)) {
        return education.length > 0 ? (education[0].degree || '') : '';
    }
    if (/branch|major|specializ|field.*study/i.test(qLow)) {
        return education.length > 0 ? (education[0].field_of_study || education[0].field || '') : '';
    }
    if (/year.*pass|passout|graduation.*year/i.test(qLow)) {
        return education.length > 0 ? String(education[0].to || education[0].end_year || '') : '';
    }
    if (/percentage|cgpa|gpa|marks/i.test(qLow)) {
        return education.length > 0 ? (education[0].gpa || '') : '';
    }

    // Experience fields
    if (/current.*company|current.*employer|organization/i.test(qLow)) {
        return experience.length > 0 ? (experience[0].company || 'Fresher') : 'Fresher';
    }
    if (/current.*designation|current.*role|job.*title/i.test(qLow)) {
        return experience.length > 0 ? (experience[0].title || experience[0].job_title || 'Fresher') : 'Fresher';
    }
    if (/years.*experience|total.*experience|experience.*years/i.test(qLow)) {
        return experience.length > 0 ? experience.length + ' year(s)' : 'Fresher (0 years)';
    }

    // Radio/Checkbox special handling - for Yes/No questions match to options
    if (qType === 'radio' || qType === 'checkbox') {
        // For Yes/No questions - try to determine correct answer using AI
        var aiAns = await window.getAIAnswer(qText, profile);
        if (aiAns) {
            // Match AI answer to available option
            var aiLow = aiAns.toLowerCase();
            if (options && options.length > 0) {
                var matched = options.find(function(o) { return o.toLowerCase().includes(aiLow.substring(0,5)); })
                           || options.find(function(o) { return aiLow.includes(o.toLowerCase().substring(0,5)); });
                if (matched) return matched;
            }
            // Return first word of AI answer (yes/no)
            return aiAns.split(' ')[0];
        }
        return '';
    }

    // All other questions: use AI
    var aiAnswer = await window.getAIAnswer(qText, profile);
    return aiAnswer || '';
}

// "" Main fill function """"""""""""""""""""""""""""""""""""""""
async function fillGoogleForms(profile) {
    console.log('[GF] fillGoogleForms start');
    var filled = 0;

    var questions = gfGetQuestions();
    console.log('[GF] Found', questions.length, 'questions');

    for (var qi = 0; qi < questions.length; qi++) {
        var qc = questions[qi];
        var qText = gfGetTitle(qc);
        if (!qText) continue;

        console.log('[GF] Q' + (qi+1) + ': "' + qText.substring(0, 60) + '"');

        // Determine question type
        var textInp  = qc.querySelector('input[type="text"], input[type="email"], input[type="tel"]');
        var textarea = qc.querySelector('textarea');
        var dateInp  = qc.querySelector('input[type="date"], [type="date"]');
        var radios   = qc.querySelectorAll('.docssharedWizToggleLabeledControl[role="radio"], [role="radio"], .appsMaterialWizToggleRadiogroupElContainer');
        var checks   = qc.querySelectorAll('[role="checkbox"], .docssharedWizToggleLabeledControl');
        var dropdown = qc.querySelector('[role="listbox"], [aria-haspopup="listbox"]');

        // Get option texts for radio/checkbox
        var optionTexts = [];
        if (radios.length > 0) {
            optionTexts = Array.from(radios).map(function(r) { return r.textContent.trim(); }).filter(Boolean);
        }

        var qType = 'text';
        if (radios.length > 1)  qType = 'radio';
        else if (dropdown)      qType = 'dropdown';
        else if (textarea)      qType = 'textarea';
        else if (dateInp)       qType = 'date';

        // Check if already filled
        if (textInp && gfState.filledElements.has(textInp)) continue;
        if (textarea && gfState.filledElements.has(textarea)) continue;

        var answer = await gfGetAnswer(qText, qType, optionTexts, profile);
        if (!answer) { console.log('[GF] Q' + (qi+1) + ': no answer'); continue; }

        var ok = false;
        if (qType === 'radio') {
            ok = gfClickRadio(qc, answer);
        } else if (qType === 'dropdown') {
            ok = await gfSelectDropdown(qc, answer);
        } else if (qType === 'textarea' && textarea) {
            ok = gfFillText(textarea, answer);
            if (ok) gfState.filledElements.add(textarea);
        } else if (textInp) {
            ok = gfFillText(textInp, answer);
            if (ok) gfState.filledElements.add(textInp);
        } else if (dateInp && answer) {
            gfFillText(dateInp, answer);
            ok = true;
        }

        if (ok) {
            filled++;
            console.log('[GF] Q' + (qi+1) + ' filled: "' + answer.substring(0, 40) + '"');
        }
        await window.delay(100);
    }

    console.log('[GF] fillGoogleForms done, filled:', filled);
    return filled;
}

// "" Message listener """"""""""""""""""""""""""""""""""""""""""
chrome.runtime.onMessage.addListener(function(message, sender, sendResponse) {
    if (!message || !message.type) return false;
    if (message.type === 'PERFORM_AUTO_FILL' || message.type === 'AUTOFILL_START' || message.type === 'AUTO_FILL_FORM') {
        if (gfState.isFilling) { sendResponse({success:false, error:'Already filling'}); return false; }
        var profile = message.userProfile || message.profile || message.data || null;
        gfState.isFilling = true;
        if (message.backendUrl) window.AUTOFILL_BACKEND_URL = message.backendUrl;
        function doFill(p) {
            try { window.showToast('Google Forms AutoFill starting...', 'success'); } catch(e) {}
            fillGoogleForms(p)
                .then(function(n) {
                    gfState.isFilling = false;
                    try { window.showToast('Google Forms: ' + n + ' field(s) filled.', 'success'); } catch(e) {}
                    try { sendResponse({success:true, filled:n, result:{filledCount:n, skippedCount:0}}); } catch(e) {}
                })
                .catch(function(err) {
                    gfState.isFilling = false;
                    console.error('[GF] Error:', err);
                    try { sendResponse({success:false, error:err.message}); } catch(e) {}
                });
        }
        if (!profile) {
            chrome.storage.local.get(['userProfile'], function(r) {
                var sp = r && r.userProfile;
                if (!sp) { sendResponse({success:false, error:'No profile.'}); gfState.isFilling = false; return; }
                doFill(sp);
            });
            return true;
        }
        doFill(profile);
        return true;
    }
    if (message.type === 'PING') { sendResponse({alive:true, platform:'googleforms'}); return false; }
    if (message.type === 'DETECT_PLATFORM') { sendResponse({success:true, platform:'googleforms'}); return false; }
    return false;
});

console.log('[GoogleForms] autoFill-googleforms.js loaded');
} // end guard
