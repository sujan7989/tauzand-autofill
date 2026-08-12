import re

path = r'c:\Users\sujan\OneDrive\Desktop\intern\extension\content\autoFill.js'
with open(path, 'r', encoding='utf-8') as f:
    content = f.read()

# Find start and end of fillGreenhouse function
start_marker = 'async function fillGreenhouse(profile) {'
end_marker = 'async function fillLever(profile) {'

start_idx = content.find(start_marker)
end_idx = content.find(end_marker)

if start_idx == -1 or end_idx == -1:
    print('MARKERS NOT FOUND', start_idx, end_idx)
    exit(1)

new_func = r'''async function fillGreenhouse(profile) {
    console.log('[AutoFill] fillGreenhouse start');
    var p = profile || {};
    var filled = 0;

    var firstName  = (p.first_name) || (p.personal && p.personal.first_name) || '';
    var lastName   = (p.last_name)  || (p.personal && p.personal.last_name)  || '';
    var email      = (p.contact && p.contact.email)   || p.email   || '';
    var phoneRaw   = (p.contact && p.contact.phone)   || p.phone   || '';
    var city       = ((p.contact && p.contact.city)   || p.city    || '').split(',')[0].trim();
    var linkedin   = (p.social && p.social.linkedin)  || p.linkedin  || '';
    var portfolio  = (p.social && p.social.portfolio) || p.portfolio || '';
    var github     = (p.social && p.social.github)    || p.github    || '';
    var relocation = (p.professional && p.professional.willing_to_relocate) || 'Yes';
    var workAuth   = (p.professional && p.professional.work_authorization)  || 'Yes';

    // Strip country code: +917989168768 → 7989168768
    var phone = phoneRaw;
    if (phoneRaw.startsWith('+')) {
        var digits = phoneRaw.slice(1);
        if (digits.length === 12) phone = digits.slice(2);
        else if (digits.length === 11) phone = digits.slice(1);
        else if (digits.length === 13) phone = digits.slice(3);
        else phone = digits.replace(/^\d{1,3}/, '') || digits;
    }
    // Normalise LinkedIn URL
    if (linkedin && !linkedin.startsWith('http')) {
        linkedin = 'https://www.linkedin.com/in/' + linkedin.replace(/.*linkedin\.com\/in\//i, '');
    }

    // ── 1. Text inputs ── Greenhouse uses bracket names ──────────────────
    // e.g. job_application[first_name], job_application[email], etc.
    var ghTextMap = [
        { patterns: [/job_application\[first_name\]/i, /\bfirst.?name\b/i, /\bgiven.?name\b/i, /\bfname\b/i],
          labels:   [/first\s*name/i, /given\s*name/i],
          v: firstName },
        { patterns: [/job_application\[last_name\]/i,  /\blast.?name\b/i,  /\bfamily.?name\b/i, /\bsurname\b/i, /\blname\b/i],
          labels:   [/last\s*name/i, /family\s*name/i, /surname/i],
          v: lastName },
        { patterns: [/job_application\[email\]/i, /\bemail\b/i],
          labels:   [/\bemail\b/i],
          v: email },
        { patterns: [/job_application\[phone\]/i, /\bphone\b/i, /\bmobile\b/i, /\bcell\b/i],
          labels:   [/\bphone\b/i, /\bmobile\b/i, /telephone/i],
          v: phone },
        { patterns: [/job_application\[location\]/i, /\blocation\b/i, /\bcity\b/i],
          labels:   [/\blocation\b/i, /\bcity\b/i, /where.*based/i, /where.*located/i],
          v: city },
        { patterns: [/linkedin/i],
          labels:   [/linkedin/i],
          v: linkedin },
        { patterns: [/\bwebsite\b/i, /\bportfolio\b/i],
          labels:   [/website/i, /portfolio/i, /personal.*url/i, /personal.*site/i],
          v: portfolio || linkedin },
        { patterns: [/\bgithub\b/i],
          labels:   [/github/i],
          v: github }
    ];

    var allInputs = Array.from(document.querySelectorAll(
        'input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="file"]), textarea'
    ));
    for (var ii = 0; ii < allInputs.length; ii++) {
        var inp = allInputs[ii];
        if (!isFieldFillable(inp) || fillState.filledElements.has(inp)) continue;
        var nm  = (inp.name  || '').toLowerCase();
        var iid = (inp.id    || '').toLowerCase();
        var ph  = (inp.placeholder || '').toLowerCase();
        var ac  = (inp.getAttribute('autocomplete') || '').toLowerCase();
        var lbl = getLabelForElement(inp).toLowerCase().replace(/[*\s]+/g, ' ').trim();
        for (var fi = 0; fi < ghTextMap.length; fi++) {
            var fm = ghTextMap[fi];
            if (!fm.v) continue;
            var nmHit  = fm.patterns.some(function(r) { return r.test(nm) || r.test(iid); });
            var lblHit = fm.labels.some(function(r)   { return r.test(lbl) || r.test(ph) || r.test(ac); });
            if (nmHit || lblHit) {
                if (fillField(inp, fm.v)) { fillState.filledElements.add(inp); filled++; console.log('[GH] text:', nm||lbl, '=', fm.v.substring(0,40)); }
                break;
            }
        }
    }

    // ── 2. React Select dropdowns ─────────────────────────────────────────
    // Structure: div.select__container > input.select__input[role=combobox]
    // Open via coordinate-based mousedown (ctrl.click opens wrong dropdown)
    // Skip if options >= 50 (that is the phone-country list with 200+ entries)

    async function ghOpenSelect(cont, desiredValue, extraMs) {
        var inp2 = cont.querySelector('input.select__input[role="combobox"]')
                || cont.querySelector('input[role="combobox"]')
                || cont.querySelector('input.select__input');
        if (!inp2) return false;
        inp2.focus();
        await delay(100);
        var rect = inp2.getBoundingClientRect();
        inp2.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, clientX: rect.left + 5, clientY: rect.top + 5 }));
        await delay(extraMs || 400);
        var opts = Array.from(document.querySelectorAll('[class*="select__option"],[class*="Select__option"]')).filter(function(o) {
            var r2 = o.getBoundingClientRect(); return r2.width > 0 && r2.height > 0;
        });
        if (opts.length >= 50) {                            // phone-country guard
            document.body.dispatchEvent(new MouseEvent('mousedown', {bubbles:true}));
            await delay(200);
            return false;
        }
        if (opts.length === 0) { console.log('[GH] No options for:', desiredValue); return false; }
        var desired = desiredValue.toLowerCase();
        var target = opts.find(function(o) { return o.textContent.trim().toLowerCase() === desired; })
                  || opts.find(function(o) { return o.textContent.trim().toLowerCase().includes(desired); })
                  || opts.find(function(o) { return desired.includes(o.textContent.trim().toLowerCase().substring(0,6)); });
        if (!target) {
            console.log('[GH] No match for:', desiredValue, '| options:', opts.slice(0,3).map(function(o){return o.textContent.trim();}).join(' | '));
            document.body.dispatchEvent(new MouseEvent('mousedown', {bubbles:true}));
            return false;
        }
        target.click();
        filled++;
        console.log('[GH] dropdown:', desiredValue.substring(0,30), '→', target.textContent.trim());
        await delay(200);
        return true;
    }

    var ghSelectMap = [
        { pat: /gender|sex/i,                    val: 'Decline to self-identify',    ms: 400 },
        { pat: /hispanic|latino/i,               val: 'No',                           ms: 600 },
        { pat: /race|ethnicity/i,                val: 'Decline to self-identify',     ms: 400 },
        { pat: /veteran/i,                       val: 'I am not a protected veteran', ms: 400 },
        { pat: /disability/i,                    val: 'no, i do not have',             ms: 400 },
        { pat: /non.?compete|non.?solicit/i,     val: 'No',                            ms: 400 },
        { pat: /data.?transfer|personal.?data/i, val: 'not currently',                 ms: 400 },
        { pat: /how.did.you.hear|referr|source/i,val: 'LinkedIn',                     ms: 400 },
        { pat: /authorized|work.auth|legally/i,  val: workAuth || 'Yes',              ms: 400 },
        { pat: /sponsor/i,                       val: 'No',                            ms: 400 },
        { pat: /reloc/i,                         val: relocation || 'Yes',             ms: 400 }
    ];

    var selectConts = Array.from(document.querySelectorAll(
        'div.select__container, [class*="select__container"], [class*="Select__container"]'
    ));
    console.log('[GH] React Select containers:', selectConts.length);
    for (var sci = 0; sci < selectConts.length; sci++) {
        var cont = selectConts[sci];
        if (fillState.filledElements.has(cont)) continue;
        var contLabel = '';
        var cp = cont.parentElement; var depth = 0;
        while (cp && cp !== document.body && !contLabel && depth < 8) {
            var lEl = cp.querySelector('label');
            if (lEl) { contLabel = lEl.textContent.trim(); break; }
            var da = cp.getAttribute('data-field') || cp.getAttribute('aria-label') || '';
            if (da) { contLabel = da; break; }
            cp = cp.parentElement; depth++;
        }
        if (!contLabel) continue;
        var mapping = ghSelectMap.find(function(m) { return m.pat.test(contLabel); });
        if (!mapping) continue;
        console.log('[GH] select label:', contLabel.substring(0,50), '→', mapping.val);
        var ok = await ghOpenSelect(cont, mapping.val, mapping.ms);
        if (ok) fillState.filledElements.add(cont);
        await delay(300);
    }

    // ── 3. Checkboxes — tick all consent / agree checkboxes ──────────────
    var checkboxes = Array.from(document.querySelectorAll('input[type="checkbox"]'));
    for (var ci = 0; ci < checkboxes.length; ci++) {
        var cb = checkboxes[ci];
        if (fillState.filledElements.has(cb) || !isFieldFillable(cb)) continue;
        var cbLabel = getLabelForElement(cb).toLowerCase();
        if (/consent|agree|acknowledge|accept|certif|confirm|terms|privacy|authorize|i have read/i.test(cbLabel)) {
            if (!cb.checked) { cb.click(); cb.dispatchEvent(new Event('change',{bubbles:true})); filled++; console.log('[GH] checkbox ticked:', cbLabel.substring(0,50)); }
            fillState.filledElements.add(cb);
        }
        await delay(50);
    }

    // ── 4. Radio buttons ─────────────────────────────────────────────────
    var radios = Array.from(document.querySelectorAll('input[type="radio"]'));
    var seenGroups = {};
    for (var ri = 0; ri < radios.length; ri++) {
        var rb = radios[ri];
        if (seenGroups[rb.name] || fillState.filledElements.has(rb) || !isFieldFillable(rb)) continue;
        var rbLbl = getLabelForElement(rb).toLowerCase();
        var fs2 = rb.closest('fieldset');
        var grpLbl = fs2 ? (fs2.querySelector('legend')||{textContent:''}).textContent.toLowerCase() : '';
        var combined = grpLbl + ' ' + rbLbl;
        var rbVal = /authorized|work.auth|legally/i.test(combined) ? (workAuth||'Yes')
                  : /sponsor/i.test(combined)  ? 'No'
                  : /reloc/i.test(combined)    ? (relocation||'Yes')
                  : /veteran/i.test(combined)  ? 'No'
                  : /disability/i.test(combined) ? 'No'
                  : null;
        if (!rbVal) continue;
        var grpRadios = Array.from(document.querySelectorAll('input[type="radio"][name="'+rb.name+'"]'));
        var tgt = grpRadios.find(function(r2){ return getLabelForElement(r2).toLowerCase().includes(rbVal.toLowerCase()); })
               || (rbVal==='Yes' ? grpRadios[0] : grpRadios[grpRadios.length-1]);
        if (tgt && !tgt.checked) {
            tgt.checked = true; tgt.dispatchEvent(new Event('change',{bubbles:true})); tgt.click();
            fillState.filledElements.add(tgt); seenGroups[rb.name] = true; filled++;
            console.log('[GH] radio:', grpLbl.substring(0,40), '→', rbVal);
        }
        await delay(100);
    }

    // ── 5. AI open-ended questions ────────────────────────────────────────
    if (AUTO_FILL_CONFIG.AI_QUESTIONS_ENABLED) {
        var textareas = Array.from(document.querySelectorAll('textarea'));
        for (var ti = 0; ti < textareas.length; ti++) {
            var ta = textareas[ti];
            if (!isFieldFillable(ta) || fillState.filledElements.has(ta)) continue;
            var taLabel = getLabelForElement(ta);
            if (taLabel && isAIQuestion(taLabel)) {
                console.log('[GH] AI question:', taLabel.substring(0,60));
                var answer = await getAIAnswer(taLabel, profile);
                if (answer) { fillField(ta, answer); fillState.filledElements.add(ta); filled++; }
            }
        }
    }

    console.log('[AutoFill] fillGreenhouse done, filled:', filled);
    return filled;
}

'''

content = content[:start_idx] + new_func + '\n// ' + '=' * 62 + '\n' + content[end_idx:]
with open(path, 'w', encoding='utf-8') as f:
    f.write(content)
print('DONE. File size:', len(content))
