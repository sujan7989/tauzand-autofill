"""
Playwright live browser test — fills ALL sections of the test page.
Sections: 1=standard, 2=Greenhouse brackets, 3=Workday aria-label,
          4=AI open-ended, 5=orphan inputs
Run: python tests/test_playwright_live.py
"""
import os, sys, time, json, pathlib, requests
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

BACKEND_URL = "http://localhost:5000"
TEST_PAGE   = os.path.abspath("tests/live_test_page.html")
RESUME_PDF  = os.path.expanduser("~/Downloads/ACC_Resume.pdf")

def run():
    from playwright.sync_api import sync_playwright

    print("=" * 60)
    print("TAUZAND AUTOFILL - LIVE PLAYWRIGHT TEST")
    print("=" * 60)

    # Step 1: Parse resume
    print("\nStep 1: Parsing resume...")
    profile = {}
    if os.path.exists(RESUME_PDF):
        try:
            with open(RESUME_PDF, 'rb') as f:
                r = requests.post(
                    f"{BACKEND_URL}/api/profile/upload",
                    files={'resume': (os.path.basename(RESUME_PDF), f, 'application/pdf')},
                    timeout=15)
            if r.ok:
                profile = r.json().get('data', {})
                print(f"  name={profile.get('name')!r}")
                print(f"  email={profile.get('email')!r}")
        except Exception as e:
            print(f"  Upload error: {e}")

    if not profile:
        profile = {
            'name': 'Akkisetty Sujan Kumar Reddy',
            'first_name': 'Akkisetty', 'last_name': 'Sujan Kumar Reddy',
            'email': 'sujankumarreddy824@gmail.com', 'phone': '+917989168768',
            'personal': {'full_name': 'Akkisetty Sujan Kumar Reddy',
                         'first_name': 'Akkisetty', 'last_name': 'Sujan Kumar Reddy'},
            'contact': {'email': 'sujankumarreddy824@gmail.com',
                        'phone': '+917989168768', 'city': 'Kurnool, Andhra'},
            'social': {'linkedin': 'https://www.linkedin.com/in/akkisetty-sujan-kumar-reddy-bb2744268/',
                       'github': 'https://github.com/sujan7989',
                       'portfolio': 'https://roaring-marzipan-d97e67.netlify.app/'},
            'skills': ['Python', 'Java', 'JavaScript', 'React', 'Flask'],
            'years_experience': 'Fresher',
        }
        print("  Using hardcoded profile")

    # Step 2: Get mappings
    print("\nStep 2: Getting field mappings...")
    html = pathlib.Path(TEST_PAGE).read_text(encoding='utf-8')
    r = requests.post(f"{BACKEND_URL}/api/form/analyze",
                      json={'html': html, 'resume': profile, 'source_url': 'test'},
                      timeout=20)
    if not r.ok:
        print(f"  FAIL: {r.status_code}")
        return

    data = r.json()
    norm = [
        {
            'res':  str(m.get('profile_field_name', '')),
            'val':  str(m.get('mapped_value', '')),
            'conf': float(m.get('confidence_score', 0)),
            'sel':  str(m.get('selector', m.get('form_field_name', ''))),
            'fid':  str(m.get('form_field_id', m.get('selector', ''))),
        }
        for m in data.get('mappings', [])
        if m.get('mapped_value')
    ]
    print(f"  {len(norm)} mappings at {data.get('confidence',0):.0%}")

    # Step 3: Open browser
    print("\nStep 3: Opening browser...")
    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=False, slow_mo=150)
        page = browser.new_page()
        page.goto(f"file:///{TEST_PAGE.replace(os.sep, '/')}")
        page.wait_for_load_state('networkidle')
        time.sleep(1)

        total_filled = 0
        section_results = {}

        # --- Fill all standard fields across ALL sections ---
        print("\n  Filling standard fields (all sections)...")
        for m in norm:
            val  = m['val']
            fid  = m['fid']
            sel  = m['sel']
            res  = m['res']
            leaf = res.split('.')[-1] if '.' in res else res

            # All possible CSS selectors covering sections 1,2,3,5
            css_list = [
                f'#{fid}',                                           # sec1: id
                f'[name="{fid}"]',                                   # sec1: name
                f'#{sel}',                                           # sel id
                f'[name="{sel}"]',                                   # sel name
                f'[name*="[{leaf}]"]',                              # sec2: bracket
                f'[name*="[{fid}]"]',                               # sec2: bracket fid
                f'[aria-label="{leaf.replace("_", " ").title()}"]', # sec3: aria Title Case
                f'[aria-label="{leaf.replace("_", " ")}"]',         # sec3: aria lower
                f'[aria-label="{sel.replace("_", " ").title()}"]',  # sec3: sel aria
                f'[id="{leaf}"]',                                    # leaf id
                f'[name="{leaf}"]',                                  # leaf name
                f'[id*="{leaf}"]',                                   # partial id
                f'[name*="{leaf}"]',                                 # partial name
                f'[placeholder*="{val[:20]}"]',                     # placeholder value
            ]

            filled_this = set()
            for css in css_list:
                try:
                    for el in page.query_selector_all(css):
                        if not el.is_visible():
                            continue
                        uid = el.evaluate(
                            "e => e.id+'|'+e.name+'|'+(e.getAttribute('aria-label')||'')"
                        )
                        if uid in filled_this:
                            continue
                        filled_this.add(uid)
                        typ = el.evaluate("e => (e.type||'').toLowerCase()")
                        tag = el.evaluate("e => e.tagName.toLowerCase()")
                        if typ in ('file','submit','button','reset','hidden','checkbox','radio'):
                            continue
                        if tag == 'select':
                            try:
                                el.select_option(label=val, timeout=500)
                            except:
                                try:
                                    # partial match
                                    opts = el.evaluate(
                                        "e => Array.from(e.options).map(o=>o.text)")
                                    match = next((o for o in opts if val.lower() in o.lower()), None)
                                    if match:
                                        el.select_option(label=match, timeout=500)
                                except:
                                    pass
                        else:
                            el.click(timeout=500)
                            el.fill(val, timeout=500)
                except:
                    pass

            if filled_this:
                n = len(filled_this)
                total_filled += n
                print(f"    {res:25s} = {val[:45]}  [{n} element(s)]")

        # --- Fill AI open-ended questions (Section 4) ---
        print("\n  Filling AI questions (Section 4)...")
        ai_questions = [
            ('cover_letter',     'Cover Letter'),
            ('why_company',      'Why do you want to work at Google?'),
            ('about_yourself',   'Tell us about yourself'),
            ('describe_project', "Describe a project you're proud of"),
            ('strengths',        'What are your key strengths?'),
            ('additional_info',  'Additional Information'),
        ]

        for field_id, question in ai_questions:
            try:
                r2 = requests.post(
                    f"{BACKEND_URL}/api/v1/ai/answer-question",
                    json={
                        'question': question, 'field_label': question,
                        'field_type': 'textarea', 'profile': profile,
                        'context': {'company_name': 'Google',
                                    'job_title': 'Software Engineer Intern'}
                    }, timeout=12)
                if not r2.ok:
                    continue
                answer = r2.json().get('answer', '')
                if not answer:
                    continue

                # Find the textarea by id, name, or aria-label
                for css in [f'#{field_id}', f'[name="{field_id}"]',
                            f'[aria-label*="{question[:20]}"]',
                            f'[id*="{field_id}"]']:
                    try:
                        el = page.query_selector(css)
                        if el and el.is_visible():
                            el.click(timeout=500)
                            el.fill(answer[:600], timeout=500)
                            print(f"    {field_id:25s} = [{len(answer)} chars AI answer]")
                            total_filled += 1
                            break
                    except:
                        pass
            except Exception as e:
                print(f"    AI error for {field_id}: {e}")

        # --- Verify ---
        print(f"\n  Verification: counting filled elements...")
        actually_filled = []
        for inp in page.query_selector_all('input, textarea, select'):
            try:
                if not inp.is_visible():
                    continue
                val = inp.evaluate("e => e.value || ''")
                if val.strip():
                    name = inp.evaluate(
                        "e => e.id || e.name || e.getAttribute('aria-label') || e.placeholder || '?'")
                    actually_filled.append({'name': str(name)[:40], 'value': str(val)[:60]})
            except:
                pass

        print(f"\n{'='*60}")
        print(f"RESULT: {len(actually_filled)} fields filled")
        print(f"{'='*60}")

        # Group by section
        sections = {
            'Section 1 (standard)':    ['first_name','last_name','email','phone','city','linkedin_url','github_url','country'],
            'Section 2 (Greenhouse)':  ['gh_first','gh_last','gh_email','gh_phone'],
            'Section 3 (Workday)':     [],  # aria-label only
            'Section 4 (AI)':          ['cover_letter','why_company','about_yourself','describe_project','strengths','additional_info'],
            'Section 5 (orphan)':      ['portfolio','years_experience'],
        }

        for f in actually_filled:
            found_sec = 'Other'
            for sec, ids in sections.items():
                if any(i in f['name'] for i in ids):
                    found_sec = sec
                    break
            # Section 3 detection by content
            if 'First Name' in f['name'] or 'Last Name' in f['name'] or \
               'Email' in f['name'] or 'Phone' in f['name']:
                if found_sec == 'Other':
                    found_sec = 'Section 3 (Workday)'
            print(f"  [{found_sec[:10]}] {f['name']:35s} = {f['value']}")

        # Screenshot
        page.screenshot(path="tests/autofill_result.png", full_page=True)
        print("\nScreenshot saved: tests/autofill_result.png")

        if len(actually_filled) >= 12:
            print(f"\nPASS - {len(actually_filled)} fields filled")
        else:
            print(f"\nPARTIAL - {len(actually_filled)} fields filled")

        time.sleep(4)
        browser.close()


if __name__ == '__main__':
    run()
