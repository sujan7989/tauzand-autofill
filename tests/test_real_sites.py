"""
Real live site test — fills actual job application forms.
Demonstrates: resume parse → field map → autofill on real sites.
"""
import os, sys, time, json, glob, requests, pathlib
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

BACKEND_URL = "http://localhost:5000"


def get_profile():
    pdfs = glob.glob(os.path.expanduser('~/Downloads/Resume.pdf'))
    if pdfs:
        with open(pdfs[0], 'rb') as f:
            r = requests.post(f"{BACKEND_URL}/api/profile/upload",
                files={'resume': ('Resume.pdf', f, 'application/pdf')}, timeout=15)
        if r.ok:
            p = r.json().get('data', {})
            print(f"Resume: {p.get('name')} | {p.get('email')}")
            print(f"  Education : {[e.get('institution','')[:30] for e in p.get('education',[])]}")
            print(f"  Experience: {[e.get('title','')[:30] for e in p.get('experience',[])]}")
            return p
    return {}


def fill_all_inputs(page, profile, site_name=""):
    """Fill every input on the page using profile + AI."""
    filled = 0

    # Wait for actual inputs to appear (JS-rendered forms)
    try:
        page.wait_for_selector('input, textarea, select', timeout=8000)
        time.sleep(1)  # extra wait for all inputs to render
    except:
        pass

    # Check what inputs are actually visible
    input_count = page.evaluate("document.querySelectorAll('input,textarea,select').length")
    print(f"  DOM inputs found: {input_count}")

    # Get field mappings from backend using RENDERED HTML
    html = page.content()
    print(f"  HTML size: {len(html)} bytes")
    r = requests.post(f"{BACKEND_URL}/api/form/analyze",
                      json={'html': html[:200000], 'resume': profile,
                            'source_url': page.url}, timeout=20)
    mappings = []
    if r.ok:
        mappings = [m for m in r.json().get('mappings', []) if m.get('mapped_value')]
    print(f"  Backend: {len(mappings)} field mappings")

    # 2. Fill standard fields
    for m in mappings:
        val  = str(m['mapped_value'])
        fid  = str(m.get('form_field_id', ''))
        sel  = str(m.get('selector', m.get('form_field_name', '')))
        res  = str(m.get('profile_field_name', ''))
        leaf = res.split('.')[-1] if '.' in res else res

        css_list = [
            f'#{fid}', f'[name="{fid}"]', f'#{sel}', f'[name="{sel}"]',
            f'[name*="[{leaf}]"]', f'[aria-label="{leaf.replace("_"," ").title()}"]',
            f'[aria-label="{leaf.replace("_"," ")}"]',
            f'[id="{leaf}"]', f'[name="{leaf}"]',
            f'[id*="{leaf}"]', f'[name*="{leaf}"]',
        ]
        done = set()
        for css in css_list:
            try:
                for el in page.query_selector_all(css):
                    if not el.is_visible(): continue
                    uid = el.evaluate(
                        "e=>e.id+'|'+e.name+'|'+(e.getAttribute('aria-label')||'')")
                    if uid in done: continue
                    done.add(uid)
                    typ = el.evaluate("e=>(e.type||'').toLowerCase()")
                    tag = el.evaluate("e=>e.tagName.toLowerCase()")
                    if typ in ('file','submit','button','reset','hidden'): continue
                    if tag == 'select':
                        try: el.select_option(label=val, timeout=500)
                        except: pass
                    else:
                        el.click(timeout=500)
                        el.fill(val, timeout=500)
            except: pass
        if done:
            filled += len(done)
            print(f"    Filled {res}: {val[:50]}")

    # 3. AI open-ended questions
    try:
        textareas = page.query_selector_all('textarea, input[type="text"]')
        for ta in textareas:
            try:
                if not ta.is_visible(): continue
                cur = ta.evaluate("e=>e.value||''").strip()
                if cur: continue
                label = ta.evaluate("""e => {
                    let al = e.getAttribute('aria-label');
                    if (al) return al;
                    if (e.id) { let l = document.querySelector('label[for="'+e.id+'"]');
                                if (l) return l.textContent.trim(); }
                    let p = e.closest('[class*="field"],[class*="form-group"]');
                    if (p) { let l = p.querySelector('label,legend,h3,h4,span');
                             if (l) return l.textContent.trim(); }
                    return e.placeholder||'';
                }""")
                if not label or len(label) < 5: continue
                label_lower = label.lower()
                ai_triggers = ['cover letter','why','about yourself','describe','strength',
                               'additional','motivation','interest','project','tell us',
                               'headline','bio','summary','message','introduce']
                if not any(t in label_lower for t in ai_triggers): continue

                r2 = requests.post(f"{BACKEND_URL}/api/v1/ai/answer-question",
                    json={'question': label, 'field_label': label,
                          'field_type': 'textarea', 'profile': profile,
                          'context': {'company_name': site_name,
                                      'job_title': 'Software Engineer Intern'}},
                    timeout=12)
                if r2.ok:
                    answer = r2.json().get('answer', '')
                    if answer and len(answer) > 20:
                        ta.click(timeout=500)
                        ta.fill(answer[:600], timeout=500)
                        print(f"    AI: {label[:50]} [{len(answer)} chars]")
                        filled += 1
            except: pass
    except: pass

    return filled


def run():
    from playwright.sync_api import sync_playwright

    print("=" * 60)
    print("TAUZAND - REAL SITE AUTOFILL TEST")
    print("=" * 60)

    profile = get_profile()
    if not profile:
        print("ERROR: Resume upload failed - is backend running?")
        return

    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=False, slow_mo=150)
        page = browser.new_page()
        page.set_viewport_size({"width": 1280, "height": 900})

        # ── TEST 1: Lever (most standard ATS, direct apply link) ────────────────
        print("\n[TEST 1] Lever - Standard apply form")
        try:
            # Use a real public Lever apply page
            page.goto("https://jobs.lever.co/vercel/3db1ccf7-5cfe-4bcd-97b0-3524d27df40e/apply",
                      timeout=25000, wait_until='networkidle')
            time.sleep(4)
            n = fill_all_inputs(page, profile, "Vercel")
            page.screenshot(path="tests/lever_result.png", full_page=True)
            print(f"  RESULT: {n} fields filled | Screenshot: lever_result.png")
        except Exception as e:
            print(f"  SKIP: {type(e).__name__}: {str(e)[:80]}")

        # ── TEST 2: Greenhouse (standard bracket notation) ─────────────────────
        print("\n[TEST 2] Greenhouse - apply form")
        try:
            page.goto("https://boards.greenhouse.io/cloudflare/jobs/6250412",
                      timeout=25000, wait_until='networkidle')
            time.sleep(3)
            n = fill_all_inputs(page, profile, "Cloudflare")
            page.screenshot(path="tests/greenhouse_result.png", full_page=True)
            print(f"  RESULT: {n} fields filled | Screenshot: greenhouse_result.png")
        except Exception as e:
            print(f"  SKIP: {type(e).__name__}: {str(e)[:80]}")

        # ── TEST 3: SmartRecruiters (shadow DOM) ──────────────────────────────
        print("\n[TEST 3] SmartRecruiters (Wise Apply)")
        try:
            page.goto(
                "https://jobs.smartrecruiters.com/oneclick-ui/company/Wise/publication/"
                "33a82fdc-aeed-4fb8-8897-c853f45ac79e?dcr_ci=Wise",
                timeout=25000, wait_until='networkidle')
            time.sleep(5)
            n = fill_all_inputs(page, profile, "Wise")
            page.screenshot(path="tests/smartrecruiters_result.png", full_page=True)
            print(f"  RESULT: {n} fields filled | Screenshot: smartrecruiters_result.png")
        except Exception as e:
            print(f"  SKIP: {type(e).__name__}: {str(e)[:80]}")

        print("\n" + "=" * 60)
        print("All screenshots saved in tests/ folder")
        print("=" * 60)

        time.sleep(3)
        browser.close()


if __name__ == '__main__':
    run()
