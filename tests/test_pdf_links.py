"""Extract hyperlinks from PDF to get LinkedIn/GitHub URLs."""
import sys, os, glob
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

search_paths = [os.path.expanduser('~/Downloads/*.pdf'), os.path.expanduser('~/OneDrive/**/*.pdf')]
pdf_path = None
for p in search_paths:
    files = glob.glob(p, recursive=True)
    if files: pdf_path = files[0]; break

import fitz
doc = fitz.open(pdf_path)
print("=== HYPERLINKS IN PDF ===")
for i, page in enumerate(doc):
    links = page.get_links()
    for link in links:
        if link.get('uri'):
            print(f"Page {i+1}: {link['uri']}")

print("\n=== FULL TEXT (first 800 chars) ===")
text = ""
for page in doc:
    text += page.get_text()
doc.close()
print(text[:800])
