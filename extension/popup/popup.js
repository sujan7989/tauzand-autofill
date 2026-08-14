// popup.js - Tauzand AutoFill Assistant Popup

// "" State """""""""""""""""""""""""""""""""""""""""""""""""""""
var state = {
    currentScreen: 'home',
    backendStatus: 'unknown',
    profile: null,
    scanData: {
        website: null,
        confidence: 0,
        detected: 0,
        missing: 0,
        fields: [],
        fieldMappings: []
    },
    autofillResults: { filled: 0, skipped: 0, failed: 0, time: 0 },
    settings: {
        backendUrl: 'https://tauzand-autofill.onrender.com',
        darkMode: true,
        notifications: true
    }
};

// "" Screen navigation """"""""""""""""""""""""""""""""""""""""""
function showScreen(screenId) {
    document.querySelectorAll('.popup-screen').forEach(function(s) {
        s.classList.remove('active');
    });
    var target = document.getElementById(screenId);
    if (target) {
        target.classList.add('active');
        state.currentScreen = screenId;
    }
    document.querySelectorAll('.nav-tab').forEach(function(tab) {
        tab.classList.toggle('active', tab.dataset.tab === screenId);
    });
}

function showError(msg) {
    var toast = document.createElement('div');
    toast.className = 'toast toast-error';
    toast.textContent = msg;
    var container = document.getElementById('toast-container');
    if (container) {
        container.appendChild(toast);
        setTimeout(function() { toast.remove(); }, 4000);
    }
    console.error('[Popup]', msg);
}

function showToast(msg, type) {
    type = type || 'info';
    var toast = document.createElement('div');
    toast.className = 'toast toast-' + type;
    toast.textContent = msg;
    var container = document.getElementById('toast-container');
    if (container) {
        container.appendChild(toast);
        setTimeout(function() { toast.remove(); }, 3000);
    }
}

// "" Backend status """""""""""""""""""""""""""""""""""""""""""""
async function checkBackendStatus() {
    try {
        var response = await chrome.runtime.sendMessage({ type: 'REQUEST_BACKEND_HEALTH' });
        if (response && response.success) {
            state.backendStatus = 'online';
            updateBackendStatusUI('online', response.data);
            return true;
        } else {
            state.backendStatus = 'offline';
            updateBackendStatusUI('offline');
            return false;
        }
    } catch (e) {
        state.backendStatus = 'offline';
        updateBackendStatusUI('offline');
        return false;
    }
}

function updateBackendStatusUI(status, data) {
    var indicator = document.getElementById('backend-status-indicator');
    var label = document.getElementById('backend-status-label');
    var dot = document.getElementById('header-status-dot');

    if (indicator) {
        indicator.className = 'backend-status-indicator ' + (status === 'online' ? 'status-online' : 'status-offline');
    }
    if (label) {
        label.textContent = status === 'online' ? 'Connected' : 'Offline';
    }
    if (dot) {
        dot.className = 'header-status-dot ' + (status === 'online' ? 'dot-online' : 'dot-offline');
    }

    if (data && status === 'online') {
        var aiModel = document.getElementById('backend-ai-model');
        var version = document.getElementById('backend-version');
        var latency = document.getElementById('backend-latency');
        if (aiModel) aiModel.textContent = data.ai_model || data.model || 'Active';
        if (version) version.textContent = data.version || '1.0.0';
        if (latency) latency.textContent = data.latency ? data.latency + 'ms' : 'N/A';
    }
}

// "" Profile handling """""""""""""""""""""""""""""""""""""""""""
async function loadStoredProfile() {
    var stored = await chrome.storage.local.get(['userProfile']);
    if (stored.userProfile) {
        state.profile = stored.userProfile;
        updateProfileUI(stored.userProfile);
    }
}

function updateProfileUI(profile) {
    if (!profile) return;
    var nameEl = document.getElementById('profile-name');
    var metaEl = document.getElementById('profile-meta');
    var settingProfile = document.getElementById('setting-profile');

    var name = profile.name ||
        ((profile.first_name || '') + ' ' + (profile.last_name || '')).trim() ||
        'Profile Loaded';

    if (nameEl) nameEl.textContent = name;
    if (metaEl) {
        // Skills can be at root level or nested
        var skillsArr = profile.skills || (profile.personal && profile.personal.skills) || [];
        var expArr    = profile.experience || [];
        var eduArr    = profile.education  || [];
        var skills = Array.isArray(skillsArr) ? skillsArr.length : 0;
        var exp    = Array.isArray(expArr)    ? expArr.length    : 0;
        var edu    = Array.isArray(eduArr)    ? eduArr.length    : 0;

        if (skills > 0 || exp > 0) {
            metaEl.textContent = skills + ' skills | ' + exp + ' experience';
        } else if (profile.email || (profile.contact && profile.contact.email)) {
            // Profile has contact info even if skills/exp not parsed
            metaEl.textContent = 'Resume loaded - ' + (profile.email || profile.contact.email);
        } else {
            metaEl.textContent = 'Resume loaded';
        }
    }
    if (settingProfile) settingProfile.textContent = name;
}

async function handleResumeUpload(file) {
    if (!file) return;
    var nameEl = document.getElementById('profile-name');
    var metaEl = document.getElementById('profile-meta');
    if (nameEl) nameEl.textContent = 'Parsing resume...';
    if (metaEl) metaEl.textContent = 'Please wait...';
    var backendUrl = state.settings.backendUrl || 'https://tauzand-autofill.onrender.com';
    // Check backend is reachable first
    try {
        var healthCheck = await fetch(backendUrl + '/api/health', { method: 'GET' });
        if (!healthCheck.ok) throw new Error('not ready');
    } catch (healthErr) {
        showError('Backend is offline. Start the server: python main.py');
        if (nameEl) nameEl.textContent = 'Upload Failed';
        if (metaEl) metaEl.textContent = 'Backend offline - click to retry';
        return;
    }
    try {
        var formData = new FormData();
        formData.append('resume', file);
        var resp = await fetch(backendUrl + '/api/profile/upload', {
            method: 'POST',
            body: formData
        });
        if (!resp.ok) {
            var errText = await resp.text();
            throw new Error('HTTP ' + resp.status + ': ' + errText);
        }
        var data = await resp.json();
        var profile = data.data || data.profile || data;

        // Accept profile if we got ANY meaningful data from the server
        // The parser may return name/email/skills even if first_name is empty
        var hasAnyData = profile && (
            profile.first_name || profile.name || profile.email ||
            profile.phone || profile.skills ||
            (profile.contact && (profile.contact.email || profile.contact.phone)) ||
            (profile.personal && profile.personal.first_name) ||
            profile.summary || profile.experience || profile.education
        );

        if (hasAnyData) {
            state.profile = profile;
            await chrome.storage.local.set({ userProfile: profile });
            chrome.runtime.sendMessage({ type: 'SET_USER_PROFILE', profile: profile }).catch(function() {});
            updateProfileUI(profile);
            showToast('Resume loaded successfully!', 'success');
        } else {
            throw new Error('Server returned invalid profile data');
        }
    } catch (e) {
        console.error('[Popup] Resume upload failed:', e);
        showError('Resume upload failed: ' + e.message);
        if (nameEl) nameEl.textContent = 'Upload Failed';
        if (metaEl) metaEl.textContent = 'Try again';
    }
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// PLATFORM DETECTION - is this a dedicated platform site?
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function isDedicatedPlatform(url) {
    if (!url) return false;
    return ['myworkdayjobs.com','workday.com','greenhouse.io','lever.co',
            'ashbyhq.com','smartrecruiters.com','docs.google.com/forms']
        .some(function(s){ return url.includes(s); });
}

// For universal sites: ask the content script how many fields are visible
async function countPageFields() {
    try {
        var tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        var tab = tabs[0];
        if (!tab) return 0;
        // Use detectForms stored result
        var stored = await chrome.storage.local.get(['scanResults']);
        var forms  = (stored.scanResults && stored.scanResults.forms) || [];
        if (forms.length > 0 && forms[0].fields) return forms[0].fields.length;
        return 0;
    } catch(e) { return 0; }
}

// "" Scan """""""""""""""""""""""""""""""""""""""""""""""""""""""
async function startScan() {
    if (!state.profile) {
        var stored = await chrome.storage.local.get(['userProfile']);
        if (!stored.userProfile) {
            showError('Please upload your resume first.');
            return;
        }
        state.profile = stored.userProfile;
    }

    showScreen('scan-screen');
    var progress = document.getElementById('scan-progress');
    var subtitle = document.getElementById('scan-subtitle');
    var step1 = document.getElementById('step-1');
    var step2 = document.getElementById('step-2');
    var step3 = document.getElementById('step-3');

    if (progress) progress.style.width = '20%';
    if (subtitle) subtitle.textContent = 'Detecting forms...';
    if (step1) step1.classList.add('active');

    try {
        // Set scanning state
        await chrome.storage.local.set({ scanStatus: 'scanning', scanResults: null, fieldMappings: [] });

        chrome.runtime.sendMessage({ type: 'SCAN_FORMS' }, function(response) {
            if (chrome.runtime.lastError) {
                showError('Scan failed: ' + chrome.runtime.lastError.message);
                showScreen('home-screen');
                return;
            }
            if (!response || !response.success) {
                showError(response ? response.error : 'Scan failed');
                showScreen('home-screen');
                return;
            }
            // Handled by poller below
        });

        // Poll for scan completion
        var waited = 0;
        var maxWait = 60000;

        var poll = setInterval(async function() {
            waited += 500;

            var pct = Math.min(20 + (waited / maxWait) * 70, 90);
            if (progress) progress.style.width = pct + '%';

            if (waited > 10000 && step2) step2.classList.add('active');
            if (waited > 20000 && step3) step3.classList.add('active');

            var stored = await chrome.storage.local.get(['scanStatus', 'scanResults', 'fieldMappings']);

            if (stored.scanStatus === 'done') {
                clearInterval(poll);
                if (progress) progress.style.width = '100%';

                var mappings = stored.fieldMappings || [];
                var forms = (stored.scanResults && stored.scanResults.forms) || [];
                var url = (stored.scanResults && stored.scanResults.url) || '';

                state.scanData.fieldMappings = mappings;

                // For universal sites, backend returns 0 mappings but autofill-universal
                // directly reads the DOM. Use detectForms field count for UI accuracy.
                var isUniversal = !isDedicatedPlatform(url);
                if (isUniversal && mappings.length === 0) {
                    // detectForms already counted fields â€” use that number
                    var detectedCount = 0;
                    try {
                        var dfStored = await chrome.storage.local.get(['scanResults']);
                        var allForms = (dfStored.scanResults && dfStored.scanResults.forms) || [];
                        // scanResults.forms[0].fields is the raw field count from detectForms
                        // but for universal we stored forms from backend (empty)
                        // Fall back: read fieldMappings length, or use a fixed estimate
                        detectedCount = 0; // will be updated after autofill
                    } catch(e) {}
                    state.scanData.detected    = detectedCount;
                    state.scanData.missing     = 0;
                    state.scanData.confidence  = 0; // will show as "Ready" not percentage
                    state.scanData.isUniversal = true;
                } else {
                    state.scanData.detected = mappings.length;
                    state.scanData.missing  = mappings.filter(function(m) {
                        var hasValue = m.value && m.value !== '' && m.value !== 'undefined';
                        var lowConf  = (m.confidence || 0) < 0.5;
                        return !hasValue && lowConf;
                    }).length;
                    state.scanData.confidence = mappings.length > 0
                        ? Math.round(mappings.reduce(function(s, m) { return s + (m.confidence || 0); }, 0) / mappings.length * 100)
                        : 0;
                    state.scanData.isUniversal = false;
                }

                try {
                    state.scanData.website = new URL(url).hostname;
                } catch (e) {
                    state.scanData.website = url || 'Current Page';
                }

                setTimeout(function() { showAnalysisScreen(); }, 300);

            } else if (stored.scanStatus === 'error' || waited >= maxWait) {
                clearInterval(poll);
                showError('Scan timed out or failed. Try again.');
                showScreen('home-screen');
            }
        }, 500);

    } catch (e) {
        showError('Scan failed: ' + e.message);
        showScreen('home-screen');
    }
}

function showAnalysisScreen() {
    var websiteName = document.getElementById('website-name');
    var websiteUrl  = document.getElementById('website-url');
    var confidence  = document.getElementById('analysis-confidence');
    var badge       = document.getElementById('confidence-badge');
    var detected    = document.getElementById('fields-detected');
    var missing     = document.getElementById('missing-count');

    if (websiteName) websiteName.textContent = state.scanData.website || 'Current Page';
    if (websiteUrl)  websiteUrl.textContent  = state.scanData.website || '';

    if (state.scanData.isUniversal) {
        // Universal site: autofill-universal.js handles it directly via DOM
        // Don't show 0% â€” show "Auto" with a positive message
        if (confidence) confidence.textContent = 'Auto';
        if (badge) { badge.textContent = 'Smart Fill Ready'; badge.className = 'confidence-badge confidence-high'; }
        if (detected) detected.textContent = '-';
        if (missing)  missing.textContent  = '-';
        // Update the stat labels to be more informative
        var detectedLabel = document.querySelector('.stat-detected .stat-label');
        var missingLabel  = document.querySelector('.stat-missing .stat-label');
        var detectedBadge = document.querySelector('.stat-detected .stat-badge');
        var missingBadge  = document.querySelector('.stat-missing .stat-badge');
        if (detectedLabel) detectedLabel.textContent = 'Fields';
        if (missingLabel)  missingLabel.textContent  = 'AI Assist';
        if (detected) detected.textContent = 'v';
        if (missing)  missing.textContent  = 'v';
        if (detectedBadge) { detectedBadge.textContent = 'Auto-Detect'; detectedBadge.className = 'stat-badge stat-badge-green'; }
        if (missingBadge)  { missingBadge.textContent  = 'Enabled';     missingBadge.className  = 'stat-badge stat-badge-green'; }
    } else {
        if (confidence) confidence.textContent = state.scanData.confidence + '%';
        if (detected)   detected.textContent   = state.scanData.detected;
        if (missing)    missing.textContent    = state.scanData.missing;

        if (badge) {
            var c = state.scanData.confidence;
            if (c >= 85) { badge.textContent = 'Excellent Match'; badge.className = 'confidence-badge confidence-high'; }
            else if (c >= 65) { badge.textContent = 'Good Match'; badge.className = 'confidence-badge confidence-medium'; }
            else { badge.textContent = 'Low Confidence'; badge.className = 'confidence-badge confidence-low'; }
        }
        // Reset labels to default in case they were changed
        var dl = document.querySelector('.stat-detected .stat-label');
        var ml = document.querySelector('.stat-missing .stat-label');
        var db = document.querySelector('.stat-detected .stat-badge');
        var mb = document.querySelector('.stat-missing .stat-badge');
        if (dl) dl.textContent = 'Detected';
        if (ml) ml.textContent = 'Missing';
        if (db) { db.textContent = 'Needs Review'; db.className = 'stat-badge stat-badge-orange'; }
        if (mb) { mb.textContent = 'Required';     mb.className = 'stat-badge stat-badge-red'; }
    }

    // Populate AI questions count and skills matched
    var aiCount = document.getElementById('ai-questions-count');
    var skillsCount = document.getElementById('skills-matched');
    var AI_PAT = /cover letter|why do you|tell us about|describe your|motivat|challenge|interest in|message/i;
    var mappingsForCount = state.scanData.fieldMappings || [];
    if (aiCount) aiCount.textContent = mappingsForCount.filter(function(m){ return AI_PAT.test(m.label||m.field_name||''); }).length;
    if (skillsCount) skillsCount.textContent = mappingsForCount.filter(function(m){ return /skill/i.test(m.label||m.field_name||''); }).length;

    showScreen('analysis-screen');
}

// "" Autofill """""""""""""""""""""""""""""""""""""""""""""""""""
async function startAutofill() {
    showScreen('autofill-screen');
    await performRealAutofill();
}

async function performRealAutofill() {
    var progressFill = document.getElementById('autofill-progress');
    var progressText = document.getElementById('autofill-count');
    var currentField = document.getElementById('current-field');
    var startTime = Date.now();

    try {
        await chrome.storage.local.set({ autofillStatus: 'running', autofillResult: null });

        // Fire and forget - don't await (may take 30+ seconds for Workday)
        chrome.runtime.sendMessage({
            type: 'RUN_AUTOFILL',
            confidenceThreshold: 0.70
        }).then(function(response) {
            if (response) {
                chrome.storage.local.set({
                    autofillStatus: 'done',
                    autofillResult: response
                });
            }
        }).catch(function(err) {
            // Port closed is normal for long-running autofills
            chrome.storage.local.get(['fieldsFilled'], function(r) {
                chrome.storage.local.set({
                    autofillStatus: 'done',
                    autofillResult: {
                        success: true,
                        filledCount: r.fieldsFilled || 1,
                        skippedCount: 0
                    }
                });
            });
            console.warn('[Popup] sendMessage port closed (normal):', err.message);
        });

        // Poll storage every 500ms for up to 5 minutes
        var maxWait = 300000;
        var waited = 0;

        while (waited < maxWait) {
            await new Promise(function(r) { setTimeout(r, 500); });
            waited += 500;

            var pct = Math.min(10 + (waited / maxWait) * 85, 95);
            if (progressFill) progressFill.style.width = pct + '%';
            if (currentField) currentField.textContent = 'Filling... (' + Math.round(waited / 1000) + 's)';

            var stored = await chrome.storage.local.get(['autofillStatus', 'autofillResult', 'fieldsFilled']);
            if (stored.autofillStatus === 'done') {
                var result = stored.autofillResult || { success: true, filledCount: 0, skippedCount: 0 };
                // For universal sites, autofill-universal.js writes fieldsFilled directly
                // Prefer fieldsFilled from storage as it's the most accurate count
                var actualFilled = stored.fieldsFilled || result.filledCount || 0;
                state.autofillResults.filled  = actualFilled;
                state.autofillResults.skipped = result.skippedCount || 0;
                state.autofillResults.failed  = result.failedCount  || 0;
                state.autofillResults.time    = ((Date.now() - startTime) / 1000).toFixed(1);

                // Update detected count for universal sites now that we know real fill count
                if (state.scanData.isUniversal) {
                    state.scanData.detected = actualFilled;
                }

                if (progressFill) progressFill.style.width = '100%';
                if (progressText) progressText.textContent = state.autofillResults.filled + ' / ' + state.scanData.detected;
                if (currentField) currentField.textContent = 'Completed';

                await saveToHistory();
                setTimeout(function() { showSuccessScreen(); }, 300);
                return;
            }
        }

        // Timeout â€” use whatever fieldsFilled is in storage
        var s2 = await chrome.storage.local.get(['fieldsFilled', 'autofillResult']);
        var timeoutFilled = s2.fieldsFilled || (s2.autofillResult && s2.autofillResult.filledCount) || 0;
        state.autofillResults.filled = timeoutFilled;
        if (state.scanData.isUniversal) state.scanData.detected = timeoutFilled;
        state.autofillResults.time = ((Date.now() - startTime) / 1000).toFixed(1);
        if (progressFill) progressFill.style.width = '100%';
        if (currentField) currentField.textContent = 'Completed';
        await saveToHistory();
        setTimeout(function() { showSuccessScreen(); }, 300);

    } catch (e) {
        console.error('[Popup] Autofill failed:', e);
        // Populate AI questions count and skills matched
    var aiCount = document.getElementById('ai-questions-count');
    var skillsCount = document.getElementById('skills-matched');
    var AI_PAT = /cover letter|why do you|tell us about|describe your|motivat|challenge|interest in|message/i;
    var mappingsForCount = state.scanData.fieldMappings || [];
    if (aiCount) aiCount.textContent = mappingsForCount.filter(function(m){ return AI_PAT.test(m.label||m.field_name||''); }).length;
    if (skillsCount) skillsCount.textContent = mappingsForCount.filter(function(m){ return /skill/i.test(m.label||m.field_name||''); }).length;

    showScreen('analysis-screen');
        showError('Autofill failed: ' + e.message);
    }
}

function showSuccessScreen() {
    var filled  = document.getElementById('success-fields-filled');
    var skipped = document.getElementById('success-fields-skipped');
    var failed  = document.getElementById('success-fields-failed');
    var time    = document.getElementById('success-time-taken');
    if (filled)  filled.textContent  = state.autofillResults.filled;
    if (skipped) skipped.textContent = state.autofillResults.skipped;
    if (failed)  failed.textContent  = state.autofillResults.failed;
    if (time)    time.textContent    = state.autofillResults.time + 's';

    // For universal sites: now we know actual filled count, compute real confidence
    if (state.scanData.isUniversal && state.autofillResults.filled > 0) {
        var conf = document.getElementById('analysis-confidence');
        var badgeEl = document.getElementById('confidence-badge');
        // Each filled field = high confidence; estimate 90% for universal fills
        var computedConf = Math.min(95, 70 + state.autofillResults.filled * 2);
        state.scanData.confidence = computedConf;
        if (conf) conf.textContent = computedConf + '%';
        if (badgeEl) { badgeEl.textContent = 'Smart Fill Done'; badgeEl.className = 'confidence-badge confidence-high'; }
    }


    // Phase 2: Post-fill verification -- async, non-blocking
    try {
        chrome.tabs.query({ active:true, currentWindow:true }, function(tabs) {
            if (!tabs || !tabs[0]) return;
            chrome.tabs.sendMessage(tabs[0].id, { type:'VERIFY_PAGE_ERRORS' }, function(vr) {
                if (chrome.runtime.lastError || !vr || !vr.success) return;
                var r = vr.result; if (!r) return;
                state.verifyResult = r;
                if (r.errorCount > 0) {
                    var flds = r.errors.slice(0,3).map(function(e){return e.field;}).join(', ');
                    showToast(r.errorCount + ' field(s) may need attention: ' + flds, 'warn');
                    var failEl = document.getElementById('success-fields-failed');
                    if (failEl) failEl.textContent = r.errorCount;
                }
            });
        });
    } catch(ve) {}
    showScreen('success-screen');
}

// "" History """"""""""""""""""""""""""""""""""""""""""""""""""""
async function saveToHistory() {
    if (state.autofillResults.filled === 0) return;
    try {
        var tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        var tab = tabs[0];
        if (!tab) return;
        var url = new URL(tab.url);
        var item = {
            site:      url.hostname,
            url:       tab.url,
            timestamp: new Date().toISOString(),
            filled:    state.autofillResults.filled,
            skipped:   state.autofillResults.skipped,
            failed:    state.autofillResults.failed,
            time:      state.autofillResults.time,
            confidence: state.scanData.confidence,
            status:    state.autofillResults.failed === 0 ? 'success' : 'partial'
        };
        var stored = await chrome.storage.local.get(['autofillHistory']);
        var history = stored.autofillHistory || [];
        history.unshift(item);
        if (history.length > 50) history.pop();
        await chrome.storage.local.set({ autofillHistory: history });
        loadRecentActivity(); // refresh home screen activity list
    } catch (e) {
        console.warn('[Popup] saveToHistory error:', e.message);
    }
}

function loadRecentActivity() {
    chrome.storage.local.get(['autofillHistory'], function(stored) {
        var list = document.getElementById('activity-list');
        if (!list) return;
        var history = (stored.autofillHistory || []).slice(0, 3);
        if (history.length === 0) {
            list.innerHTML = '<div class="empty-state"><p>No recent activity</p></div>';
            return;
        }
        list.innerHTML = history.map(function(item) {
            var date    = new Date(item.timestamp);
            var timeStr = date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'});
            return '<div class="activity-item">' +
                '<div class="activity-icon">' +
                    '<svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M5 13l4 4L19 7" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/></svg>' +
                '</div>' +
                '<div class="activity-info">' +
                    '<div class="activity-site">' + (item.site||'Unknown site') + '</div>' +
                    '<div class="activity-time">' + item.filled + ' fields | ' + timeStr + '</div>' +
                '</div>' +
                '</div>';
        }).join('');
    });
}

function loadHistoryScreen() {
    chrome.storage.local.get(['autofillHistory'], function(stored) {
        var list = document.getElementById('history-list');
        if (!list) return;
        var history = stored.autofillHistory || [];
        if (history.length === 0) {
            list.innerHTML = '<div class="empty-state"><p>No Forms Filled Yet</p><p class="empty-subtitle">Scan a job page and click Autofill</p></div>';
            return;
        }
        list.innerHTML = history.map(function(item) {
            var date    = new Date(item.timestamp);
            var dateStr = date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'});
            var badgeClass = item.status === 'success' ? 'history-badge history-badge-success' : 'history-badge history-badge-failed';
            var badgeText  = item.status === 'success' ? 'Done' : 'Partial';
            return '<div class="history-item">' +
                '<div class="history-icon">' +
                    '<svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M5 13l4 4L19 7" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>' +
                '</div>' +
                '<div class="history-content">' +
                    '<div class="history-site">' + (item.site||'Unknown') + '</div>' +
                    '<div class="history-meta">' +
                        '<span>' + item.filled + ' fields filled</span>' +
                        '<span>-</span>' +
                        '<span>' + dateStr + '</span>' +
                        '<span class="' + badgeClass + '">' + badgeText + '</span>' +
                    '</div>' +
                '</div>' +
                '</div>';
        }).join('');
    });
}

// "" Preview mapping """"""""""""""""""""""""""""""""""""""""""""
function showPreviewScreen() {
    var list = document.getElementById('field-mapping-list');
    if (!list) { showScreen('preview-screen'); return; }

    var mappings = state.scanData.fieldMappings || [];
    if (mappings.length === 0) {
        list.innerHTML = '<div class="empty-state"><p>No mappings available</p></div>';
    } else {
        list.innerHTML = mappings.slice(0, 20).map(function(m) {
            var conf = Math.round((m.confidence || 0) * 100);
            return '<div class="field-card">' +
                '<div class="field-label">' + (m.resumeField || m.profile_field_name || 'Field') + '</div>' +
                '<div class="field-value">' + (m.value || m.mapped_value || '') + '</div>' +
                '<div class="field-confidence">' + conf + '%</div>' +
                '</div>';
        }).join('');
    }
    showScreen('preview-screen');
}

// "" Settings """""""""""""""""""""""""""""""""""""""""""""""""""
function loadSettings() {
    chrome.storage.local.get(['backendUrl', 'darkMode', 'notifications'], function(stored) {
        if (stored.backendUrl) {
            state.settings.backendUrl = stored.backendUrl;
            var urlInput = document.getElementById('setting-backend-url');
            if (urlInput) urlInput.value = stored.backendUrl;
        } else {
            // First install — set Render URL as default
            var defaultUrl = 'https://tauzand-autofill.onrender.com';
            state.settings.backendUrl = defaultUrl;
            chrome.storage.local.set({ backendUrl: defaultUrl });
            var urlInput = document.getElementById('setting-backend-url');
            if (urlInput) urlInput.value = defaultUrl;
        }
        // Load new behavior settings
        ['setting-fill-mode','setting-ai-mode','setting-confidence'].forEach(function(id) {
            var el = document.getElementById(id);
            if (el && stored[id]) el.value = stored[id];
        });
        var urlInput2 = document.getElementById('setting-backend-url');
        if (urlInput2 && !urlInput2.value) urlInput2.value = state.settings.backendUrl;

        var darkToggle = document.getElementById('toggle-dark-mode');
        if (darkToggle) darkToggle.checked = stored.darkMode !== false;

        var notifToggle = document.getElementById('toggle-notifications');
        if (notifToggle) notifToggle.checked = stored.notifications !== false;
    });
}

// "" Init """""""""""""""""""""""""""""""""""""""""""""""""""""""
document.addEventListener('DOMContentLoaded', async function() {
    // Load settings
    loadSettings();

    // Load profile
    await loadStoredProfile();

    // Check backend
    await checkBackendStatus();

    // Load recent activity on home screen from history
    loadRecentActivity();

    // Load history list
    loadHistoryScreen();

    // "" Button: Scan page """"""""""""""""""""""""""""""""""""""
    var btnScan = document.getElementById('btn-scan-page');
    if (btnScan) btnScan.addEventListener('click', startScan);

    // "" Button: Autofill """""""""""""""""""""""""""""""""""""""
    var btnAutofill = document.getElementById('btn-autofill');
    if (btnAutofill) btnAutofill.addEventListener('click', startAutofill);

    var btnAutofillPreview = document.getElementById('btn-autofill-from-preview');
    if (btnAutofillPreview) btnAutofillPreview.addEventListener('click', startAutofill);

    // "" Button: Preview mapping """"""""""""""""""""""""""""""""
    var btnPreview = document.getElementById('btn-preview-mapping');
    if (btnPreview) btnPreview.addEventListener('click', showPreviewScreen);

    // "" Button: Back to analysis """""""""""""""""""""""""""""""
    var btnBack = document.getElementById('btn-back-to-analysis');
    if (btnBack) btnBack.addEventListener('click', function() { showScreen('analysis-screen'); });

    // "" Button: Done (close success) """"""""""""""""""""""""""
    var btnDone = document.getElementById('btn-done');
    if (btnDone) btnDone.addEventListener('click', function() { showScreen('home-screen'); });

    // "" Button: View history """""""""""""""""""""""""""""""""""
    var btnHistory = document.getElementById('btn-view-history');
    if (btnHistory) btnHistory.addEventListener('click', function() {
        loadHistoryScreen();
        showScreen('history-screen');
    });

    // "" Button: Settings """""""""""""""""""""""""""""""""""""""
    var btnSettings = document.getElementById('btn-settings');
    if (btnSettings) btnSettings.addEventListener('click', function() {
        loadSettings();
        showScreen('settings-screen');
    });

    // "" Button: Test connection """"""""""""""""""""""""""""""""
    var btnTest = document.getElementById('btn-test-connection');
    if (btnTest) btnTest.addEventListener('click', async function() {
        var urlInput = document.getElementById('setting-backend-url');
        var url = urlInput ? urlInput.value.trim() : state.settings.backendUrl;
        state.settings.backendUrl = url;
        chrome.storage.local.set({ backendUrl: url });
        chrome.runtime.sendMessage({ type: 'SET_BACKEND_URL', url: url }).catch(function() {});
        var ok = await checkBackendStatus();
        showToast(ok ? 'Connected!' : 'Cannot connect to backend', ok ? 'success' : 'error');
    });

    // "" Backend URL input change """""""""""""""""""""""""""""""
    var urlInput = document.getElementById('setting-backend-url');
    if (urlInput) {
        urlInput.addEventListener('change', function() {
            var url = urlInput.value.trim();
            state.settings.backendUrl = url;
            chrome.storage.local.set({ backendUrl: url });
            chrome.runtime.sendMessage({ type: 'SET_BACKEND_URL', url: url }).catch(function() {});
        });
    }

    // "" Toggle: Dark mode """"""""""""""""""""""""""""""""""""""
    var darkToggle = document.getElementById('toggle-dark-mode');
    if (darkToggle) {
        darkToggle.addEventListener('change', function() {
            chrome.storage.local.set({ darkMode: darkToggle.checked });
            document.body.classList.toggle('light-mode', !darkToggle.checked);
        });
    }

    // "" Toggle: Notifications """"""""""""""""""""""""""""""""""
    var notifToggle = document.getElementById('toggle-notifications');
    if (notifToggle) {
        notifToggle.addEventListener('change', function() {
            chrome.storage.local.set({ notifications: notifToggle.checked });
        });
    }

    // "" Resume file input """"""""""""""""""""""""""""""""""""""
    var profileCard = document.getElementById('card-profile');
    var fileInput = document.getElementById('resume-file-input');

    if (profileCard && fileInput) {
        profileCard.addEventListener('click', function() { fileInput.click(); });
        fileInput.addEventListener('change', function(e) {
            var file = e.target.files && e.target.files[0];
            if (file) handleResumeUpload(file);
        });
    }

    // "" Nav tabs """""""""""""""""""""""""""""""""""""""""""""""
    document.querySelectorAll('.nav-tab').forEach(function(tab) {
        tab.addEventListener('click', function() {
            var target = tab.dataset.tab;
            if (target === 'history-screen') loadHistoryScreen();
            if (target === 'settings-screen') loadSettings();
            showScreen(target);
        });
    });

    // "" Platform detection """""""""""""""""""""""""""""""""""""
    await detectCurrentPlatform();

    // "" Button: Review fields """"""""""""""""""""""""""""""""""
    var btnReview = document.getElementById('btn-review-fields');
    if (btnReview) btnReview.addEventListener('click', showReviewScreen);

    // "" Button: Back from review """""""""""""""""""""""""""""""""
    var btnBackReview = document.getElementById('btn-back-review');
    if (btnBackReview) btnBackReview.addEventListener('click', function() { showScreen('analysis-screen'); });

    // "" Button: Autofill from review """""""""""""""""""""""""""""
    var btnAutofillReview = document.getElementById('btn-autofill-review');
    if (btnAutofillReview) btnAutofillReview.addEventListener('click', startAutofill);

    // "" Button: Rescan from review """""""""""""""""""""""""""""""
    var btnRescan = document.getElementById('btn-rescan');
    if (btnRescan) btnRescan.addEventListener('click', startScan);

    // "" Button: Quick autofill """"""""""""""""""""""""""""""""""""
    var btnQuickFill = document.getElementById('btn-quick-fill');
    if (btnQuickFill) btnQuickFill.addEventListener('click', function() {
        if (!state.profile) {
            showError('Please upload your resume first.');
            return;
        }
        startAutofill();
    });

    // "" Settings selects """""""""""""""""""""""""""""""""""""""""
    ['setting-fill-mode','setting-ai-mode','setting-confidence'].forEach(function(id) {
        var el = document.getElementById(id);
        if (el) {
            el.addEventListener('change', function() {
                var obj = {};
                obj[id] = el.value;
                chrome.storage.local.set(obj);
            });
        }
    });

    console.log('[Popup] Initialized');
});

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// PLATFORM DETECTION
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
var PLATFORM_MAP = [
    { patterns: ['myworkdayjobs.com','workday.com'],   name: 'Workday',          engine: 'Dedicated Engine' },
    { patterns: ['greenhouse.io','boards.greenhouse'], name: 'Greenhouse',       engine: 'Dedicated Engine' },
    { patterns: ['lever.co','jobs.lever.co'],          name: 'Lever',            engine: 'Dedicated Engine' },
    { patterns: ['ashbyhq.com','jobs.ashbyhq.com'],    name: 'Ashby',            engine: 'Dedicated Engine' },
    { patterns: ['smartrecruiters.com'],               name: 'SmartRecruiters',  engine: 'Dedicated Engine' },
    { patterns: ['keka.com'],                          name: 'Keka',             engine: 'Dedicated Engine' },
    { patterns: ['docs.google.com/forms'],             name: 'Google Forms',     engine: 'Google Forms Engine' }
];

var JOB_SIGNALS = ['job','career','apply','recruit','hiring','talent','application','jobs','vacancy','position'];

async function detectCurrentPlatform() {
    try {
        var tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        var tab = tabs[0];
        if (!tab || !tab.url) return;

        var url = tab.url.toLowerCase();
        var title = (tab.title || '').toLowerCase();
        var card = document.getElementById('card-platform');
        var dot  = document.getElementById('platform-dot');
        var lbl  = document.getElementById('platform-label');
        var badge= document.getElementById('platform-badge');
        var sub  = document.getElementById('platform-sub');
        var quickBtn = document.getElementById('btn-quick-fill');

        if (!card) return;

        // Check known platforms
        var matched = null;
        for (var i = 0; i < PLATFORM_MAP.length; i++) {
            var pm = PLATFORM_MAP[i];
            if (pm.patterns.some(function(p){ return url.includes(p); })) {
                matched = pm; break;
            }
        }

        if (matched) {
            card.style.display = '';
            dot.className  = 'platform-dot known';
            lbl.textContent = matched.name + ' detected';
            badge.textContent  = matched.engine;
            badge.className    = 'platform-badge badge-known';
            sub.textContent    = 'Using optimized ' + matched.name + ' adapter';
            quickBtn.style.display = '';
            return;
        }

        // Check for generic job/application signals
        var isJobSite = JOB_SIGNALS.some(function(s){ return url.includes(s) || title.includes(s); });
        if (isJobSite) {
            card.style.display = '';
            dot.className  = 'platform-dot universal';
            lbl.textContent = 'Job Application Detected';
            badge.textContent  = 'Universal Engine';
            badge.className    = 'platform-badge badge-universal';
            sub.textContent    = 'Smart field detection enabled';
            quickBtn.style.display = '';
            return;
        }

        // Not a job site â€” hide card
        card.style.display = 'none';
    } catch (e) {
        console.warn('[Popup] Platform detect error:', e.message);
    }
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// FIELD REVIEW SCREEN
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function showReviewScreen() {
    var table = document.getElementById('review-table');
    if (!table) { showScreen('field-review-screen'); return; }
    showScreen('field-review-screen');

    // Try to load Phase 3 uvDescriptors (from actual fill) first
    chrome.storage.local.get(['uvDescriptors', 'fieldMappings'], function(stored) {
        var descriptors = stored.uvDescriptors || [];
        var mappings    = stored.fieldMappings || state.scanData.fieldMappings || [];

        // Use descriptors if available (richer: has componentType, normalizedLabel)
        var rows = [];
        if (descriptors.length > 0) {
            rows = descriptors.slice(0, 40).map(function(d) {
                var conf       = Math.round((d.confidence || 0) * 100);
                var confClass  = conf >= 85 ? '' : conf >= 65 ? 'warn' : 'low';
                var value      = (d.value || '').substring(0, 25);
                var statusIcon = d.value ? '✓' : '--';
                var statusSty  = d.value ? 'color:var(--success)' : 'color:var(--text-tertiary)';
                var src        = d.source || 'Resume';
                return '<div class="review-row">' +
                    '<div class="review-field" title="'+d.label+'">' + (d.label||'').substring(0,28) + '</div>' +
                    '<div class="review-source">' + src + '</div>' +
                    '<div class="review-conf '+confClass+'">' + (conf>0?conf+'%':'--') + '</div>' +
                    '<div class="review-value" title="'+(d.value||'')+'">'+( value || '--' )+'</div>' +
                    '<div class="review-status" style="'+statusSty+'">'+statusIcon+'</div>' +
                    '</div>';
            });
        } else if (mappings.length > 0) {
            var AI_P = /cover letter|why do you|tell us about|describe your|motivat|challenge|interest in/i;
            rows = mappings.slice(0, 40).map(function(m) {
                var label = m.label || m.field_name || m.resumeField || 'Field';
                var val   = String(m.value || m.mapped_value || '').trim();
                var conf  = Math.round((m.confidence || 0) * 100);
                var src   = AI_P.test(label) ? 'AI' : (m.source || (val ? 'Resume' : '--'));
                var cc    = conf >= 85 ? '' : conf >= 65 ? 'warn' : 'low';
                var sty   = val ? 'color:var(--success)' : 'color:var(--text-tertiary)';
                return '<div class="review-row">' +
                    '<div class="review-field" title="'+label+'">'+label.substring(0,28)+'</div>' +
                    '<div class="review-source">'+src+'</div>' +
                    '<div class="review-conf '+cc+'">'+(conf>0?conf+'%':'--')+'</div>' +
                    '<div class="review-value" title="'+val+'">'+(val?val.substring(0,25):'--')+'</div>' +
                    '<div class="review-status" style="'+sty+'">'+(val?'✓':'--')+'</div>' +
                    '</div>';
            });
        }

        if (rows.length === 0) {
            table.innerHTML = state.scanData.isUniversal ?
                '<div class="review-empty">Fields auto-detected during fill.<br>Click Autofill to populate this list.</div>' :
                '<div class="review-empty">No field mappings yet.<br>Run a scan first.</div>';
        } else {
            table.innerHTML = rows.join('');
        }
    });
}

function runPostFillVerification() {
    try {
        chrome.tabs.query({ active:true, currentWindow:true }, function(tabs) {
            if (!tabs || !tabs[0]) return;
            chrome.tabs.sendMessage(tabs[0].id, { type:'VERIFY_PAGE_ERRORS' }, function(vr) {
                if (chrome.runtime.lastError || !vr || !vr.success) return;
                var r = vr.result; if (!r) return;
                state.verifyResult = r;
                console.log('[Popup] Verify complete: errors='+r.errorCount+' warnings='+r.warningCount);
                if (r.errorCount > 0) {
                    var flds = r.errors.slice(0,3).map(function(e){return e.field;}).join(', ');
                    showToast(r.errorCount+' field(s) may need attention: '+flds, 'warn');
                    // Update failed count on success screen if it's visible
                    if (state.currentScreen === 'success-screen') {
                        var failEl = document.getElementById('success-fields-failed');
                        if (failEl) failEl.textContent = r.errorCount;
                    }
                } else if (r.warningCount === 0) {
                    showToast('All fields verified successfully.', 'success');
                }
            });
        });
    } catch(ve) { console.warn('[Popup] Verification error:', ve.message); }
}
