import sys, json
sys.path.insert(0, '.')
from dotenv import load_dotenv; load_dotenv()
from app import create_app

app = create_app('default')

profile = {
    'name': 'Sujan Kumar',
    'first_name': 'Sujan',
    'last_name': 'Kumar',
    'email': 'sujan@example.com',
    'phone': '9876543210',
    'personal': {'full_name': 'Sujan Kumar', 'first_name': 'Sujan', 'last_name': 'Kumar'},
    'contact': {'email': 'sujan@example.com', 'phone': '9876543210', 'city': 'Hyderabad'},
    'social': {'linkedin': 'linkedin.com/in/sujan', 'github': 'github.com/sujan'},
    'skills': ['Python', 'JavaScript'],
    'years_experience': '2',
}

html = open('tests/live_test_page.html', encoding='utf-8').read()

with app.test_client() as c:
    r = c.post('/api/form/analyze', json={'html': html, 'resume': profile},
               content_type='application/json')
    d = r.get_json()
    print("STATUS:", r.status_code)
    print("SUCCESS:", d.get('success'))
    print("CONFIDENCE:", d.get('confidence'))
    print("\nMAPPINGS:")
    for m in d.get('mappings', []):
        name = m.get('form_field_name','?')
        val  = repr(m.get('mapped_value',''))[:50]
        conf = m.get('confidence_score', 0)
        fid  = m.get('form_field_id','')
        sel  = m.get('selector','')
        print(f"  {name:25s} val={val:40s} conf={conf:.2f} fid={fid} sel={sel}")
