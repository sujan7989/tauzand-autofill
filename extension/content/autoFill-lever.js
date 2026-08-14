// autoFill-lever.js " Lever ONLY
// Loaded on *.lever.co and jobs.lever.co via manifest.json
// Depends on: shared.js

if (window.__leverFillInitialized) {
    console.log('[Lever] already initialized, skipping');
} else {
window.__leverFillInitialized = true;

var leverState = { filledElements: new Set(), isFilling: false };

async function fillLever(profile) {
    console.log('[AutoFill] fillLever start');
    var p = profile || {};
    var filled = 0;

    var firstName = p.first_name  || (p.personal && p.personal.first_name)  || '';
    var lastName  = p.last_name   || (p.personal && p.personal.last_name)   || '';
    var email     = (p.contact && p.contact.email) || p.email || '';
    var phone     = (p.contact && p.contact.phone) || p.phone || '';
    var city      = ((p.contact && p.contact.city) || p.city || '').split(',')[0].trim();
    var linkedin  = (p.social && p.social.linkedin)  || p.linkedin  || '';
    var portfolio = (p.social && p.social.portfolio) || p.portfolio || '';
    var github    = (p.social && p.social.github)    || p.github    || '';
    var twitter   = (p.social && p.social.twitter)   || p.twitter   || '';
    var company   = (p.experience && p.experience[0] && p.experience[0].company) || '';

    // Lever-specific name/selector map - confirmed field names from Lever's DOM
    var fullName = (firstName + (lastName ? ' ' + lastName : '')).trim();
    var leverMap = [
        {selector:'input[name="name"]',                                           value:fullName},
        {selector:'input[name="email"]',                                          value:email},
        {selector:'input[name="phone"]',                                          value:phone},
        {selector:'input[name="org"],input[name="company"]',                      value:company},
        // Location: Lever uses multiple possible field names
        {selector:'input[name="location"],input[name="resume[location]"],input[name="cards[location]"]', value:city},
        {selector:'input[name="urls[LinkedIn]"],input[placeholder*="LinkedIn" i]',value:linkedin},
        {selector:'input[name="urls[Twitter]"],input[placeholder*="Twitter" i]',  value:twitter},
        {selector:'input[name="urls[GitHub]"],input[placeholder*="GitHub" i]',    value:github},
        {selector:'input[name="urls[Portfolio]"],input[placeholder*="Portfolio" i],input[placeholder*="portfolio" i]', value:portfolio},
        {selector:'input[name="urls[Other]"]',                                    value:portfolio||github}
    ];
    for (var i = 0; i < leverMap.length; i++) {
        var lm = leverMap[i]; if (!lm.value) continue;
        // Try each comma-separated selector
        var selParts = lm.selector.split(',');
        var el = null;
        for (var sp = 0; sp < selParts.length; sp++) {
            try { el = document.querySelector(selParts[sp].trim()); } catch(e) {}
            if (el) break;
        }
        if (el && window.isFieldFillable(el) && !leverState.filledElements.has(el)) {
            if (window.fillField(el, lm.value)) { leverState.filledElements.add(el); filled++; console.log('[Lever] Filled:', selParts[0].trim()); }
        }
    }

    // Fallback label-based fill for any remaining unfilled inputs
    var allInps = Array.from(document.querySelectorAll('input[type="text"],input[type="email"],input[type="tel"],textarea'));
    for (var ai = 0; ai < allInps.length; ai++) {
        var inp = allInps[ai];
        if (!window.isFieldFillable(inp) || leverState.filledElements.has(inp)) continue;
        var lbl = window.getLabelForElement(inp).toLowerCase().replace(/[*]+/g,'').trim();
        var nm  = (inp.name || inp.id || inp.getAttribute('data-field') || '').toLowerCase();
        var combined = lbl + ' ' + nm;
        var val = '';
        if (/full.?name|your name/i.test(combined))            val = fullName;
        else if (/first.?name/i.test(combined))                val = firstName;
        else if (/last.?name/i.test(combined))                 val = lastName;
        else if (/\bemail\b/i.test(combined))                  val = email;
        else if (/\bphone\b|\bmobile\b|\btel\b/i.test(combined)) val = phone;
        else if (/current.?location|location|city/i.test(combined)) val = city;
        else if (/current.?company|company|employer|org/i.test(combined)) val = company;
        else if (/linkedin/i.test(combined))                   val = linkedin;
        if (val && window.fillField(inp, val)) { leverState.filledElements.add(inp); filled++; console.log('[Lever] Label-fill:', lbl||nm); }
    }

    // Handle <select> dropdowns (notice period, etc.)
    var allSelects = Array.from(document.querySelectorAll('select')).filter(function(s) {
        var r = s.getBoundingClientRect(); return r.width > 0 && r.height > 0 && !leverState.filledElements.has(s);
    });
    for (var si = 0; si < allSelects.length; si++) {
        var sel = allSelects[si];
        var selLbl = window.getLabelForElement(sel).toLowerCase();
        if (!selLbl) continue;
        var picked = null;
        if (/notice/i.test(selLbl)) {
            // Pick "Immediately available" or first real option
            picked = Array.from(sel.options).find(function(o) { return /immediately/i.test(o.text); })
                  || Array.from(sel.options).find(function(o) { return o.value && o.value !== '' && o.text !== 'Select'; });
        } else {
            // For any other dropdown, pick first non-empty option
            picked = Array.from(sel.options).find(function(o) { return o.value && o.value !== '' && !/select/i.test(o.text); });
        }
        if (picked) {
            sel.value = picked.value;
            sel.dispatchEvent(new Event('change', {bubbles:true}));
            leverState.filledElements.add(sel); filled++;
            console.log('[Lever] Select "' + selLbl.substring(0,40) + '" = "' + picked.text + '"');
        }
    }

    // Handle custom text questions (salary, etc.) and AI questions
    var customInputs = Array.from(document.querySelectorAll('input[type="text"],input[type="number"],textarea')).filter(function(el) {
        var r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && !leverState.filledElements.has(el);
    });
    for (var ci = 0; ci < customInputs.length; ci++) {
        var cInp = customInputs[ci];
        var cLbl = window.getLabelForElement(cInp);
        if (!cLbl) continue;
        var cLblLow = cLbl.toLowerCase();
        var cVal = '';
        var cLblLow = cLbl.toLowerCase();

        // ── Deterministic answers for factual/number fields (no AI needed) ──
        if (/current.*salary|current.*ctc|last.*drawn|current.*package/i.test(cLblLow)) {
            var exp2 = profile.experience || [];
            cVal = exp2.length > 0 ? (profile.current_salary || '0') : '0';
        } else if (/expected.*salary|expected.*ctc|desired.*salary|expected.*package/i.test(cLblLow)) {
            cVal = profile.expected_salary || profile.salary_expectation || '0';
        } else if (/notice.*period|serving.*notice/i.test(cLblLow)) {
            cVal = 'Immediate';
        } else if (/years.*experience|experience.*years|total.*exp|work.*exp/i.test(cLblLow)) {
            var expList = profile.experience || [];
            cVal = expList.length > 0 ? String(expList.length) : '0';
        } else if (/\bphone\b|\bmobile\b/i.test(cLblLow)) {
            cVal = (profile.contact && profile.contact.phone) || profile.phone || '';
        } else if (/\bcity\b|\blocation\b/i.test(cLblLow)) {
            cVal = ((profile.contact && profile.contact.city) || profile.city || '').split(',')[0].trim();
        } else if (/linkedin/i.test(cLblLow)) {
            cVal = (profile.social && profile.social.linkedin) || profile.linkedin || '';
        } else if (/github/i.test(cLblLow)) {
            cVal = (profile.social && profile.social.github) || profile.github || '';
        } else if (/portfolio|website/i.test(cLblLow)) {
            cVal = (profile.social && profile.social.portfolio) || profile.portfolio || '';
        } else if (/\bskills?\b/i.test(cLblLow)) {
            cVal = (profile.skills || []).slice(0, 8).join(', ');
        } else {
            // Use AI for open-ended questions only
            var aiAns2 = await window.getAIAnswer(cLbl, profile);
            if (aiAns2) cVal = aiAns2;
        }
        if (cVal && window.fillField(cInp, cVal)) {
            leverState.filledElements.add(cInp); filled++;
            console.log('[Lever] Custom "' + cLbl.substring(0,40) + '" = "' + cVal.substring(0,30) + '"');
        }
    }

    console.log('[AutoFill] fillLever done, filled:', filled);
    return filled;
}

chrome.runtime.onMessage.addListener(function(message,sender,sendResponse){
    if (!message||!message.type) return false;
    if (message.type==='PERFORM_AUTO_FILL'||message.type==='AUTOFILL_START'||message.type==='AUTO_FILL_FORM'){
        if (leverState.isFilling){sendResponse({success:false,error:'Already filling'});return false;}
        var profile=message.userProfile||message.profile||message.data||null;
        leverState.isFilling=true;
        if (message.backendUrl) window.AUTOFILL_BACKEND_URL=message.backendUrl;
        function doFill(p){
            window.showToast('Lever AutoFill starting...','success');
            fillLever(p).then(function(n){
                leverState.isFilling=false;
                window.showToast('Lever AutoFill: '+n+' field(s) filled.','success');
                try{sendResponse({success:true,filled:n,result:{filledCount:n,skippedCount:0}});}catch(e){}
            }).catch(function(err){leverState.isFilling=false;try{sendResponse({success:false,error:err.message});}catch(e){}});
        }
        if (!profile){chrome.storage.local.get(['userProfile'],function(r){var sp=r&&r.userProfile;if(!sp){sendResponse({success:false,error:'No profile.'});leverState.isFilling=false;return;}doFill(sp);});return true;}
        doFill(profile); return true;
    }
    if (message.type==='PING'){sendResponse({alive:true,platform:'lever'});return false;}
    if (message.type==='DETECT_PLATFORM'){sendResponse({success:true,platform:'lever'});return false;}
    return false;
});

console.log('[Lever] autoFill-lever.js loaded');
} // end guard
