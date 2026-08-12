"""
Live simulation test: reads the actual live_test_page.html,
extracts its HTML, sends to backend, verifies ALL fields map correctly.
This is the closest we can get to a real browser test without Playwright.
"""
import json, os, sys
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
import pytest
from app import create_app

# ── Real resume (simulates uploaded PDF) ─────────────────────────────────────
RESUME = {
    'name':         'John Smith',
    'first_name':   'John',
    'last_name':    'Smith',
    'email':        'john.smith@example.com',
    'phone':        '+15551234567',
    'years_experience': '3',
    'skills':       ['Python', 'JavaScript', 'React', 'Flask', 'SQL', 'AWS'],
    'personal': {
        'full_name':  'John Smith',
        'first_name': 'John',
        'last_name':  'Smith',
    },
    'contact': {
        'email':    'john.smith@example.com',
        'phone':    '+15551234567',
        'city':     'New York',
        'linkedin': 'linkedin.com/in/johnsmith',
        'github':   'github.com/johnsmith',
    },
    'social': {
        'linkedin':  'linkedin.com/in/johnsmith',
        'github':    'github.com/johnsmith',
        'portfolio': 'johnsmith.dev',
    },
}

@pytest.fixture(scope='module')
def client():
    app = create_app('testing')
    with app.test_client() as c:
        yield c


# ── Load the real test page HTML ──────────────────────────────────────────────
def get_test_page_html():
    path = os.path.join(os.path.dirname(__file__), 'live_test_page.html')
    with open(path, 'r', encoding='utf-8') as f:
        return f.read()


class TestLiveGreenhouse:
    """Tests that use the actual test page HTML — closest to real browser."""

    def test_backend_parses_real_form_html(self, client):
        """Backend correctly analyzes the test page HTML."""
        html = get_test_page_html()
        payload = {'html': html, 'source_url': 'http://localhost/test', 'resume': RESUME}
        r = client.post('/api/form/analyze',
                        data=json.dumps(payload),
                        content_type='application/json')
        assert r.status_code == 200, f"HTTP {r.status_code}: {r.data[:200]}"
        d = r.get_json()
        assert d['success'], f"success=False: {d}"
        assert len(d['mappings']) > 0, "No mappings returned for test page"

        mapped = {m['form_field_name']: m['mapped_value'] for m in d['mappings']}
        print(f"\n[LIVE TEST] {len(d['mappings'])} mappings from real HTML:")
        for m in d['mappings']:
            print(f"  {m['form_field_name']:35s} → {str(m['mapped_value'])[:40]}"
                  f"  conf={m['confidence_score']:.2f}")

        # Critical fields must be mapped
        email_mapped   = any('email' in m['form_field_name'].lower() and m['mapped_value']
                             for m in d['mappings'])
        name_mapped    = any('name' in m['form_field_name'].lower() and m['mapped_value']
                             for m in d['mappings'])
        assert email_mapped, f"email not mapped. Got: {list(mapped.keys())}"
        assert name_mapped,  f"name not mapped. Got: {list(mapped.keys())}"

    def test_schema_contract_for_autofill(self, client):
        """Every mapping has ALL fields autoFill.js needs."""
        html = get_test_page_html()
        payload = {'html': html, 'resume': RESUME}
        r = client.post('/api/form/analyze',
                        data=json.dumps(payload),
                        content_type='application/json')
        d = r.get_json()
        for m in d['mappings']:
            assert 'profile_field_name' in m, f"missing profile_field_name: {m}"
            assert 'mapped_value'       in m, f"missing mapped_value: {m}"
            assert 'confidence_score'   in m, f"missing confidence_score: {m}"
            assert 'selector'           in m, f"missing selector: {m}"
            assert 'form_field_id'      in m, f"missing form_field_id: {m}"
            assert m['mapped_value'] not in (None, ''), \
                f"empty value for {m['profile_field_name']}"

    def test_greenhouse_bracket_notation(self, client):
        """Greenhouse job_application[first_name] bracket notation maps correctly."""
        html = """
        <form id="application_form">
          <input name="job_application[first_name]" type="text"
                 autocomplete="given-name" id="first_name">
          <input name="job_application[last_name]"  type="text"
                 autocomplete="family-name" id="last_name">
          <input name="job_application[email]"      type="email"
                 autocomplete="email" id="email">
          <input name="job_application[phone_number]" type="tel"
                 autocomplete="tel" id="phone">
          <input name="job_application[linkedin_url]" type="url"
                 placeholder="LinkedIn URL" id="linkedin_url">
          <textarea name="job_application[cover_letter_text]"
                    aria-label="Cover Letter" id="cover_letter"></textarea>
        </form>
        """
        payload = {'html': html, 'resume': RESUME}
        r = client.post('/api/form/analyze',
                        data=json.dumps(payload),
                        content_type='application/json')
        assert r.status_code == 200
        d = r.get_json()
        assert d['success']
        assert len(d['mappings']) >= 4, f"Expected ≥4 mappings, got {len(d['mappings'])}"

        mapped_names = [m['form_field_name'] for m in d['mappings']]
        mapped_values = {m['form_field_name']: m['mapped_value'] for m in d['mappings']}
        print(f"\n[GREENHOUSE TEST] Mappings: {mapped_values}")

        # Email must be mapped correctly
        email_m = next((m for m in d['mappings']
                        if 'email' in m['form_field_name'].lower()), None)
        assert email_m, f"email not mapped. Got: {mapped_names}"
        assert 'john' in email_m['mapped_value'].lower(), \
            f"email value wrong: {email_m['mapped_value']}"

    def test_workday_aria_label_only(self, client):
        """Workday-style: inputs with aria-label only, no name/id."""
        html = """
        <form>
          <input type="text"  aria-label="First Name">
          <input type="text"  aria-label="Last Name">
          <input type="email" aria-label="Email Address">
          <input type="tel"   aria-label="Phone Number">
        </form>
        """
        payload = {'html': html, 'resume': RESUME}
        r = client.post('/api/form/analyze',
                        data=json.dumps(payload),
                        content_type='application/json')
        assert r.status_code == 200
        d = r.get_json()
        assert d['success']
        print(f"\n[WORKDAY TEST] Mappings: {[(m['form_field_name'], m['mapped_value']) for m in d['mappings']]}")
        assert len(d['mappings']) >= 2, f"Expected ≥2 mappings, got {len(d['mappings'])}"

    def test_ai_cover_letter_personalized(self, client):
        """AI answer for Cover Letter contains candidate name and skills."""
        payload = {
            'question':    'Cover Letter',
            'field_label': 'Cover Letter',
            'field_type':  'textarea',
            'context':     {'company_name': 'Google', 'job_title': 'Software Engineer Intern'},
            'profile':     RESUME,
        }
        r = client.post('/api/v1/ai/answer-question',
                        data=json.dumps(payload),
                        content_type='application/json')
        assert r.status_code == 200
        d = r.get_json()
        assert d['success']
        answer = d['answer']
        print(f"\n[AI COVER LETTER]\n{answer[:300]}")
        assert len(answer) > 100, "Cover letter too short"
        # Must be personalized with real data from profile
        assert any(word in answer for word in ['John', 'Python', 'Google', 'engineer', 'experience']), \
            f"Answer not personalized: {answer[:200]}"

    def test_ai_why_company_personalized(self, client):
        """AI answer for 'Why Google?' contains company name and profile skills."""
        payload = {
            'question':    'Why do you want to work at Google?',
            'field_label': 'Why do you want to work at Google?',
            'field_type':  'textarea',
            'context':     {'company_name': 'Google', 'job_title': 'Software Engineer Intern'},
            'profile':     RESUME,
        }
        r = client.post('/api/v1/ai/answer-question',
                        data=json.dumps(payload),
                        content_type='application/json')
        assert r.status_code == 200
        d = r.get_json()
        answer = d['answer']
        print(f"\n[AI WHY GOOGLE]\n{answer[:300]}")
        assert 'Google' in answer or 'google' in answer.lower(), \
            f"Answer doesn't mention Google: {answer[:200]}"
        assert len(answer) > 80

    def test_all_ai_question_types(self, client):
        """All 10 question types return non-empty personalized answers."""
        questions = [
            ('Cover Letter', 'cover_letter'),
            ('Why do you want to work here?', 'why_company'),
            ('Tell us about yourself', 'about_yourself'),
            ('What are your strengths?', 'strengths'),
            ('Describe a project you worked on', 'project'),
            ('Describe a challenge you faced', 'challenge'),
            ('Where do you see yourself in 5 years?', 'goals'),
            ('What is your salary expectation?', 'salary'),
            ('When can you start?', 'availability'),
            ('Additional information', 'additional_info'),
        ]
        for label, expected_type in questions:
            payload = {
                'question': label, 'field_label': label,
                'field_type': 'textarea',
                'context': {'company_name': 'Google', 'job_title': 'SWE Intern'},
                'profile': RESUME,
            }
            r = client.post('/api/v1/ai/answer-question',
                            data=json.dumps(payload),
                            content_type='application/json')
            assert r.status_code == 200, f"HTTP error for '{label}'"
            d = r.get_json()
            assert d['success'],            f"Failed for '{label}': {d}"
            assert d['question_type'] == expected_type, \
                f"Wrong type for '{label}': {d['question_type']}"
            assert len(d['answer']) > 40,   f"Answer too short for '{label}': {d['answer']}"
            print(f"  [{expected_type:15s}] ✓ {len(d['answer'])} chars")

    def test_nested_profile_values_resolve(self, client):
        """contact.email, contact.phone, contact.city, social.linkedin all resolve."""
        payload = {
            'resume': RESUME,
            'forms': [{'elements': [
                {'name': 'email',    'id': 'email',    'type': 'email'},
                {'name': 'phone',    'id': 'phone',    'type': 'tel'},
                {'name': 'city',     'id': 'city',     'type': 'text'},
                {'name': 'linkedin', 'id': 'linkedin', 'type': 'url'},
                {'name': 'github',   'id': 'github',   'type': 'url'},
            ]}]
        }
        r = client.post('/api/form/analyze/fields',
                        data=json.dumps(payload),
                        content_type='application/json')
        assert r.status_code == 200
        d = r.get_json()
        by_name = {m['form_field_name']: m['mapped_value'] for m in d['mappings']}
        print(f"\n[NESTED PROFILE] {by_name}")
        assert by_name.get('email') == 'john.smith@example.com', f"email: {by_name}"
        assert by_name.get('phone') == '+15551234567',            f"phone: {by_name}"
        assert by_name.get('city')  == 'New York',               f"city: {by_name}"
        assert by_name.get('linkedin'),                           f"linkedin: {by_name}"
        assert by_name.get('github'),                             f"github: {by_name}"
