import os, time, sys
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
from app import create_app
app = create_app('testing')
from app.services.ai_answer_service import AIAnswerService
svc = AIAnswerService()
t = time.time()
result = svc.generate_answer(
    'Why do you want to work here?', 'Why do you want to work here?',
    'textarea', {'company_name': 'Google'},
    {'name': 'John', 'skills': ['Python'], 'years_experience': '3'}
)
elapsed = time.time() - t
print(f"Time: {elapsed:.2f}s  used_ai={result['used_ai']}  len={len(result['answer'])}")
print("Answer preview:", result['answer'][:120])
