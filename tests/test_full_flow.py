"""
Full end-to-end flow test:
  1. Upload resume (PDF bytes)
  2. Parse → structured profile
  3. Analyze HTML form → field mappings (all standard fields)
  4. AI answers for open-ended questions (cover letter, why company, projects, strengths, etc.)
  5. Verify every mapping has selector + form_field_id (required by autoFill.js)
  6. Verify AI answer endpoint covers every pattern in autoFill.js AI_QUESTION_PATTERNS
"""
import json, io, zipfile, sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

import pytest
from app import create_app

@pytest.fixture
def client():
    app = create_app('testing')
    with app.test_client() as c:
        yield c

# ── Helper: build a minimal DOCX in memory ────────────────────────────────────
def make_docx(text: str) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, 'w', zipfile.ZIP_DEFLATED) as zf:
        content_types = (
            '<?xml version="1.0" encoding="UTF-8"?>'
            '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
            '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
            '<Override PartName="/word/document.xml" '
            'ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
            '</Types>'
        )
        zf.writestr('[Content_Types].xml', content_types)
        rels = (
            '<?xml version="1.0" encoding="UTF-8"?>'
            '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
            '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>'
            '</Relationships>'
        )
        zf.writestr('_rels/.rels', rels)
        paragraphs = ''.join(
            f'<w:p><w:r><w:t>{line}</w:t></w:r></w:p>'
            for line in text.split('\n') if line.strip()
        )
        doc_xml = (
            '<?xml version="1.0" encoding="UTF-8"?>'
            '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
            f'<w:body>{paragraphs}</w:body>'
            '</w:document>'
        )
        zf.writestr('word/document.xml', doc_xml)
    return buf.getvalue()


RESUME_TEXT = """John Smith
john.smith@example.com
+1 (555) 123-4567
linkedin.com/in/johnsmith
github.com/johnsmith
New York, NY

SUMMARY
Software engineer with 3 years of experience building web applications.

SKILLS
Python, JavaScript, React, Node.js, SQL, AWS, Docker, Git

EXPERIENCE
Software Engineer | TechCorp | 2021-Present
- Built REST APIs with Python/Flask serving 100K+ daily requests
- Led migration from monolith to microservices, reducing latency by 40%

PROJECTS
AutoFill Assistant - Chrome extension that auto-fills job application forms using AI.
Built with JavaScript (MV3), Python/Flask backend, NVIDIA NIM integration.

EDUCATION
B.S. Computer Science | State University | 2021
GPA: 3.8
"""

# ── 1. Resume upload ──────────────────────────────────────────────────────────
def test_resume_upload_and_parse(client):
    """Upload a DOCX resume and verify all critical fields are parsed."""
    docx_bytes = make_docx(RESUME_TEXT)
    data = {'resume': (io.BytesIO(docx_bytes), 'john_smith.docx',
                       'application/vnd.openxmlformats-officedocument.wordprocessingml.document')}
    r = client.post('/api/profile/upload', data=data, content_type='multipart/form-data')
    assert r.status_code == 200, f"Upload failed {r.status_code}: {r.data[:300]}"
    d = r.get_json()

    # Response shape — popup.js does: response.data.data || response.data
    assert d['success'] is True
    profile = d['data']  # this is what popup stores as userProfile

    assert profile.get('email'),      f"email missing: {list(profile.keys())}"
    assert profile.get('phone'),      f"phone missing"
    assert profile.get('name') or profile.get('first_name'), "name missing"
    assert profile.get('skills'),     f"skills missing"
    # Nested structures required by field_mapping_service
    assert 'personal' in profile,    f"personal sub-dict missing"
    assert 'contact'  in profile,    f"contact sub-dict missing"
    assert 'social'   in profile,    f"social sub-dict missing"
    assert profile['contact'].get('email') == profile.get('email'), \
        "contact.email != top-level email"
    print(f"[OK] Upload: name={profile.get('name')} email={profile['contact']['email']}"
          f" skills={len(profile['skills'])}")
    return profile


# ── 2. Form analyze with full ATS-style HTML ──────────────────────────────────
def test_form_analyze_maps_all_standard_fields(client):
    """Analyze a realistic ATS form and verify all standard fields are mapped."""
    docx_bytes = make_docx(RESUME_TEXT)
    data = {'resume': (io.BytesIO(docx_bytes), 'john_smith.docx',
                       'application/vnd.openxmlformats-officedocument.wordprocessingml.document')}
    r = client.post('/api/profile/upload', data=data, content_type='multipart/form-data')
    profile = r.get_json()['data']

    # Greenhouse-style form HTML
    html = """
    <form id="application_form" action="/apply" method="post">
      <input autocomplete="given-name"  name="job_application[first_name]" id="first_name" type="text">
      <input autocomplete="family-name" name="job_application[last_name]"  id="last_name"  type="text">
      <input autocomplete="email"       name="job_application[email]"       id="email"      type="email">
      <input autocomplete="tel"         name="job_application[phone]"       id="phone"      type="tel">
      <input name="job_application[linkedin_url]" id="linkedin_url" type="url" placeholder="LinkedIn URL">
      <input name="job_application[github_url]"   id="github_url"   type="url" placeholder="GitHub URL">
      <label for="city">City</label>
      <input name="city" id="city" type="text">
      <textarea name="job_application[cover_letter]" id="cover_letter"
                aria-label="Cover Letter"></textarea>
      <textarea name="job_application[about_yourself]" id="about_yourself"
                aria-label="Tell us about yourself"></textarea>
    </form>
    """

    payload = {'html': html, 'resume': profile}
    r = client.post('/api/form/analyze',
                    data=json.dumps(payload),
                    content_type='application/json')
    assert r.status_code == 200, f"analyze failed {r.status_code}: {r.data[:300]}"
    d = r.get_json()
    assert d['success'], f"success=False: {d}"
    assert d['confidence'] > 0, "confidence is 0"

    mappings = d['mappings']
    assert len(mappings) > 0, "No mappings returned"

    # Every mapping MUST have the fields autoFill.js needs
    for m in mappings:
        assert 'profile_field_name' in m,  f"missing profile_field_name: {m}"
        assert 'mapped_value'       in m,  f"missing mapped_value: {m}"
        assert 'confidence_score'   in m,  f"missing confidence_score: {m}"
        assert 'selector'           in m,  f"missing selector: {m}"
        assert 'form_field_id'      in m,  f"missing form_field_id: {m}"
        assert m['mapped_value'] not in (None, ''), \
            f"empty mapped_value for {m['profile_field_name']}"

    mapped_profiles = {m['profile_field_name'] for m in mappings}
    print(f"[OK] Analyze: {len(mappings)} mappings, confidence={d['confidence']}")
    for m in mappings:
        print(f"     {m['form_field_name']:35s} → {m['profile_field_name']:25s}"
              f" = {str(m['mapped_value'])[:30]:30s}  conf={m['confidence_score']:.2f}")

    # Critical fields must be mapped
    for required in ('email', 'phone'):
        found = any(required in m['profile_field_name'] for m in mappings)
        assert found, f"'{required}' not mapped — mapped: {mapped_profiles}"


# ── 3. AI questions — every pattern in autoFill.js AI_QUESTION_PATTERNS ───────
AI_QUESTION_PATTERNS = [
    # (label_sent_to_backend,  expected_question_type)
    ("Cover Letter",                                    "cover_letter"),
    ("Why do you want to work at this company?",        "why_company"),
    ("Tell us about yourself",                          "about_yourself"),
    ("What are your strengths?",                        "strengths"),
    ("Describe your experience with Python",            "experience"),
    ("Tell us about a project you're proud of",         "project"),
    ("Describe a challenge you faced",                  "challenge"),
    ("Where do you see yourself in 5 years?",           "goals"),
    ("What is your salary expectation?",                "salary"),
    ("When can you start?",                             "availability"),
    ("Is there anything else you'd like us to know?",   "additional_info"),
    ("Why are you interested in this role?",            "why_company"),
    ("Why join us?",                                    "why_company"),
    ("Introduce yourself",                              "about_yourself"),
    ("Describe yourself",                               "about_yourself"),
    ("Professional summary",                            "about_yourself"),
    ("Tell us about a notable project",                 "project"),
    ("What are your key strengths?",                    "strengths"),
    ("Describe a difficult situation",                  "challenge"),
    ("Additional information",                          "additional_info"),
    ("Additional comments",                             "additional_info"),
]

PROFILE = {
    'name': 'John Smith', 'first_name': 'John', 'last_name': 'Smith',
    'email': 'john@example.com', 'phone': '5551234567',
    'years_experience': '3',
    'skills': ['Python', 'JavaScript', 'React', 'Flask', 'SQL'],
    'personal': {'full_name': 'John Smith', 'first_name': 'John', 'last_name': 'Smith'},
    'contact': {'email': 'john@example.com', 'phone': '5551234567', 'city': 'New York'},
    'social': {'linkedin': 'linkedin.com/in/john', 'github': 'github.com/john'},
}

@pytest.mark.parametrize("label,expected_type", AI_QUESTION_PATTERNS)
def test_ai_answer_for_every_question_pattern(client, label, expected_type):
    """Every open-ended question pattern returns a non-empty answer."""
    payload = {
        'question': label,
        'field_label': label,
        'field_type': 'textarea',
        'context': {'company_name': 'Google', 'job_title': 'Software Engineer'},
        'profile': PROFILE
    }
    r = client.post('/api/v1/ai/answer-question',
                    data=json.dumps(payload),
                    content_type='application/json')
    assert r.status_code == 200, f"HTTP {r.status_code} for '{label}': {r.data[:200]}"
    d = r.get_json()
    assert d['success'],              f"success=False for '{label}': {d}"
    assert d.get('answer'),           f"empty answer for '{label}'"
    assert len(d['answer']) > 40,     f"answer too short ({len(d['answer'])} chars) for '{label}'"
    assert d['question_type'] == expected_type, \
        f"wrong type for '{label}': got {d['question_type']!r} expected {expected_type!r}"
    print(f"  [{d['question_type']:15s}] {label[:50]:50s} → {len(d['answer'])} chars")


# ── 4. Batch AI answers ───────────────────────────────────────────────────────
def test_ai_batch_answers(client):
    """Batch endpoint returns an answer for every question."""
    questions = [{'label': lbl, 'type': 'textarea'} for lbl, _ in AI_QUESTION_PATTERNS[:6]]
    payload = {
        'questions': questions,
        'context': {'company_name': 'Stripe', 'job_title': 'Backend Engineer'},
        'profile': PROFILE
    }
    r = client.post('/api/v1/ai/answer-questions-batch',
                    data=json.dumps(payload),
                    content_type='application/json')
    assert r.status_code == 200
    d = r.get_json()
    assert d['success']
    assert len(d['answers']) == len(questions), \
        f"expected {len(questions)} answers got {len(d['answers'])}"
    for a in d['answers']:
        assert a['answer'], f"empty answer for '{a['label']}'"
    print(f"[OK] Batch: {len(d['answers'])} answers")


# ── 5. _resolve_value nested path verification (B9 regression) ────────────────
def test_nested_profile_fields_resolve(client):
    """contact.city, contact.email, social.github all resolve correctly."""
    payload = {
        'resume': PROFILE,
        'forms': [{'elements': [
            {'name': 'city',    'id': 'city',    'type': 'text'},
            {'name': 'email',   'id': 'email',   'type': 'email'},
            {'name': 'github',  'id': 'github',  'type': 'url'},
            {'name': 'linkedin','id': 'linkedin', 'type': 'url'},
            {'name': 'phone',   'id': 'phone',   'type': 'tel'},
        ]}]
    }
    r = client.post('/api/form/analyze/fields',
                    data=json.dumps(payload),
                    content_type='application/json')
    assert r.status_code == 200
    d = r.get_json()
    by_name = {m['form_field_name']: m['mapped_value'] for m in d['mappings']}

    assert by_name.get('email')   == 'john@example.com', f"email: {by_name}"
    assert by_name.get('phone')   == '5551234567',        f"phone: {by_name}"
    assert by_name.get('city')    == 'New York',          f"city: {by_name}"
    assert by_name.get('github'),                          f"github empty: {by_name}"
    assert by_name.get('linkedin'),                        f"linkedin empty: {by_name}"
    print(f"[OK] Nested resolve: {by_name}")


# ── 6. autoFill.js schema contract — mappings must have fieldId+selector ──────
def test_mapping_schema_contract_for_autofill(client):
    """
    background.js normalizes mappings to:
      { resumeField, value, confidence, selector, fieldId }
    Verify the backend always provides the raw fields needed for that normalization.
    """
    html = (
        '<form>'
        '<input name="first_name" id="first_name" autocomplete="given-name" type="text">'
        '<input name="last_name"  id="last_name"  autocomplete="family-name" type="text">'
        '<input name="email"      id="email"      autocomplete="email" type="email">'
        '</form>'
    )
    payload = {'html': html, 'resume': PROFILE}
    r = client.post('/api/form/analyze',
                    data=json.dumps(payload),
                    content_type='application/json')
    d = r.get_json()
    for m in d['mappings']:
        # background.js RUN_AUTOFILL uses these exact keys:
        assert m.get('profile_field_name') or m.get('resumeField'), \
            f"profile_field_name missing: {m}"
        assert 'mapped_value'     in m, f"mapped_value missing: {m}"
        assert 'confidence_score' in m, f"confidence_score missing: {m}"
        assert 'selector'         in m, f"selector missing: {m}"
        assert 'form_field_id'    in m, f"form_field_id missing: {m}"
        # After background.js normalization:
        # resumeField = profile_field_name, value = mapped_value,
        # confidence = confidence_score, fieldId = form_field_id
        assert m['mapped_value'] not in (None, ''), \
            f"empty value for {m['profile_field_name']}"
    print(f"[OK] Schema contract: {len(d['mappings'])} mappings all valid")
