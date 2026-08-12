"""Check what experience/education data is in the resume."""
import sys, os, glob
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
from dotenv import load_dotenv; load_dotenv()

pdfs = glob.glob(os.path.expanduser('~/Downloads/Resume.pdf'))
if not pdfs:
    pdfs = glob.glob(os.path.expanduser('~/Downloads/*.pdf'))

from app.services.resume_parser import ResumeParser
parser = ResumeParser()

for pdf_path in pdfs[:2]:
    print(f"\n=== {os.path.basename(pdf_path)} ===")
    with open(pdf_path, 'rb') as f:
        data = parser.parse(f.read(), os.path.basename(pdf_path), 'application/pdf')
    
    print("summary:", repr(data.get('summary',''))[:200])
    print("projects:", repr(data.get('projects',''))[:200])
    print("\nRaw text (first 2000 chars):")
    print(data.get('raw_text','')[:2000])
