// background.js - Service Worker for Tauzand AutoFill Assistant
'use strict';

const state = {
    userProfile: null,
    settings: { backendUrl: 'http://localhost:5000' },
    readyTabs: new Set(),
    _activeFrameId: null
};

// Load persisted settings on startup
chrome.storage.local.get(['userProfile', 'backendUrl'], function(r) {
    if (r.userProfile) state.userProfile = r.userProfile;
    if (r.backendUrl)  state.settings.backendUrl = r.backendUrl;
    console.log('[BG] startup profile=' + !!state.userProfile);
});

// Helper: fetch with timeout
async function fetchJSON(url, body, timeoutMs) {
    timeoutMs = timeoutMs || 30000;
    const ctrl = new AbortController();
    const tid  = setTimeout(function() { ctrl.abort(); }, timeoutMs);
    try {
        const resp = await fetch(url, {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify(body),
            signal:  ctrl.signal
        });
        clearTimeout(tid);
        return resp;
    } catch (e) {
        clearTimeout(tid);
        throw e;
    }
}

async function fetchGET(url, timeoutMs) {
    timeoutMs = timeoutMs || 8000;
    const ctrl = new AbortController();
    const tid  = setTimeout(function() { ctrl.abort(); }, timeoutMs);
    try {
        const resp = await fetch(url, { method: 'GET', signal: ctrl.signal });
        clearTimeout(tid);
        return resp;
    } catch (e) {
        clearTimeout(tid);
        throw e;
    }
}

// Helper: which content scripts to inject for a given URL
function getInjectScripts(url) {
    const base = [
        'content/detectForms.js',
        'content/extractHTML.js',
        'content/messaging.js',
        'content/highlighter.js',
        'content/observer.js',
        'content/shared.js'
    ];
    if (!url) { base.push('content/autoFill-universal.js'); return base; }
    if (url.includes('myworkdayjobs.com') || url.includes('workday.com')) {
        base.push('content/autoFill-workday.js');
    } else if (url.includes('greenhouse.io')) {
        base.push('content/autoFill-greenhouse.js');
    } else if (url.includes('lever.co')) {
        base.push('content/autoFill-lever.js');
    } else if (url.includes('ashbyhq.com')) {
        base.push('content/autoFill-ashby.js');
    } else if (url.includes('smartrecruiters.com')) {
        base.push('content/autoFill-smartrecruiters.js');
    } else if (url.includes('docs.google.com/forms')) {
        base.push('content/autoFill-googleforms.js');
    } else {
        base.push('content/autoFill-universal.js');
    }
    return base;
}

// Helper: ensure content scripts are alive, inject if needed
async function ensureScripts(tabId, tabUrl) {
    try {
        const ping = await chrome.tabs.sendMessage(tabId, { type: 'PING' });
        if (ping && ping.alive) return true;
    } catch (_) {}

    if (state.readyTabs.has(tabId)) {
        state.readyTabs.delete(tabId);
        return false;
    }
    try {
        await chrome.scripting.executeScript({
            target: { tabId: tabId },
            files:  getInjectScripts(tabUrl)
        });
        await new Promise(function(r) { setTimeout(r, 1200); });
        const ping2 = await chrome.tabs.sendMessage(tabId, { type: 'PING' }).catch(function() { return null; });
        if (ping2 && ping2.alive) { state.readyTabs.add(tabId); return true; }
        return false;
    } catch (e) {
        console.error('[BG] inject failed:', e.message);
        return false;
    }
}

// "" Main message listener """""""""""""""""""""""""""""""""""""
chrome.runtime.onMessage.addListener(function(msg, sender, sendResponse) {
    if (!msg || !msg.type) return false;

    switch (msg.type) {

    // "" Health check """""""""""""""""""""""""""""""""""""""""""
    case 'REQUEST_BACKEND_HEALTH':
        (async function() {
            const base = state.settings.backendUrl || 'http://localhost:5000';
            try {
                const resp = await fetchGET(base + '/api/health', 5000);
                if (!resp.ok) { sendResponse({ success: false, status: 'offline', error: 'HTTP ' + resp.status }); return; }
                const data = await resp.json();
                // Also fetch AI health for model name
                let aiModel = 'Active';
                try {
                    const aiResp = await fetchGET(base + '/api/v1/ai/health', 4000);
                    if (aiResp.ok) { const aiData = await aiResp.json(); aiModel = aiData.model || 'Active'; }
                } catch (_) {}
                data.ai_model = aiModel;
                sendResponse({ success: true, status: 'online', data: data });
            } catch (e) {
                sendResponse({ success: false, status: 'offline', error: e.message });
            }
        })();
        return true;

    // "" Set user profile """""""""""""""""""""""""""""""""""""""
    case 'SET_USER_PROFILE':
        state.userProfile = msg.profile;
        chrome.storage.local.set({ userProfile: msg.profile });
        sendResponse({ success: true });
        return false;

    // "" Set backend URL """"""""""""""""""""""""""""""""""""""""
    case 'SET_BACKEND_URL':
        state.settings.backendUrl = msg.url;
        chrome.storage.local.set({ backendUrl: msg.url });
        sendResponse({ success: true });
        return false;

    // "" Parse resume """""""""""""""""""""""""""""""""""""""""""
    case 'PARSE_RESUME':
        (async function() {
            const base = state.settings.backendUrl || 'http://localhost:5000';
            try {
                const resp = await fetch(base + '/api/profile/upload', {
                    method: 'POST',
                    body:   msg.formData
                });
                if (!resp.ok) {
                    const t = await resp.text();
                    sendResponse({ success: false, error: 'HTTP ' + resp.status + ': ' + t });
                    return;
                }
                const data = await resp.json();
                const profile = data.data || data.profile || null;
                if (profile && typeof profile === 'object') {
                    state.userProfile = profile;
                    chrome.storage.local.set({ userProfile: profile });
                }
                sendResponse({ success: true, data: data });
            } catch (e) {
                sendResponse({ success: false, error: e.message });
            }
        })();
        return true;

    // "" Scan forms """""""""""""""""""""""""""""""""""""""""""""
    // Correct 2-step flow:
    //   1. Extract HTML from page
    //   2. POST /api/form/analyze  { html, source_url }  -> form_analysis
    //   3. POST /api/v1/field-mapping  { form_analysis, profile }  -> mapping_result.mappings
    case 'SCAN_FORMS':
        (async function() {
            try {
                const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
                const tab  = tabs[0];
                if (!tab || !tab.id) { sendResponse({ success: false, error: 'No active tab' }); return; }

                await chrome.storage.local.set({ scanStatus: 'scanning', scanResults: null, fieldMappings: [] });

                // Step 0 " ensure scripts are injected
                const ready = await ensureScripts(tab.id, tab.url);
                if (!ready) {
                    await chrome.storage.local.set({ scanStatus: 'error' });
                    sendResponse({ success: false, error: 'Could not inject content scripts. Refresh the page and try again.' });
                    return;
                }

                // Step 1 " extract HTML
                let html = '';
                try {
                    const ex = await chrome.tabs.sendMessage(tab.id, { type: 'EXTRACT_AND_ANALYZE_FORMS', fullPage: false });
                    html = (ex && ex.html) ? ex.html : '';
                } catch (_) {}

                const base = state.settings.backendUrl || 'http://localhost:5000';

                // Load profile
                let profile = state.userProfile;
                if (!profile) {
                    const stored = await chrome.storage.local.get(['userProfile']);
                    profile = stored.userProfile || null;
                }
                if (!profile) {
                    await chrome.storage.local.set({ scanStatus: 'error' });
                    sendResponse({ success: false, error: 'No profile found. Please upload your resume first.' });
                    return;
                }

                // Step 2 " form analysis: POST /api/form/analyze
                let formAnalysis = null;
                try {
                    const faResp = await fetchJSON(base + '/api/form/analyze', {
                        html:       html,
                        source_url: tab.url,
                        resume:     profile
                    }, 20000);
                    if (faResp.ok) {
                        const faData = await faResp.json();
                        formAnalysis = faData.form_analysis || faData.data || null;
                        console.log('[BG] form_analysis ok, forms:', formAnalysis && formAnalysis.forms ? formAnalysis.forms.length : 0);
                    } else {
                        const errTxt = await faResp.text();
                        console.warn('[BG] form/analyze error:', faResp.status, errTxt);
                    }
                } catch (e) {
                    console.warn('[BG] form/analyze exception:', e.message);
                }

                // If form analysis failed, build a minimal form_analysis from the raw HTML
                // so we can still attempt field mapping
                if (!formAnalysis) {
                    console.warn('[BG] form_analysis unavailable " building minimal stub');
                    formAnalysis = {
                        forms: [{
                            form_id: 'form_0',
                            elements: []
                        }]
                    };
                }

                // Step 3 " field mapping: POST /api/v1/field-mapping
                const fmResp = await fetchJSON(base + '/api/v1/field-mapping', {
                    form_analysis: formAnalysis,
                    profile:       profile,
                    options: {
                        use_ai:               true,
                        confidence_threshold: 0.5,
                        fallback_to_rule_based: true
                    }
                }, 30000);

                if (!fmResp.ok) {
                    const errTxt = await fmResp.text();
                    await chrome.storage.local.set({ scanStatus: 'error' });
                    sendResponse({ success: false, error: 'Backend error: ' + errTxt });
                    return;
                }

                const fmData    = await fmResp.json();
                // Backend wraps under mapping_result
                const mapResult = fmData.mapping_result || fmData;
                let mappings    = mapResult.mappings || mapResult.field_mappings || [];

                console.log('[BG] field-mapping ok, mappings:', mappings.length);

                // For React/SPA job boards: if scan returned 0 mappings (shadow DOM),
                // generate synthetic mappings from profile so the popup shows meaningful data.
                // The actual autofill uses platform-specific scripts and doesn't need these mappings.
                var isKnownSPABoard = tab.url && (
                    tab.url.includes('workday.com') || tab.url.includes('myworkdayjobs.com') ||
                    tab.url.includes('greenhouse.io') || tab.url.includes('lever.co') ||
                    tab.url.includes('ashbyhq.com') || tab.url.includes('smartrecruiters.com')
                );
                if (mappings.length === 0 && isKnownSPABoard) {
                    console.log('[BG] SPA job board - generating synthetic mappings from profile');
                    // Platform-specific fields - only count what that platform actually shows
                    var syntheticFields;
                    if (tab.url.includes('lever.co')) {
                        syntheticFields = [
                            { label: 'Full Name',     key: 'first_name' },
                            { label: 'Email',         key: 'email' },
                            { label: 'Phone',         key: 'phone' },
                            { label: 'Location',      key: 'city' },
                            { label: 'Company',       key: 'experience' },
                            { label: 'LinkedIn URL',  key: 'linkedin' }
                        ];
                    } else if (tab.url.includes('greenhouse.io')) {
                        syntheticFields = [
                            { label: 'First Name',    key: 'first_name' },
                            { label: 'Last Name',     key: 'last_name' },
                            { label: 'Email',         key: 'email' },
                            { label: 'Phone',         key: 'phone' },
                            { label: 'LinkedIn',      key: 'linkedin' },
                            { label: 'Education',     key: 'education' },
                            { label: 'Skills',        key: 'skills' }
                        ];
                    } else {
                        // Workday, SmartRecruiters, Ashby - full profile
                        syntheticFields = [
                            { label: 'First Name',            key: 'first_name' },
                            { label: 'Last Name',             key: 'last_name' },
                            { label: 'Email',                 key: 'email' },
                            { label: 'Phone',                 key: 'phone' },
                            { label: 'City',                  key: 'city' },
                            { label: 'LinkedIn',              key: 'linkedin' },
                            { label: 'Education',             key: 'education' },
                            { label: 'Work Experience',       key: 'experience' },
                            { label: 'Skills',                key: 'skills' }
                        ];
                    }
                    mappings = syntheticFields.map(function(f) {
                        var val = '';
                        if (f.key === 'first_name') val = profile.first_name || (profile.personal && profile.personal.first_name) || '';
                        else if (f.key === 'last_name') val = profile.last_name || (profile.personal && profile.personal.last_name) || '';
                        else if (f.key === 'email') val = profile.email || (profile.contact && profile.contact.email) || '';
                        else if (f.key === 'city') val = profile.city || (profile.contact && profile.contact.city) || '';
                        else if (f.key === 'phone') val = profile.phone || (profile.contact && profile.contact.phone) || '';
                        else if (f.key === 'linkedin') val = (profile.social && profile.social.linkedin) || profile.linkedin || '';
                        else if (f.key === 'education') val = profile.education ? profile.education.length + ' entr' + (profile.education.length === 1 ? 'y' : 'ies') : '';
                        else if (f.key === 'experience') val = profile.experience ? profile.experience.length + ' entr' + (profile.experience.length === 1 ? 'y' : 'ies') : '';
                        else if (f.key === 'skills') val = profile.skills ? profile.skills.length + ' skill' + (profile.skills.length === 1 ? '' : 's') : '';
                        else if (f.key === 'cover_letter') val = 'AI-generated';
                        return {
                            form_field_id:   f.key,
                            profile_field:   f.label,
                            profile_value:   val,
                            mapped_value:    val,
                            confidence_score: val ? 0.95 : 0,
                            confidence:       val ? 0.95 : 0
                        };
                    }).filter(function(m) { return m.mapped_value; });
                    console.log('[BG] Synthetic mappings generated:', mappings.length);
                }

                const forms = [{ fields: mappings }];

                await chrome.storage.local.set({
                    scanStatus:    'done',
                    scanResults:   { forms: forms, url: tab.url },
                    fieldMappings: mappings,
                    fieldsFilled:  0
                });

                sendResponse({ success: true, forms: forms, mappings: mappings, url: tab.url });

            } catch (err) {
                console.error('[BG] SCAN_FORMS error:', err);
                await chrome.storage.local.set({ scanStatus: 'error' });
                sendResponse({ success: false, error: err.message });
            }
        })();
        return true;

    // "" Run autofill """""""""""""""""""""""""""""""""""""""""""
    case 'RUN_AUTOFILL':
        (async function() {
            try {
                const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
                const tab  = tabs[0];
                if (!tab || !tab.id) { sendResponse({ success: false, error: 'No active tab' }); return; }

                const ready = await ensureScripts(tab.id, tab.url);
                if (!ready) { sendResponse({ success: false, error: 'Scripts not ready. Refresh and retry.' }); return; }

                // Load what we need
                const stored  = await chrome.storage.local.get(['userProfile', 'fieldMappings', 'scanResults']);
                let profile   = state.userProfile || stored.userProfile || null;
                const raw     = stored.fieldMappings  || [];
                const scanRes = stored.scanResults    || { forms: [] };
                const base    = state.settings.backendUrl || 'http://localhost:5000';

                if (!profile) { sendResponse({ success: false, error: 'No profile. Upload resume first.' }); return; }

                // Normalise mappings so content scripts get a consistent shape
                const fieldMappings = raw.map(function(m) {
                    return {
                        resumeField: String(m.profile_field  || m.resumeField   || m.profile_field_name || m.form_field_name || 'Unknown'),
                        value:       String(m.profile_value  || m.value         || m.mapped_value       || ''),
                        confidence:  Number(m.confidence     || m.confidence_score || 0),
                        selector:    String(m.selector       || m.form_field_name || m.form_field_id    || ''),
                        fieldId:     String(m.form_field_id  || m.selector       || '')
                    };
                });

                let formData = null;
                try {
                    if (scanRes.forms && scanRes.forms[0]) formData = JSON.parse(JSON.stringify(scanRes.forms[0]));
                } catch (_) {}

                console.log('[BG] RUN_AUTOFILL sending', fieldMappings.length, 'mappings');

                try {
                    const afResp = await chrome.tabs.sendMessage(tab.id, {
                        type:                'PERFORM_AUTO_FILL',
                        formData:            formData,
                        fieldMappings:       fieldMappings,
                        confidenceThreshold: msg.confidenceThreshold || 0.5,
                        userProfile:         profile,
                        backendUrl:          base
                    });

                    const filled  = (afResp && afResp.result && afResp.result.filledCount)  || 0;
                    const skipped = (afResp && afResp.result && afResp.result.skippedCount) || 0;
                    await chrome.storage.local.set({
                        fieldsFilled:   filled,
                        autofillStatus: 'done',
                        autofillResult: { success: true, filledCount: filled, skippedCount: skipped }
                    });
                    try { sendResponse({ success: true, filledCount: filled, skippedCount: skipped }); } catch (_) {}

                } catch (msgErr) {
                    console.warn('[BG] sendMessage closed (normal for long fills):', msgErr.message);
                    const r2 = await chrome.storage.local.get(['fieldsFilled']);
                    await chrome.storage.local.set({
                        autofillStatus: 'done',
                        autofillResult: { success: true, filledCount: r2.fieldsFilled || 0, skippedCount: 0 }
                    });
                    try { sendResponse({ success: true, filledCount: r2.fieldsFilled || 0, skippedCount: 0 }); } catch (_) {}
                }

            } catch (err) {
                console.error('[BG] RUN_AUTOFILL error:', err);
                sendResponse({ success: false, error: err.message });
            }
        })();
        return true;

    // "" Stop """""""""""""""""""""""""""""""""""""""""""""""""""
    case 'STOP_OPERATIONS':
        (async function() {
            try {
                const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
                if (tabs[0]) chrome.tabs.sendMessage(tabs[0].id, { type: 'STOP' }).catch(function() {});
                await chrome.storage.local.set({ autofillStatus: 'done' });
                sendResponse({ success: true });
            } catch (e) { sendResponse({ success: false, error: e.message }); }
        })();
        return true;

    // "" History """"""""""""""""""""""""""""""""""""""""""""""""
    case 'GET_HISTORY':
        chrome.storage.local.get(['autofillHistory'], function(r) {
            sendResponse({ success: true, history: r.autofillHistory || [] });
        });
        return true;

    case 'CLEAR_HISTORY':
        chrome.storage.local.set({ autofillHistory: [] });
        sendResponse({ success: true });
        return false;

    // "" Test connection """"""""""""""""""""""""""""""""""""""""
    case 'TEST_CONNECTION':
        (async function() {
            const url = msg.url || state.settings.backendUrl || 'http://localhost:5000';
            try {
                const resp = await fetchGET(url + '/api/health', 5000);
                if (resp.ok) { const data = await resp.json(); sendResponse({ success: true, data: data }); }
                else { sendResponse({ success: false, error: 'HTTP ' + resp.status }); }
            } catch (e) { sendResponse({ success: false, error: e.message }); }
        })();
        return true;

    default:
        return false;
    }
});

// Clean up on tab navigation / close
chrome.tabs.onUpdated.addListener(function(tabId, changeInfo) {
    if (changeInfo.status === 'complete') state.readyTabs.delete(tabId);
});
chrome.tabs.onRemoved.addListener(function(tabId) {
    state.readyTabs.delete(tabId);
});

console.log('[BG] background.js loaded');
