from app.services.resume_parser import ResumeParser
import json

p = ResumeParser()
with open(r'C:\Users\sujan\OneDrive\Desktop\Resumesujan.pdf','rb') as f:
    data = f.read()

result = p.parse(data, 'Resumesujan.pdf', 'application/pdf')

print('RESUME DATA — COMPLETE AUDIT')
print('='*70)
print(json.dumps(result, indent=2, default=str))
