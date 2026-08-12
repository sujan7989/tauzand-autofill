path = r'c:\Users\sujan\OneDrive\Desktop\intern\extension\content\autoFill.js'
with open(path,'r',encoding='utf-8') as f:
    c = f.read()

old = """    async function ghOpenSelect(cont, desiredValue, extraMs) {
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
        console.log('[GH] dropdown:', desiredValue.substring(0,30), '→', target.textContent.trim());"""

new = """    // CONFIRMED WORKING METHOD (from console testing):
    // 1. mousedown+mouseup+click on select__control div opens the dropdown
    // 2. Type search term char-by-char → filters results
    // 3. Click the matching option
    // Country = 244 options → must type to filter (e.g. "India" → "India +91")
    // Other selects (gender, veteran, etc.) = <10 options → no typing needed
    async function ghOpenSelect(cont, desiredValue, extraMs) {
        // Find the control div (confirmed: class contains select__control)
        var control = cont.querySelector('[class*="select__control"]');
        var inp2 = cont.querySelector('input.select__input[role="combobox"]')
                || cont.querySelector('input[role="combobox"]')
                || cont.querySelector('input.select__input');
        if (!control || !inp2) return false;

        // Open: mousedown+mouseup+click on control div (confirmed working)
        var rect = control.getBoundingClientRect();
        control.dispatchEvent(new MouseEvent('mousedown', {bubbles:true, cancelable:true, view:window, clientX:rect.left+10, clientY:rect.top+10}));
        control.dispatchEvent(new MouseEvent('mouseup',   {bubbles:true, cancelable:true, view:window, clientX:rect.left+10, clientY:rect.top+10}));
        control.dispatchEvent(new MouseEvent('click',     {bubbles:true, cancelable:true, view:window, clientX:rect.left+10, clientY:rect.top+10}));
        await delay(400);

        // Check how many options appeared
        var optsAfterOpen = Array.from(document.querySelectorAll('[class*="select__option"]')).filter(function(o) {
            var r2 = o.getBoundingClientRect(); return r2.width > 0 && r2.height > 0;
        });
        console.log('[GH] Opened select, options:', optsAfterOpen.length, '| searching for:', desiredValue.substring(0,30));

        // If many options (country list = 244), type to filter
        if (optsAfterOpen.length > 10) {
            var ns2 = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
            inp2.focus();
            var cur2 = '';
            for (var ci3 = 0; ci3 < desiredValue.length; ci3++) {
                var ch2 = desiredValue[ci3], kc2 = ch2.charCodeAt(0);
                cur2 += ch2;
                inp2.dispatchEvent(new KeyboardEvent('keydown', {key:ch2, keyCode:kc2, which:kc2, bubbles:true}));
                if (ns2) ns2.call(inp2, cur2); else inp2.value = cur2;
                inp2.dispatchEvent(new InputEvent('input', {bubbles:true, inputType:'insertText', data:ch2}));
                inp2.dispatchEvent(new KeyboardEvent('keyup', {key:ch2, keyCode:kc2, which:kc2, bubbles:true}));
            }
            await delay(800);
        }

        // Read filtered options
        var opts = Array.from(document.querySelectorAll('[class*="select__option"]')).filter(function(o) {
            var r2 = o.getBoundingClientRect(); return r2.width > 0 && r2.height > 0;
        });
        if (opts.length === 0) {
            console.log('[GH] No options visible for:', desiredValue);
            document.body.click(); return false;
        }

        var desired = desiredValue.toLowerCase();
        // For country: match "India +91" when searching "India" — startsWith is safest
        // For others: exact match first, then includes
        var target = opts.find(function(o) { return o.textContent.trim().toLowerCase() === desired; })
                  || opts.find(function(o) { return o.textContent.trim().toLowerCase().startsWith(desired + ' ') || o.textContent.trim().toLowerCase().startsWith(desired + '+'); })
                  || opts.find(function(o) { return o.textContent.trim().toLowerCase().includes(desired); })
                  || opts.find(function(o) { return desired.split(' ').every(function(w){ return o.textContent.trim().toLowerCase().includes(w); }); });

        if (!target) {
            console.log('[GH] No match for:', desiredValue, '| opts:', opts.slice(0,3).map(function(o){return o.textContent.trim();}).join(' | '));
            document.body.click(); return false;
        }
        target.click();
        filled++;
        console.log('[GH] Selected:', target.textContent.trim(), 'for search:', desiredValue.substring(0,30));"""

if old in c:
    c = c.replace(old, new)
    print('ghOpenSelect REPLACED')
else:
    print('NOT FOUND - checking partial...')
    idx = c.find('async function ghOpenSelect')
    print('ghOpenSelect at:', idx)

# Also fix country to use profile.country (not hardcoded 'India')
old2 = "{ pat: /^country/i,                      val: 'India',                         ms: 400, id: 'country' },"
new2 = "{ pat: /^country/i,                      val: (p.contact && p.contact.country) || p.country || 'India', ms: 400, id: 'country' },"
if old2 in c:
    c = c.replace(old2, new2)
    print('Country val FIXED - now uses profile.country')
else:
    print('Country val not found literal - trying regex pattern...')
    idx2 = c.find("id: 'country' },")
    if idx2 > 0:
        print('country line ctx:', c[idx2-80:idx2+20])

with open(path,'w',encoding='utf-8') as f:
    f.write(c)
print('Done. Size:', len(c))
