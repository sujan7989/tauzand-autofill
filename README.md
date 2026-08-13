# Tauzand AutoFill Assistant

AI-powered Chrome Extension for universal job application autofill.

## Deploy Backend (One Click)

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/sujan7989/tauzand-autofill)

After clicking the button, add these 4 environment variables in Render dashboard:
- `SUPABASE_URL`
- `SUPABASE_KEY`
- `SUPABASE_SERVICE_KEY`
- `NVIDIA_NIM_API_KEY`

## Install Extension

1. Open Chrome → `chrome://extensions/`
2. Enable **Developer mode**
3. Click **Load unpacked** → select the `extension/` folder
4. Extension is ready — no backend setup needed

## Local Development

```bash
pip install -r requirements.txt
python main.py
```
Then change backend URL in extension Settings to `http://localhost:5000`

## Supported Platforms
- Workday, Greenhouse, Lever, Ashby, SmartRecruiters, Keka
- Any unknown job site via Universal Engine


AI-powered Chrome Extension + Flask backend that automatically fills job application forms from your uploaded resume.

---

## Platform Support

| Platform | URL | Personal Info | Education | Experience | Yes/No Questions | AI Answers | Status |
|---|---|---|---|---|---|---|---|
| **SmartRecruiters** | jobs.smartrecruiters.com | ✅ | ✅ accordion | ✅ accordion | ✅ | ✅ | Full |
| **Workday** | myworkdayjobs.com | ✅ | ➖ | ➖ | ✅ | ✅ | Full |
| **Lever** | jobs.lever.co | ✅ | ➖ | ➖ | ✅ | ✅ | Full |
| **Greenhouse** | boards.greenhouse.io | ✅ | ➖ | ➖ | ✅ | ✅ | Full |
| **Ashby** | jobs.ashbyhq.com | ✅ | ➖ | ➖ | ✅ | ✅ | Full |
| **Indeed** | indeed.com/apply | ✅ | ➖ | ➖ | ✅ | ✅ | Full |
| **LinkedIn Easy Apply** | linkedin.com | ✅ | ➖ | ➖ | ✅ | ✅ | Full |
| **Google Forms** | docs.google.com/forms | ✅ | ➖ | ➖ | ✅ (radio) | ✅ | Full |
| **Generic HTML forms** | any | ✅ | ➖ | ➖ | ✅ | ✅ | Good |

---

## Fields Filled (from resume — no hardcoding)

### Personal
- First Name, Last Name, Full Name
- Email, Confirm Email
- Phone / Mobile
- Date of Birth (DOB)
- Gender
- Nationality / Citizenship

### Location
- City, State, Country, ZIP / Postal Code
- Street Address

### Professional
- Current Job Title, Current Company
- Years of Experience
- Notice Period
- Expected Salary / CTC
- LinkedIn URL, GitHub URL, Portfolio / Website

### Yes/No & Special Questions
- Work Authorization ("Are you legally authorized?") → Yes
- Visa Sponsorship ("Do you require sponsorship?") → No
- Willing to Relocate → Yes
- Remote Work preference → Yes
- How did you hear about this position? → LinkedIn
- Disability status, Veteran status, Gender/Ethnicity → from profile or default

### Accordion Sections (SmartRecruiters)
- Education: Institution (typeahead), Degree, Major, GPA, From/To dates
- Experience: Title, Company (typeahead), Description, From/To dates, "I currently work here" checkbox

### AI-Generated (open-ended)
- Cover Letter / Motivation Letter
- Why do you want to work here?
- Tell us about yourself
- Describe your experience
- What are your strengths?
- Describe a project / challenge
- Career goals
- Any custom textarea question

---

## Pipeline Architecture

```
User uploads PDF/DOCX resume
        │
        ▼
[app/api/profile.py]  POST /api/profile/upload
        │
        ▼
[app/services/resume_parser.py]
  Extracts: name, email, phone, DOB, city, state, country, address,
            linkedin, github, portfolio, skills, education (3 entries),
            experience, work_authorization, notice_period, salary,
            willing_to_relocate, languages, certifications
        │
        ▼
[chrome.storage.local]  ← profile JSON stored in browser
        │
        ▼ (user clicks Scan Page)
[extension/content/detectForms.js]
  Detects ALL input types: text, email, tel, url, textarea, select,
  radio, checkbox (with options[] and is_yes_no flag)
  Handles: standard forms, orphan inputs, Shadow DOM (SmartRecruiters)
        │
        ▼
[extension/content/extractHTML.js]
  Sends page HTML + detected fields to background
        │
        ▼ (user clicks Autofill)
[extension/background/background.js]
  Calls POST /api/form/analyze/fields
        │
        ▼
[app/api/form_analysis.py]
  RULE_MAP: 80+ patterns → profile field mappings
  Token-based word-boundary matching (not substring)
  Handles: work_authorization, visa_sponsorship, relocation, DOB,
           salary, notice_period, gender, cover_letter, how_did_you_hear
  Returns: [{form_field_name, mapped_value, confidence_score, field_type, options}]
        │
        ▼
[extension/content/autoFill.js]
  Platform dispatch: SmartRecruiters → SPL components + accordion
                     Workday → data-automation-id + aria-label
                     Lever   → name attributes (urls[LinkedIn] etc.)
                     Greenhouse → job_application[field] bracket notation
                     Ashby   → aria-label matching
                     Google Forms → question heading text matching
                     Generic → label + placeholder + aria-label + autocomplete
  Field type routing:
    text/email/tel/url → fillField() (React/Angular compatible native setter)
    select → fillSelectByLabel() (label text matching)
    radio → fillYesNo() (Yes/No semantic picker)
    checkbox → fillYesNo()
    file → showToast (manual attachment)
    textarea (AI) → getAIAnswer() → backend NIM/template
  SPL (SmartRecruiters): fires CustomEvent('spl-change') on host after fill
        │
        ▼
[app/services/ai_answer_service.py]  POST /api/v1/ai/answer-question
  Detects question type from label text
  Uses NVIDIA NIM (Mistral) if configured, template fallback otherwise
  All answers from resume ONLY — zero hardcoded personal data
```

---

## Backend Setup

```bash
cd path/to/intern
pip install -r requirements.txt
cp .env.example .env          # add NVIDIA_NIM_API_KEY if you have one
python main.py                # starts on http://localhost:5000
```

### API Endpoints

| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/api/health` | Health check |
| POST | `/api/profile/upload` | Upload PDF/DOCX → parsed profile JSON |
| POST | `/api/form/analyze/fields` | Map form fields → profile values |
| POST | `/api/v1/ai/answer-question` | Generate AI answer for open-ended question |
| GET | `/api/v1/field-mapping/health` | Field mapping service status |
| GET | `/api/v1/ai/health` | AI service + NIM status |

---

## Extension Setup

1. Open Chrome → `chrome://extensions` → enable Developer Mode
2. Click "Load unpacked" → select the `extension/` folder
3. Click the extension icon → upload your resume (PDF or DOCX)
4. Go to any job application page
5. Click **Scan Page** → **Autofill**

---

## Notes

- No personal data is hardcoded anywhere — all values come from the uploaded resume
- If a field value is not in the resume, it is left blank (not fabricated)
- File/resume upload fields: a toast notification asks you to attach manually
- Multi-step forms (Workday, Indeed): click Autofill again on each new step
- SmartRecruiters date fields: the SPL calendar widget is filled via shadow DOM + `spl-change` event
