"""Verify AI answers are personalized with real resume data."""
import sys, os, json, glob
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
os.environ['NVIDIA_NIM_API_KEY'] = 'DISABLED'

from dotenv import load_dotenv; load_dotenv()
from app import create_app
import requests

BACKEND = "http://localhost:5000"

# Load real resume
pdfs = glob.glob(os.path.expanduser('~/Downloads/Resume.pdf'))
profile = {}
if pdfs:
    with open(pdfs[0], 'rb') as f:
        r = requests.post(f"{BACKEND}/api/profile/upload",
            files={'resume': ('Resume.pdf', f, 'application/pdf')}, timeout=15)
    if r.ok:
        profile = r.json().get('data', {})

print("Profile loaded:")
print(f"  name={profile.get('name')}")
print(f"  projects={str(profile.get('projects',''))[:100]}")
print(f"  education={profile.get('education',[{}])[0].get('institution','')}")
print()

questions = [
    ("Cover Letter", "cover_letter"),
    ("Why do you want to work here?", "why_company"),
    ("Tell us about yourself", "about_yourself"),
    ("Describe your best project", "project"),
    ("What are your strengths?", "strengths"),
    ("Message to the Hiring Team", "additional_info"),
]

print("="*60)
print("AI ANSWERS (personalized from your resume):")
print("="*60)

for question, qtype in questions:
    r = requests.post(f"{BACKEND}/api/v1/ai/answer-question",
        json={'question': question, 'field_label': question,
              'field_type': 'textarea',
              'context': {'company_name': 'Wise', 'job_title': 'Software Engineer'},
              'profile': profile}, timeout=12)
    if r.ok:
        d = r.json()
        answer = d.get('answer', '')
        print(f"\n[{qtype}] {question}")
        print(f"  {answer[:200]}...")
        # Check personalization
        checks = {
            'has_name': any(n in answer for n in ['Akkisetty','Sujan','Kumar']),
            'has_skills': any(s in answer for s in ['Python','Java','JavaScript','React','Flask']),
            'has_project': 'PhishGuard' in answer or 'phishing' in answer.lower(),
        }
        print(f"  Personalized: name={checks['has_name']} skills={checks['has_skills']} project={checks['has_project']}")
    else:
        print(f"  ERROR: {r.status_code}")
