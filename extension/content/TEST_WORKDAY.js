// ============================================
// WORKDAY APPLICATION QUESTIONS - TEST SCRIPT
// ============================================
// Run this in the browser console on a Workday Application Questions page
// to verify the autofill system works correctly

console.log('%c=== WORKDAY AUTOFILL TEST ===', 'color: blue; font-weight: bold; font-size: 16px');

// Test 1: Check if script loaded
console.log('\n%c[TEST 1] Script Loading', 'color: green; font-weight: bold');
console.log('Page URL:', window.location.href);
console.log('Is Workday page?', window.location.href.includes('workday'));

// Test 2: Check helper functions
console.log('\n%c[TEST 2] Helper Functions', 'color: green; font-weight: bold');
const helpers = {
    'window.delay': typeof window.delay !== 'undefined',
    'window.showToast': typeof window.showToast !== 'undefined',
    'window.isFieldFillable': typeof window.isFieldFillable !== 'undefined',
    'window.fillField': typeof window.fillField !== 'undefined',
    'window.getLabelForElement': typeof window.getLabelForElement !== 'undefined',
    'window.isAIQuestion': typeof window.isAIQuestion !== 'undefined',
    'window.getAIAnswer': typeof window.getAIAnswer !== 'undefined'
};
console.table(helpers);
const allHelpersLoaded = Object.values(helpers).every(v => v === true);
console.log('All helpers loaded?', allHelpersLoaded ? '" YES' : '- NO');

// Test 3: Check message listener
console.log('\n%c[TEST 3] Message Listener', 'color: green; font-weight: bold');
const hasListener = chrome.runtime.onMessage.hasListeners();
console.log('Message listener registered?', hasListener ? '" YES' : '- NO');

// Test 4: Find Application Questions
console.log('\n%c[TEST 4] Application Questions Detection', 'color: green; font-weight: bold');
const questionButtons = Array.from(document.querySelectorAll('button[aria-haspopup="listbox"]')).filter(b => {
    return b.textContent.includes('Select One') && b.id.includes('primaryQuestionnaire');
});
console.log('Dropdown questions found:', questionButtons.length);
console.log('Question IDs:', questionButtons.map(b => b.id));

// Test 5: Extract question text
console.log('\n%c[TEST 5] Question Text Extraction', 'color: green; font-weight: bold');
if (questionButtons.length > 0) {
    const container = questionButtons[0];
    for (let i = 0; i < 10; i++) {
        container = container.parentElement;
    }
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, null, false);
    let node;
    const texts = [];
    while (node = walker.nextNode()) {
        const text = node.textContent.trim();
        if (text && text.includes('?') && text.length > 30 && !text.includes('Select One')) {
            texts.push(text.substring(0, 100));
        }
    }
    console.log('Questions extracted:', texts.length);
    texts.slice(0, 3).forEach((q, i) => console.log(  . ...));
}

// Test 6: Check backend availability
console.log('\n%c[TEST 6] Backend Connection', 'color: green; font-weight: bold');
fetch('http://127.0.0.1:5000/api/health')
    .then(r => r.json())
    .then(data => {
        console.log('" Backend is online:', data);
        console.log('AI Model:', data.ai_model || 'Unknown');
    })
    .catch(err => {
        console.error('- Backend is offline:', err.message);
        console.log('Make sure to run: python main.py');
    });

// Test 7: Check profile availability
console.log('\n%c[TEST 7] Profile Data', 'color: green; font-weight: bold');
chrome.storage.local.get(['userProfile', 'selectedProfile'], result => {
    const profile = result.userProfile || result.selectedProfile;
    if (profile) {
        console.log('" Profile loaded');
        console.log('  Name:', profile.first_name, profile.last_name);
        console.log('  Skills:', profile.skills?.length || 0);
        console.log('  Experience:', profile.experience?.length || 0);
    } else {
        console.error('- No profile found! Please upload resume first.');
    }
});

// Test 8: Manual trigger test
console.log('\n%c[TEST 8] Manual Trigger', 'color: green; font-weight: bold');
console.log('To manually trigger autofill, run:');
console.log('%cchrome.runtime.sendMessage({type: "PERFORM_AUTO_FILL"});', 'color: blue; background: #f0f0f0; padding: 5px');

console.log('\n%c=== TEST COMPLETE ===', 'color: blue; font-weight: bold; font-size: 16px');
console.log('If all tests pass, click the Autofill button in the extension popup.');

