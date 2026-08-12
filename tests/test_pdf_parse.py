"""Test PDF parsing directly to diagnose empty profile issue."""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

import glob
search_paths = [
    os.path.expanduser('~/Desktop/*.pdf'),
    os.path.expanduser('~/Documents/*.pdf'),
    os.path.expanduser('~/Downloads/*.pdf'),
    os.path.expanduser('~/OneDrive/**/*.pdf'),
]

pdf_path = None
for pattern in search_paths:
    files = glob.glob(pattern, recursive=True)
    if files:
        pdf_path = files[0]
        break

if not pdf_path:
    print("No PDF found.")
    sys.exit(1)

print(f"Testing PDF: {pdf_path}")

from app.services.resume_parser import ResumeParser
parser = ResumeParser()
with open(pdf_path, 'rb') as f:
    data = parser.parse(f.read(), os.path.basename(pdf_path), 'application/pdf')

print(f"name:       {data.get('name')!r}")
print(f"first_name: {data.get('first_name')!r}")
print(f"last_name:  {data.get('last_name')!r}")
print(f"email:      {data.get('email')!r}")
print(f"phone:      {data.get('phone')!r}")
print(f"linkedin:   {data.get('linkedin')!r}")
print(f"github:     {data.get('github')!r}")
print(f"city:       {data.get('contact', {}).get('city')!r}")
print(f"skills:     {data.get('skills', [])[:5]}")
