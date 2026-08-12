// autoFill-ashby.js " Ashby ONLY
// Loaded on *.ashbyhq.com via manifest.json
// Depends on: shared.js

if (window.__ashbyFillInitialized) {
    console.log('[Ashby] already initialized, skipping');
} else {
window.__ashbyFillInitialized = true;

var ashbyState = { filledElements: new Set(), isFilling: false };

async function fillAshby(profile) {
    console.log('[AutoFill] fillAshby start');
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

    // Ashby uses aria-label attributes on inputs
    var fullName = (firstName + (lastName ? ' ' + lastName : '')).trim();
    var ariaMap = [
        {ariaLabel:'First Name',      value:firstName},
        {ariaLabel:'Last Name',       value:lastName},
        {ariaLabel:'Full Name',       value:fullName},
        {ariaLabel:'Name',            value:fullName},
        {ariaLabel:'Email',           value:email},
        {ariaLabel:'Phone',           value:phone},
        {ariaLabel:'Phone Number',    value:phone},
        {ariaLabel:'City',            value:city},
        {ariaLabel:'Location',        value:city},
        {ariaLabel:'LinkedIn Profile',value:linkedin},
        {ariaLabel:'LinkedIn URL',    value:linkedin},
        {ariaLabel:'LinkedIn',        value:linkedin},
        {ariaLabel:'Portfolio',       value:portfolio},
        {ariaLabel:'Website',         value:portfolio},
        {ariaLabel:'GitHub',          value:github},
        {ariaLabel:'GitHub Profile',  value:github}
    ];

    var allEls = Array.from(document.querySelectorAll('input, textarea'));
    for (var i = 0; i < allEls.length; i++) {
        var el = allEls[i];
        if (!window.isFieldFillable(el) || ashbyState.filledElements.has(el)) continue;
        var aria = (el.getAttribute('aria-label') || '').trim();
        var match = ariaMap.find(function(m) { return aria.toLowerCase() === m.ariaLabel.toLowerCase() || aria.toLowerCase().includes(m.ariaLabel.toLowerCase()); });
        if (match && match.value) {
            if (window.fillField(el, match.value)) { ashbyState.filledElements.add(el); filled++; console.log('[Ashby] aria-fill:', aria); }
        }
    }

    // Label-based fill: find inputs by their visible label text
    var allInputs = Array.from(document.querySelectorAll('input:not([type="hidden"]):not([type="file"]):not([type="checkbox"]):not([type="radio"]), textarea'));
    for (var j = 0; j < allInputs.length; j++) {
        var el2 = allInputs[j];
        if (!window.isFieldFillable(el2) || ashbyState.filledElements.has(el2)) continue;

        // Get label text from multiple sources
        var lbl = window.getLabelForElement(el2) || '';
        if (!lbl && el2.id) {
            // Try finding label by searching nearby DOM
            var parent = el2.parentElement;
            for (var d = 0; d < 4 && parent; d++) {
                var lblEl = parent.querySelector('label, [class*="label"], p, span');
                if (lblEl && lblEl.textContent.trim().length > 1 && !lblEl.contains(el2)) {
                    lbl = lblEl.textContent.trim(); break;
                }
                parent = parent.parentElement;
            }
        }
        var lblLow = lbl.toLowerCase().replace(/[*\s]+/g, ' ').trim();
        var val = '';

        if (!lblLow) continue;

        // Standard profile fields - match EXACTLY to avoid wrong fills
        if (/^name$|^full name$/i.test(lblLow))                           val = fullName;
        else if (/^first name$/i.test(lblLow))                            val = firstName;
        else if (/^last name$/i.test(lblLow))                             val = lastName;
        else if (/^email$|^email address$/i.test(lblLow))                 val = email;
        else if (/^phone$|^phone number$|^mobile/i.test(lblLow))         val = phone;
        else if (/^city$|^location$|^current location$|^current city$/i.test(lblLow)) val = city;
        else if (/^linkedin|linkedin profile|linkedin url/i.test(lblLow)) val = linkedin;
        else if (/^github|github profile/i.test(lblLow))                  val = github || portfolio;
        else if (/^portfolio|^website/i.test(lblLow))                    val = portfolio;

        if (val) {
            if (window.fillField(el2, val)) { ashbyState.filledElements.add(el2); filled++; console.log('[Ashby] label-fill "' + lblLow + '" =', val.substring(0,40)); }
        }
    }

    // Smart answers for ALL remaining custom questions
    var experience = p.experience || [];
    var totalExpYears = experience.length > 0 ? experience.length.toString() + ' year(s)' : '1 year';
    var remainingInputs = Array.from(document.querySelectorAll('input:not([type="hidden"]):not([type="file"]):not([type="checkbox"]):not([type="radio"]), textarea'));
    for (var ri = 0; ri < remainingInputs.length; ri++) {
        var rEl = remainingInputs[ri];
        if (ashbyState.filledElements.has(rEl)) continue; // skip already filled
        // Check visibility (but don't use isFieldFillable which might be too strict)
        var rRect = rEl.getBoundingClientRect();
        if (rRect.width === 0 || rRect.height === 0) continue;
        if (rEl.disabled) continue;

        // Get label from all possible sources
        var rLbl = window.getLabelForElement(rEl) || rEl.getAttribute('aria-label') || '';
        if (!rLbl || rLbl === 'Type here...') {
            // Ashby: label[for=id] is the most reliable - search entire document
            if (rEl.id) {
                var directLabel = document.querySelector('label[for="' + rEl.id + '"]');
                if (directLabel) rLbl = directLabel.textContent.replace(/\*/g, '').trim();
            }
        }
        if (!rLbl || rLbl === 'Type here...') {
            // Search parent DOM for label text
            var rParent = rEl.parentElement;
            for (var rd = 0; rd < 6 && rParent; rd++) {
                var labelEls = Array.from(rParent.querySelectorAll('label'));
                for (var li2 = 0; li2 < labelEls.length; li2++) {
                    var lElCandidate = labelEls[li2];
                    if (!lElCandidate.contains(rEl) && lElCandidate.getAttribute('for') === rEl.id) {
                        rLbl = lElCandidate.textContent.replace(/\*/g,'').trim();
                        break;
                    }
                }
                if (rLbl && rLbl !== 'Type here...') break;
                rParent = rParent.parentElement;
            }
        }
        console.log('[Ashby] checking custom field id=' + rEl.id + ' label="' + rLbl.substring(0,50) + '"');
        if (!rLbl) continue;
        var rLblLow = rLbl.toLowerCase();
        var rVal = '';

        // Smart defaults for common Ashby custom questions
        if      (/relocat/i.test(rLblLow))                                         rVal = 'Yes, I am willing to relocate.';
        else if (/when.*can.*join|can.*you.*join|join.*date|available.*start/i.test(rLblLow)) rVal = 'Immediately available';
        else if (/notice.*period/i.test(rLblLow))                                  rVal = 'Immediately available (0 days)';
        else if (/last.*working.*day|previous.*organisation|last.*day.*previous/i.test(rLblLow)) rVal = 'Currently available / Fresher';
        else if (/ctc|current.*salary|last.*drawn.*ctc|current.*ctc|last.*ctc/i.test(rLblLow)) rVal = '0 (Fresher)';
        else if (/total.*work.*experience|work.*experience.*similar|experience.*role|experience.*capacity/i.test(rLblLow)) rVal = totalExpYears;
        else if (/how.*know|how.*hear|come.*know|hear.*about|source.*referral|referral.*source/i.test(rLblLow)) rVal = 'LinkedIn';
        else if (/current.*location|what.*location|where.*located/i.test(rLblLow)) rVal = city;
        else if (/linkedin.*profile|your.*linkedin/i.test(rLblLow))               rVal = linkedin;
        else if (/github|behance|other.*link|link.*to.*work|portfolio.*link/i.test(rLblLow)) rVal = github || portfolio || linkedin;
        else {
            // Use AI for remaining open-ended questions
            var aiAns = await window.getAIAnswer(rLbl, p);
            if (aiAns) rVal = aiAns;
        }

        if (rVal) {
            // For textarea, use direct native setter as fallback
            var fillOk = window.fillField(rEl, rVal);
            if (!fillOk) {
                // Force fill textarea directly
                var nativeDesc = rEl.tagName === 'TEXTAREA'
                    ? Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')
                    : Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value');
                try {
                    if (nativeDesc && nativeDesc.set) nativeDesc.set.call(rEl, rVal);
                    else rEl.value = rVal;
                } catch(e) { rEl.value = rVal; }
                rEl.dispatchEvent(new Event('input',  {bubbles:true}));
                rEl.dispatchEvent(new Event('change', {bubbles:true}));
                fillOk = rEl.value.length > 0;
            }
            if (fillOk) {
                ashbyState.filledElements.add(rEl); filled++;
                console.log('[Ashby] custom "' + rLbl.substring(0,50) + '" = "' + rVal.substring(0,40) + '"');
            } else {
                console.warn('[Ashby] FAILED to fill "' + rLbl.substring(0,50) + '"');
            }
        }
    }

    console.log('[AutoFill] fillAshby done, filled:', filled);
    return filled;
}

chrome.runtime.onMessage.addListener(function(message,sender,sendResponse){
    if (!message||!message.type) return false;
    if (message.type==='PERFORM_AUTO_FILL'||message.type==='AUTOFILL_START'||message.type==='AUTO_FILL_FORM'){
        if (ashbyState.isFilling){sendResponse({success:false,error:'Already filling'});return false;}
        var profile=message.userProfile||message.profile||message.data||null;
        ashbyState.isFilling=true;
        if (message.backendUrl) window.AUTOFILL_BACKEND_URL=message.backendUrl;
        function doFill(p){
            window.showToast('Ashby AutoFill starting...','success');
            fillAshby(p).then(function(n){ashbyState.isFilling=false;window.showToast('Ashby AutoFill: '+n+' field(s) filled.','success');try{sendResponse({success:true,filled:n,result:{filledCount:n,skippedCount:0}});}catch(e){}}).catch(function(err){ashbyState.isFilling=false;try{sendResponse({success:false,error:err.message});}catch(e){}});
        }
        if (!profile){chrome.storage.local.get(['userProfile'],function(r){var sp=r&&r.userProfile;if(!sp){sendResponse({success:false,error:'No profile.'});ashbyState.isFilling=false;return;}doFill(sp);});return true;}
        doFill(profile); return true;
    }
    if (message.type==='PING'){sendResponse({alive:true,platform:'ashby'});return false;}
    if (message.type==='DETECT_PLATFORM'){sendResponse({success:true,platform:'ashby'});return false;}
    return false;
});

console.log('[Ashby] autoFill-ashby.js loaded');
} // end guard
