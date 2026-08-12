path = r'c:\Users\sujan\OneDrive\Desktop\intern\extension\content\autoFill.js'
with open(path,'r',encoding='utf-8') as f:
    content = f.read()

old = '''    // ── 1. Text inputs ── Greenhouse uses bracket names ──────────────────
    // e.g. job_application[first_name], job_application[email], etc.
    var ghTextMap = [
        { patterns: [/job_application\\[first_name\\]/i, /\\bfirst.?name\\b/i, /\\bgiven.?name\\b/i, /\\bfname\\b/i],
          labels:   [/first\\s*name/i, /given\\s*name/i],
          v: firstName },
        { patterns: [/job_application\\[last_name\\]/i,  /\\blast.?name\\b/i,  /\\bfamily.?name\\b/i, /\\bsurname\\b/i, /\\blname\\b/i],
          labels:   [/last\\s*name/i, /family\\s*name/i, /surname/i],
          v: lastName },
        { patterns: [/job_application\\[email\\]/i, /\\bemail\\b/i],
          labels:   [/\\bemail\\b/i],
          v: email },
        { patterns: [/job_application\\[phone\\]/i, /\\bphone\\b/i, /\\bmobile\\b/i, /\\bcell\\b/i],
          labels:   [/\\bphone\\b/i, /\\bmobile\\b/i, /telephone/i],
          v: phone },
        { patterns: [/job_application\\[location\\]/i, /\\blocation\\b/i, /\\bcity\\b/i],
          labels:   [/\\blocation\\b/i, /\\bcity\\b/i, /where.*based/i, /where.*located/i],
          v: city },
        { patterns: [/linkedin/i],
          labels:   [/linkedin/i],
          v: linkedin },
        { patterns: [/\\bwebsite\\b/i, /\\bportfolio\\b/i],
          labels:   [/website/i, /portfolio/i, /personal.*url/i, /personal.*site/i],
          v: portfolio || linkedin },
        { patterns: [/\\bgithub\\b/i],
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
        var lbl = getLabelForElement(inp).toLowerCase().replace(/[*\\s]+/g, ' ').trim();
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
    }'''

new = '''    // ── 1. Text inputs by ID (confirmed from console audit) ─────────────
    // IDs confirmed: first_name, last_name, preferred_name, email, phone,
    //   candidate-location (city), question_67865611 (LinkedIn),
    //   question_67865613 (how-did-you-hear), question_67865614 (specify)
    var ghIdMap = [
        { id: 'first_name',         v: firstName   },
        { id: 'last_name',          v: lastName    },
        { id: 'preferred_name',     v: firstName   },
        { id: 'email',              v: email       },
        { id: 'phone',              v: phone       }
    ];
    // Fill by exact ID first
    for (var ghi = 0; ghi < ghIdMap.length; ghi++) {
        var ghm = ghIdMap[ghi];
        if (!ghm.v) continue;
        var ghEl = document.getElementById(ghm.id);
        if (ghEl && isFieldFillable(ghEl) && !fillState.filledElements.has(ghEl)) {
            if (fillField(ghEl, ghm.v)) { fillState.filledElements.add(ghEl); filled++; console.log('[GH] id fill:', ghm.id, '=', ghm.v.substring(0,40)); }
        }
    }

    // LinkedIn: id=question_67865611 OR label "LinkedIn Profile"
    var liEl = document.getElementById('question_67865611')
            || Array.from(document.querySelectorAll('input[type="text"]')).find(function(e) {
                   return /linkedin/i.test(getLabelForElement(e));
               });
    if (liEl && isFieldFillable(liEl) && !fillState.filledElements.has(liEl) && linkedin) {
        if (fillField(liEl, linkedin)) { fillState.filledElements.add(liEl); filled++; console.log('[GH] linkedin filled'); }
    }

    // How did you hear: id=question_67865613 OR label "How did you initially hear"
    var hdyhEl = document.getElementById('question_67865613')
              || Array.from(document.querySelectorAll('input[type="text"]')).find(function(e) {
                     return /how did you.*hear|how.*initially.*hear/i.test(getLabelForElement(e));
                 });
    if (hdyhEl && isFieldFillable(hdyhEl) && !fillState.filledElements.has(hdyhEl)) {
        if (fillField(hdyhEl, 'LinkedIn')) { fillState.filledElements.add(hdyhEl); filled++; console.log('[GH] how-did-you-hear = LinkedIn'); }
    }

    // Fallback: any remaining text inputs by label
    var allInputs = Array.from(document.querySelectorAll(
        'input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="file"]):not([type="checkbox"]):not([type="radio"]), textarea'
    ));
    var ghLabelMap = [
        { pat: /first\s*name/i,    v: firstName  },
        { pat: /last\s*name/i,     v: lastName   },
        { pat: /preferred.*name/i, v: firstName  },
        { pat: /\bemail\b/i,       v: email      },
        { pat: /\bphone\b/i,       v: phone      },
        { pat: /location|city/i,   v: city       },
        { pat: /linkedin/i,        v: linkedin   },
        { pat: /website|portfolio/i, v: portfolio || linkedin },
        { pat: /github/i,          v: github     }
    ];
    for (var ii = 0; ii < allInputs.length; ii++) {
        var inp = allInputs[ii];
        if (!isFieldFillable(inp) || fillState.filledElements.has(inp)) continue;
        var lbl = getLabelForElement(inp).toLowerCase().replace(/[*]+/g,'').trim();
        for (var fi = 0; fi < ghLabelMap.length; fi++) {
            var fm = ghLabelMap[fi];
            if (!fm.v) continue;
            if (fm.pat.test(lbl)) {
                if (fillField(inp, fm.v)) { fillState.filledElements.add(inp); filled++; console.log('[GH] label fill:', lbl.substring(0,40), '=', fm.v.substring(0,40)); }
                break;
            }
        }
    }'''

if old in content:
    content = content.replace(old, new)
    print('TEXT SECTION REPLACED')
else:
    print('NOT FOUND - trying partial...')
    idx = content.find('ghTextMap')
    print('ghTextMap idx:', idx)

# Also fix the ghSelectMap — confirmed labels from console
old2 = '''    var ghSelectMap = [
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
    ];'''

new2 = '''    // Confirmed labels from console: Country*, Location (City)*,
    // non-compete (full question text), Point of Data Transfer*,
    // Gender, Are you Hispanic/Latino?, Veteran Status, Disability Status
    var ghSelectMap = [
        // Country — inside div.phone-input__country, id=country
        { pat: /^country/i,                      val: 'India',                         ms: 400, id: 'country' },
        // Non-compete — exact label from console
        { pat: /non.?compete|non.?solicit|confidentiality/i, val: 'No',                ms: 400 },
        // Point of Data Transfer — confirmed label
        { pat: /point of data transfer/i,        val: 'I am not currently based in the UK', ms: 400 },
        // Gender
        { pat: /^gender$/i,                      val: 'Decline To Self Identify',      ms: 400, id: 'gender' },
        // Hispanic/Latino
        { pat: /hispanic|latino/i,               val: 'No',                             ms: 600, id: 'hispanic_ethnicity' },
        // Veteran Status
        { pat: /veteran/i,                       val: 'I am not a protected veteran',  ms: 400, id: 'veteran_status' },
        // Disability Status — confirmed options from screenshot
        { pat: /disability/i,                    val: 'No, I do not have a disability', ms: 400, id: 'disability_status' }
    ];'''

if old2 in content:
    content = content.replace(old2, new2)
    print('SELECT MAP REPLACED')
else:
    print('SELECT MAP NOT FOUND')
    idx2 = content.find('ghSelectMap')
    print('ghSelectMap idx:', idx2)

# Also fix the select-opening logic to use id when available
old3 = '''    for (var sci = 0; sci < selectConts.length; sci++) {
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
    }'''

new3 = '''    for (var sci = 0; sci < selectConts.length; sci++) {
        var cont = selectConts[sci];
        if (fillState.filledElements.has(cont)) continue;
        var contLabel = '';
        var contInputId = '';
        var cp = cont.parentElement; var depth = 0;
        while (cp && cp !== document.body && !contLabel && depth < 8) {
            var lEl = cp.querySelector('label');
            if (lEl) { contLabel = lEl.textContent.trim(); break; }
            var da = cp.getAttribute('data-field') || cp.getAttribute('aria-label') || '';
            if (da) { contLabel = da; break; }
            cp = cp.parentElement; depth++;
        }
        var cInp = cont.querySelector('input');
        if (cInp) contInputId = cInp.id || '';
        if (!contLabel && !contInputId) continue;

        // Match by id first (more reliable), then by label text
        var mapping = ghSelectMap.find(function(m) {
            return (m.id && m.id === contInputId) || m.pat.test(contLabel);
        });
        if (!mapping) continue;
        console.log('[GH] select:', contLabel.substring(0,50), 'id:'+contInputId, '→', mapping.val);

        // For country — derive from profile, not hardcoded
        var selectVal = mapping.val;
        if (/^country/i.test(contLabel) || contInputId === 'country') {
            selectVal = (p.contact && p.contact.country) || p.country || 'India';
        }
        if (/disability/i.test(contLabel)) {
            selectVal = 'No, I do not have a disability';
        }

        var ok = await ghOpenSelect(cont, selectVal, mapping.ms);
        if (ok) fillState.filledElements.add(cont);
        await delay(300);
    }

    // ── 2b. London commute question — pick "No" (not based in London) ─────
    // Checkboxes with name question_67865610[] — pick appropriate option
    await (async function handleLondonQuestion() {
        var londonBoxes = Array.from(document.querySelectorAll('input[type="checkbox"]')).filter(function(cb) {
            return /london|commute|greater london/i.test(getLabelForElement(cb));
        });
        if (londonBoxes.length === 0) return;
        // Default: select "No" option (last checkbox in group)
        var noBox = londonBoxes.find(function(cb) {
            return getLabelForElement(cb).trim().toLowerCase() === 'no';
        }) || londonBoxes[londonBoxes.length - 1];
        if (noBox && !noBox.checked && !fillState.filledElements.has(noBox)) {
            noBox.click();
            noBox.dispatchEvent(new Event('change',{bubbles:true}));
            fillState.filledElements.add(noBox);
            filled++;
            console.log('[GH] London commute: selected No');
        }
    })();'''

if old3 in content:
    content = content.replace(old3, new3)
    print('SELECT LOOP REPLACED')
else:
    print('SELECT LOOP NOT FOUND')

# Fix checkboxes — uncheck "I do not consent" which should NOT be checked
old4 = '''    // ── 3. Checkboxes — tick all consent / agree checkboxes ──────────────
    // Greenhouse shows 3 consent checkboxes at the bottom — tick all of them
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
    }'''

new4 = '''    // ── 3. Checkboxes ─────────────────────────────────────────────────────
    // Confirmed from console:
    //   question_67865615[] = Acknowledge/Confirm → TICK
    //   question_67865617[] = Acknowledge / Confirm → TICK
    //   question_67865618[]_730740108 = I consent to recording → TICK
    //   question_67865618[]_730740109 = I do NOT consent → UNCHECK
    var checkboxes = Array.from(document.querySelectorAll('input[type="checkbox"]'));
    for (var ci = 0; ci < checkboxes.length; ci++) {
        var cb = checkboxes[ci];
        if (!isFieldFillable(cb)) continue;
        var cbLabel = getLabelForElement(cb).toLowerCase();
        // UNCHECK "do not consent" — should never be checked
        if (/i do not consent|do not consent/i.test(cbLabel)) {
            if (cb.checked) { cb.click(); cb.dispatchEvent(new Event('change',{bubbles:true})); console.log('[GH] unchecked do-not-consent'); }
            fillState.filledElements.add(cb);
            continue;
        }
        if (fillState.filledElements.has(cb)) continue;
        // TICK: acknowledge, confirm, consent, agree, accept
        if (/acknowledge|confirm|consent|agree|accept|certif|terms|privacy|authorize|i have read/i.test(cbLabel)) {
            if (!cb.checked) { cb.click(); cb.dispatchEvent(new Event('change',{bubbles:true})); filled++; console.log('[GH] ticked:', cbLabel.substring(0,60)); }
            fillState.filledElements.add(cb);
        }
        await delay(50);
    }'''

if old4 in content:
    content = content.replace(old4, new4)
    print('CHECKBOXES REPLACED')
else:
    print('CHECKBOXES NOT FOUND')

with open(path,'w',encoding='utf-8') as f:
    f.write(content)
print('FILE WRITTEN. Size:', len(content))
