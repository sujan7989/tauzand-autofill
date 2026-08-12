// autoFill-greenhouse.js " Greenhouse ONLY
// Loaded exclusively on boards.greenhouse.io and *.greenhouse.io via manifest.json
// Depends on: shared.js (loaded before this file)

if (window.__greenhouseFillInitialized) {
    console.log('[Greenhouse] already initialized, skipping');
} else {
window.__greenhouseFillInitialized = true;

var ghState = { filledElements: new Set(), isFilling: false };

// "" Open a React Select container and pick a value """"""""""""
async function ghOpenSelect(cont, desiredValue) {
    var control = cont.querySelector('[class*="select__control"]');
    var inp = cont.querySelector('input.select__input[role="combobox"]')
           || cont.querySelector('input[role="combobox"]')
           || cont.querySelector('input.select__input');
    if (!control || !inp) return false;

    var rect = control.getBoundingClientRect();
    control.dispatchEvent(new MouseEvent('mousedown',{bubbles:true,cancelable:true,view:window,clientX:rect.left+10,clientY:rect.top+10}));
    control.dispatchEvent(new MouseEvent('mouseup',  {bubbles:true,cancelable:true,view:window,clientX:rect.left+10,clientY:rect.top+10}));
    control.dispatchEvent(new MouseEvent('click',    {bubbles:true,cancelable:true,view:window,clientX:rect.left+10,clientY:rect.top+10}));
    await window.delay(400);

    var optsNow = Array.from(document.querySelectorAll('[class*="select__option"]')).filter(function(o){
        var r=o.getBoundingClientRect(); return r.width>0&&r.height>0;
    });

    // Type to filter when many options (e.g. country list ~244)
    if (optsNow.length > 10) {
        var ns = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        inp.focus();
        var cur = '';
        for (var i = 0; i < desiredValue.length; i++) {
            var ch = desiredValue[i], kc = ch.charCodeAt(0);
            cur += ch;
            inp.dispatchEvent(new KeyboardEvent('keydown',{key:ch,keyCode:kc,which:kc,bubbles:true}));
            if (ns) ns.call(inp, cur); else inp.value = cur;
            inp.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText',data:ch}));
            inp.dispatchEvent(new KeyboardEvent('keyup',{key:ch,keyCode:kc,which:kc,bubbles:true}));
        }
        await window.delay(800);
    }

    var opts = Array.from(document.querySelectorAll('[class*="select__option"]')).filter(function(o){
        var r=o.getBoundingClientRect(); return r.width>0&&r.height>0;
    });
    if (opts.length === 0) { document.body.click(); return false; }

    var lc = desiredValue.toLowerCase();
    var target = opts.find(function(o){ return o.textContent.trim().toLowerCase() === lc; })
              || opts.find(function(o){ return o.textContent.trim().toLowerCase().startsWith(lc+' ')||o.textContent.trim().toLowerCase().startsWith(lc+'+'); })
              || opts.find(function(o){ return o.textContent.trim().toLowerCase().includes(lc); });
    if (!target) { document.body.click(); return false; }
    target.click();
    console.log('[GH] Select picked:', target.textContent.trim());
    await window.delay(200);
    return true;
}

async function fillGreenhouse(profile) {
    console.log('[AutoFill] fillGreenhouse start');
    var p = profile || {};
    var filled = 0;

    var firstName  = p.first_name  || (p.personal && p.personal.first_name)  || '';
    var lastName   = p.last_name   || (p.personal && p.personal.last_name)   || '';
    var email      = (p.contact && p.contact.email)   || p.email   || '';
    var phoneRaw   = (p.contact && p.contact.phone)   || p.phone   || '';
    var city       = ((p.contact && p.contact.city)   || p.city    || '').split(',')[0].trim();
    var country    = (p.contact && p.contact.country) || p.country || 'India';
    var linkedin   = (p.social && p.social.linkedin)  || p.linkedin  || '';
    var portfolio  = (p.social && p.social.portfolio) || p.portfolio || '';
    var github     = (p.social && p.social.github)    || p.github    || '';
    var relocation = (p.professional && p.professional.willing_to_relocate) || 'Yes';
    var workAuth   = (p.professional && p.professional.work_authorization)  || 'Yes';

    // Strip country code from phone
    var phone = phoneRaw;
    if (phoneRaw.startsWith('+')) {
        var d = phoneRaw.slice(1);
        if (d.length === 12) phone = d.slice(2);
        else if (d.length === 11) phone = d.slice(1);
        else if (d.length === 13) phone = d.slice(3);
        else phone = d.replace(/^\d{1,3}/,'') || d;
    }
    if (linkedin && !linkedin.startsWith('http'))
        linkedin = 'https://www.linkedin.com/in/' + linkedin.replace(/.*linkedin\.com\/in\//i,'');

    // "" 1. Text inputs by confirmed IDs """"""""""""""""""""""""""
    var idMap = [
        {id:'first_name',   v:firstName}, {id:'last_name',v:lastName},
        {id:'preferred_name',v:firstName},{id:'email',    v:email},
        {id:'phone',         v:phone}
    ];
    for (var i=0;i<idMap.length;i++) {
        if (!idMap[i].v) continue;
        var el = document.getElementById(idMap[i].id);
        if (el && window.isFieldFillable(el) && !ghState.filledElements.has(el)) {
            if (window.fillField(el, idMap[i].v)) { ghState.filledElements.add(el); filled++; console.log('[GH] id:', idMap[i].id); }
        }
    }

    // LinkedIn " id=question_67865611 or label match
    var liEl = document.getElementById('question_67865611')
            || Array.from(document.querySelectorAll('input[type="text"]')).find(function(e){
                   return /linkedin/i.test(window.getLabelForElement(e));
               });
    if (liEl && window.isFieldFillable(liEl) && !ghState.filledElements.has(liEl) && linkedin) {
        if (window.fillField(liEl, linkedin)) { ghState.filledElements.add(liEl); filled++; console.log('[GH] LinkedIn filled'); }
    }

    // How did you hear " id=question_67865613 or label match
    var hdyhEl = document.getElementById('question_67865613')
              || Array.from(document.querySelectorAll('input[type="text"]')).find(function(e){
                     return /how did you.*hear|initially.*hear/i.test(window.getLabelForElement(e));
                 });
    if (hdyhEl && window.isFieldFillable(hdyhEl) && !ghState.filledElements.has(hdyhEl)) {
        if (window.fillField(hdyhEl, 'LinkedIn')) { ghState.filledElements.add(hdyhEl); filled++; }
    }

    // "" 2. Fallback label-based fill """""""""""""""""""""""""""""
    var allInps = Array.from(document.querySelectorAll(
        'input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="file"]):not([type="checkbox"]):not([type="radio"]), textarea'
    ));
    var lblMap = [
        {pat:/first\s*name/i,v:firstName},{pat:/last\s*name/i,v:lastName},
        {pat:/preferred.*name/i,v:firstName},{pat:/email/i,v:email},{pat:/phone/i,v:phone},
        {pat:/location|city/i,v:city},{pat:/linkedin/i,v:linkedin},
        {pat:/website|portfolio/i,v:portfolio||linkedin},{pat:/github/i,v:github}
    ];
    for (var ii=0;ii<allInps.length;ii++) {
        var inp=allInps[ii];
        if (!window.isFieldFillable(inp)||ghState.filledElements.has(inp)) continue;
        var lbl=window.getLabelForElement(inp).toLowerCase().replace(/[*]+/g,'').trim();
        for (var fi=0;fi<lblMap.length;fi++) {
            if (!lblMap[fi].v) continue;
            if (lblMap[fi].pat.test(lbl)) {
                if (window.fillField(inp, lblMap[fi].v)) { ghState.filledElements.add(inp); filled++; }
                break;
            }
        }
    }

    // "" 3. React Select dropdowns """""""""""""""""""""""""""""""""
    var selectMap = [
        {pat:/^country/i,         id:'country',            val:country},
        {pat:/non.?compete|confidentiality/i, val:'No'},
        {pat:/point of data transfer/i, val:'I am not currently based in the UK, EU/EEA, Australia, or Singapore'},
        {pat:/^gender$/i,         id:'gender',             val:'Decline To Self Identify'},
        {pat:/hispanic|latino/i,  id:'hispanic_ethnicity', val:'No'},
        {pat:/veteran/i,          id:'veteran_status',     val:'I am not a protected veteran'},
        {pat:/disability/i,       id:'disability_status',  val:'No, I do not have a disability and have not had one in the past'}
    ];
    var conts = Array.from(document.querySelectorAll('div.select__container,[class*="select__container"]'));
    for (var sci=0;sci<conts.length;sci++) {
        var cont=conts[sci]; if (ghState.filledElements.has(cont)) continue;
        var contLbl='', contId='';
        var cp=cont.parentElement, depth=0;
        while (cp&&cp!==document.body&&!contLbl&&depth<8) {
            var lE=cp.querySelector('label'); if(lE){contLbl=lE.textContent.trim();break;}
            cp=cp.parentElement; depth++;
        }
        var cInp=cont.querySelector('input'); if(cInp) contId=cInp.id||'';
        if (!contLbl&&!contId) continue;
        var mapping=selectMap.find(function(m){ return (m.id&&m.id===contId)||m.pat.test(contLbl); });
        if (!mapping) continue;
        var ok=await ghOpenSelect(cont, mapping.val);
        if (ok) { ghState.filledElements.add(cont); filled++; }
        await window.delay(300);
    }

    // "" 4. Checkboxes """""""""""""""""""""""""""""""""""""""""""""
    var cbs = Array.from(document.querySelectorAll('input[type="checkbox"]'));
    for (var ci=0;ci<cbs.length;ci++) {
        var cb=cbs[ci]; if (!window.isFieldFillable(cb)||ghState.filledElements.has(cb)) continue;
        var cblbl=window.getLabelForElement(cb).toLowerCase();
        if (/london|commute/i.test(cblbl)) continue;
        if (/i do not consent|do not consent/i.test(cblbl)) {
            if (cb.checked){cb.click();cb.dispatchEvent(new Event('change',{bubbles:true}));}
            ghState.filledElements.add(cb); continue;
        }
        if (/acknowledge|confirm|consent|agree|accept|certif|terms|privacy|authorize|i have read/i.test(cblbl)) {
            if (!cb.checked){cb.click();cb.dispatchEvent(new Event('change',{bubbles:true}));filled++;}
            ghState.filledElements.add(cb);
        }
        await window.delay(50);
    }

    // London commute question ' pick "No"
    var londonBoxes=Array.from(document.querySelectorAll('input[type="checkbox"]')).filter(function(cb){
        return /london|commute|greater london/i.test(window.getLabelForElement(cb));
    });
    if (londonBoxes.length>0) {
        var noBox=londonBoxes.find(function(cb){return window.getLabelForElement(cb).trim().toLowerCase()==='no';})||londonBoxes[londonBoxes.length-1];
        if (noBox&&!noBox.checked&&!ghState.filledElements.has(noBox)){noBox.click();noBox.dispatchEvent(new Event('change',{bubbles:true}));ghState.filledElements.add(noBox);filled++;}
    }

    // "" 5. Radio buttons """"""""""""""""""""""""""""""""""""""""""
    var radios=Array.from(document.querySelectorAll('input[type="radio"]'));
    var seenGroups={};
    for (var ri=0;ri<radios.length;ri++) {
        var rb=radios[ri];
        if (seenGroups[rb.name]||ghState.filledElements.has(rb)||!window.isFieldFillable(rb)) continue;
        var rbLbl=window.getLabelForElement(rb).toLowerCase();
        var fs2=rb.closest('fieldset');
        var grpLbl=fs2?(fs2.querySelector('legend')||{textContent:''}).textContent.toLowerCase():'';
        var combined=grpLbl+' '+rbLbl;
        var rbVal=/authorized|work.auth|legally/i.test(combined)?(workAuth||'Yes')
                 :/sponsor/i.test(combined)?'No'
                 :/reloc/i.test(combined)?(relocation||'Yes')
                 :/veteran/i.test(combined)?'No'
                 :/disability/i.test(combined)?'No':null;
        if (!rbVal) continue;
        var grpRbs=Array.from(document.querySelectorAll('input[type="radio"][name="'+rb.name+'"]'));
        var tgt=grpRbs.find(function(r2){return window.getLabelForElement(r2).toLowerCase().includes(rbVal.toLowerCase());})
             ||(rbVal==='Yes'?grpRbs[0]:grpRbs[grpRbs.length-1]);
        if (tgt&&!tgt.checked){tgt.checked=true;tgt.dispatchEvent(new Event('change',{bubbles:true}));tgt.click();ghState.filledElements.add(tgt);seenGroups[rb.name]=true;filled++;}
        await window.delay(100);
    }

    // "" 6. Work Experience """""""""""""""""""""""""""""""""""""""
    var experience = p.experience || [];
    if (experience.length > 0) {
        var expFields = Array.from(document.querySelectorAll('input[type="text"], textarea')).filter(function(el) {
            var lbl = window.getLabelForElement(el).toLowerCase();
            return /company|employer|organization|job.*title|position|role/.test(lbl) && window.isFieldFillable(el) && !ghState.filledElements.has(el);
        });
        
        var exp = experience[0]; // Use most recent experience
        for (var efi = 0; efi < expFields.length; efi++) {
            var ef = expFields[efi];
            var efLbl = window.getLabelForElement(ef).toLowerCase();
            var val = '';
            if (/company|employer|organization/.test(efLbl)) val = exp.company || '';
            else if (/title|position|role/.test(efLbl)) val = exp.title || exp.job_title || '';
            
            if (val && window.fillField(ef, val)) {
                ghState.filledElements.add(ef);
                filled++;
                console.log('[GH] Experience field filled:', efLbl.substring(0, 30));
            }
        }
    }

    // "" 7. Education """"""""""""""""""""""""""""""""""""""""""""""
    var education = p.education || [];
    if (education.length > 0) {
        var eduFields = Array.from(document.querySelectorAll('input[type="text"], textarea')).filter(function(el) {
            var lbl = window.getLabelForElement(el).toLowerCase();
            return /school|university|college|institution|degree|major|field.*study|gpa/.test(lbl) && window.isFieldFillable(el) && !ghState.filledElements.has(el);
        });
        
        var edu = education[0]; // Use highest education
        for (var efi = 0; efi < eduFields.length; efi++) {
            var ef = eduFields[efi];
            var efLbl = window.getLabelForElement(ef).toLowerCase();
            var val = '';
            if (/school|university|college|institution/.test(efLbl)) val = edu.institution || edu.school || '';
            else if (/degree/.test(efLbl)) val = edu.degree || '';
            else if (/major|field.*study/.test(efLbl)) val = edu.field_of_study || edu.field || '';
            else if (/gpa/.test(efLbl)) val = edu.gpa || '';
            
            if (val && window.fillField(ef, val)) {
                ghState.filledElements.add(ef);
                filled++;
                console.log('[GH] Education field filled:', efLbl.substring(0, 30));
            }
        }
    }

    // "" 8. Skills """""""""""""""""""""""""""""""""""""""""""""""""
    var skills = p.skills || [];
    if (skills.length > 0) {
        var skillFields = Array.from(document.querySelectorAll('input[type="text"], textarea')).filter(function(el) {
            var lbl = window.getLabelForElement(el).toLowerCase();
            return /skill|technolog|programming|language|framework|tool/.test(lbl) && window.isFieldFillable(el) && !ghState.filledElements.has(el);
        });
        
        var skillsText = Array.isArray(skills) ? skills.join(', ') : skills.toString();
        for (var sfi = 0; sfi < skillFields.length; sfi++) {
            var sf = skillFields[sfi];
            if (window.fillField(sf, skillsText)) {
                ghState.filledElements.add(sf);
                filled++;
                console.log('[GH] Skills field filled');
                break; // Usually only one skills field
            }
        }
    }

    // "" 9. AI questions """""""""""""""""""""""""""""""""""""""""""
    var tas=Array.from(document.querySelectorAll('textarea'));
    for (var ti=0;ti<tas.length;ti++) {
        var ta=tas[ti]; if (!window.isFieldFillable(ta)||ghState.filledElements.has(ta)) continue;
        var taLbl=window.getLabelForElement(ta);
        if (taLbl&&window.isAIQuestion(taLbl)) {
            var ans=await window.getAIAnswer(taLbl,profile);
            if (ans){window.fillField(ta,ans);ghState.filledElements.add(ta);filled++;}
        }
    }

    console.log('[AutoFill] fillGreenhouse done, filled:', filled);
    return filled;
}

// "" Message listener """"""""""""""""""""""""""""""""""""""""""
chrome.runtime.onMessage.addListener(function(message, sender, sendResponse) {
    if (!message||!message.type) return false;
    if (message.type==='PERFORM_AUTO_FILL'||message.type==='AUTOFILL_START'||message.type==='AUTO_FILL_FORM') {
        if (ghState.isFilling){sendResponse({success:false,error:'Already filling'});return false;}
        var profile=message.userProfile||message.profile||message.data||null;
        ghState.isFilling=true;
        if (message.backendUrl) window.AUTOFILL_BACKEND_URL=message.backendUrl;
        function doFill(p){
            window.showToast('Greenhouse AutoFill starting...','success');
            fillGreenhouse(p).then(function(n){
                ghState.isFilling=false;
                window.showToast('Greenhouse AutoFill: '+n+' field(s) filled.','success');
                try{sendResponse({success:true,filled:n,result:{filledCount:n,skippedCount:0}});}catch(e){}
            }).catch(function(err){ghState.isFilling=false;try{sendResponse({success:false,error:err.message});}catch(e){}});
        }
        if (!profile){
            chrome.storage.local.get(['userProfile'],function(r){
                var sp=r&&r.userProfile;
                if(!sp){sendResponse({success:false,error:'No profile. Upload resume first.'});ghState.isFilling=false;return;}
                doFill(sp);
            });return true;
        }
        doFill(profile); return true;
    }
    if (message.type==='PING'){sendResponse({alive:true,platform:'greenhouse'});return false;}
    if (message.type==='DETECT_PLATFORM'){sendResponse({success:true,platform:'greenhouse'});return false;}
    return false;
});

console.log('[Greenhouse] autoFill-greenhouse.js loaded');
} // end guard
