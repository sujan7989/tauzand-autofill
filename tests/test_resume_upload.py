"""Test resume upload and parsing for all PDFs in Downloads."""
import requests, os, glob, sys
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

pdfs = glob.glob(os.path.expanduser('~/Downloads/*.pdf'))
print(f"Found {len(pdfs)} PDFs:")
for p in pdfs:
    print(f"  {os.path.basename(p)}")

print("\nTesting upload for each...")
for pdf_path in pdfs:
    fname = os.path.basename(pdf_path)
    try:
        with open(pdf_path, 'rb') as f:
            r = requests.post('http://localhost:5000/api/profile/upload',
                files={'resume': (fname, f, 'application/pdf')}, timeout=15)
        if r.ok:
            d = r.json().get('data', {})
            name  = d.get('name', '')
            email = d.get('email', '')
            phone = d.get('phone', '')
            linkedin = d.get('linkedin', '') or (d.get('social',{}) or {}).get('linkedin','')
            print(f"\n[OK] {fname}")
            print(f"     name={name!r}")
            print(f"     email={email!r}")
            print(f"     phone={phone!r}")
            print(f"     linkedin={str(linkedin)[:60]!r}")
        else:
            print(f"[FAIL] {fname}: HTTP {r.status_code} {r.text[:100]}")
    except Exception as e:
        print(f"[ERR] {fname}: {e}")
