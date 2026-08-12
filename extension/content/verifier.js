// verifier.js — Post-fill verification layer
// Runs on ALL sites. Checks whether the website actually accepted filled values.
// Does NOT modify any values — read-only DOM inspection only.
// Called after any platform adapter completes filling.

if (window.__verifierInitialized) {
    // already loaded
} else {
window.__verifierInitialized = true;

var ERROR_TEXT_PATTERNS = [
    /this field is required/i, /field is required/i, /required field/i,
    /please fill/i, /please enter/i, /cannot be empty/i, /value is required/i,
    /is required/i, /invalid value/i, /invalid entry/i, /not a valid/i,
    /please select/i, /selection required/i, /must be selected/i,
    /enter a valid/i, /provide a valid/i, /incorrect format/i,
    /minimum.*character/i, /must be at least/i, /does not match/i,
    /the field.*is required/i, /please complete.*field/i
];

var ERROR_SELECTORS = [
    '[aria-invalid="true"]',
    '[class*="error"]:not(script):not(style)',
    '[class*="invalid"]:not(script):not(style)',
    'mat-error', '.mat-error',
    '[data-automation-id*="errorMessage"]',
    'spl-validation-message',
    '[class*="validation-message"]',
    '.invalid-feedback', '.is-invalid',
    '.ant-form-item-explain-error',
    '[role="alert"]',
    '.error-message',
    '.text-danger',
    'p.error, span.error'
].join(',');

function deepQuery(root, sel, depth) {
    depth = depth || 0; if (depth > 6) return [];
    var res = []; try { res = Array.from(root.querySelectorAll(sel)); } catch(e){}
    try {
        Array.from(root.querySelectorAll('*')).forEach(function(el){
            if (el.shadowRoot) res = res.concat(deepQuery(el.shadowRoot, sel, depth+1));
        });
    } catch(e){}
    return res;
}

function getVisibleText(el) {
    if (!el) return '';
    var r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) return '';
    return (el.innerText || el.textContent || '').trim().replace(/\s+/g,' ');
}

function getLabelForEl(el) {
    if (window.getLabelForElement) return window.getLabelForElement(el);
    if (!el) return '';
    if (el.id) {
        var lf = document.querySelector('label[for="'+el.id+'"]');
        if (lf) return (lf.innerText||lf.textContent||'').trim();
    }
    return el.getAttribute('aria-label')||el.placeholder||el.name||'';
}

function scanForErrors() {
    var errors = [];
    var errorEls = deepQuery(document, ERROR_SELECTORS);
    errorEls.forEach(function(el) {
        var text = getVisibleText(el);
        if (!text || text.length < 3 || text.length > 300) return;
        var isErr = ERROR_TEXT_PATTERNS.some(function(p){return p.test(text);}) ||
                    el.getAttribute('aria-invalid')==='true' ||
                    /(error|invalid|danger)/i.test(el.className||'');
        if (!isErr) return;
        var fieldLabel = '';
        var parent = el.parentElement;
        for (var d=0; d<6&&parent&&!fieldLabel; d++) {
            var lels = parent.querySelectorAll('label,[class*="label"],legend');
            for (var i=0;i<lels.length;i++){
                var lt = getVisibleText(lels[i]);
                if (lt&&lt.length>1&&lt.length<80&&!lels[i].contains(el)){fieldLabel=lt;break;}
            }
            if (!fieldLabel){
                var ni = parent.querySelector('input,textarea,select');
                if (ni) { fieldLabel = getLabelForEl(ni); break; }
            }
            parent = parent.parentElement;
        }
        errors.push({field:fieldLabel||'Unknown field', error:text, severity:'error'});
    });

    // aria-invalid on inputs
    deepQuery(document,'[aria-invalid="true"]').forEach(function(el){
        var tag=(el.tagName||'').toUpperCase();
        if (!['INPUT','TEXTAREA','SELECT'].includes(tag)) return;
        if (el.getBoundingClientRect().width===0) return;
        var label = getLabelForEl(el);
        if (!errors.some(function(e){return e.field===label&&e.severity==='error';}))
            errors.push({field:label||'Unknown field',error:'Field marked as invalid',severity:'error'});
    });

    // required but empty
    deepQuery(document,'input[required],textarea[required],select[required],[aria-required="true"]').forEach(function(el){
        if (el.getBoundingClientRect().width===0||el.disabled) return;
        if (!(el.value||'').trim()){
            var label = getLabelForEl(el);
            if (!errors.some(function(e){return e.field===label;}))
                errors.push({field:label||'Required field',error:'Required field is empty',severity:'warning'});
        }
    });

    // Dedup
    var seen={};
    return errors.filter(function(e){
        var k=e.field+':'+e.error; if(seen[k]) return false; seen[k]=true; return true;
    });
}

function verifyFields(expectedFields) {
    if (!expectedFields||!expectedFields.length) return [];
    return (expectedFields||[]).map(function(ef){
        var label    = ef.label||'';
        var expected = String(ef.expectedValue||'').trim();
        var allInputs= deepQuery(document,
            'input:not([type=hidden]):not([type=file]):not([type=submit]):not([type=button]),textarea,select');
        var match = null;
        allInputs.forEach(function(el){
            if(match) return;
            var lbl = getLabelForEl(el).toLowerCase();
            if(lbl && label.toLowerCase() &&
               lbl.includes(label.toLowerCase().substring(0,Math.min(10,label.length)))) match=el;
        });
        if (!match) return {label:label,status:'not_found',actualValue:'',error:'Field not found'};
        var val  = (match.value||'').trim();
        var inv  = match.getAttribute('aria-invalid')==='true';
        var status = inv ? 'invalid' : !val ? 'empty' :
                     (expected && !val.toLowerCase().includes(expected.toLowerCase().substring(0,8))) ? 'mismatch' :
                     'verified';
        return {label:label,status:status,actualValue:val,
                error:status==='verified'?'':status==='mismatch'?'Expected "'+expected.substring(0,20)+'" got "'+val.substring(0,20)+'"':status};
    });
}

chrome.runtime.onMessage.addListener(function(msg,sender,sendResponse){
    if(!msg||!msg.type) return false;

    if(msg.type==='VERIFY_PAGE_ERRORS'){
        try {
            var errs = scanForErrors();
            sendResponse({
                success:true,
                result:{
                    hasErrors:    errs.some(function(e){return e.severity==='error';}),
                    errorCount:   errs.filter(function(e){return e.severity==='error';}).length,
                    warningCount: errs.filter(function(e){return e.severity==='warning';}).length,
                    errors: errs.map(function(e){return {field:e.field,error:e.error,severity:e.severity};})
                }
            });
        } catch(e){ sendResponse({success:false,error:e.message}); }
        return false;
    }

    if(msg.type==='VERIFY_FIELDS'){
        try {
            var res = verifyFields(msg.fields||[]);
            var ok  = res.filter(function(r){return r.status==='verified';}).length;
            sendResponse({success:true,results:res,verified:ok,failed:res.length-ok});
        } catch(e){ sendResponse({success:false,error:e.message}); }
        return false;
    }

    if(msg.type==='PING'){sendResponse({alive:true,platform:'verifier'});return false;}
    return false;
});

console.log('[Verifier] loaded on', location.hostname);
} // end guard