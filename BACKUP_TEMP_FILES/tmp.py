path = r'c:\Users\sujan\OneDrive\Desktop\intern\extension\content\autoFill.js'
with open(path, 'r', encoding='utf-8') as f:
    c = f.read()

# Find all section markers
markers = [
    ('Greenhouse', '5a. GREENHOUSE'),
    ('Lever', '5b. LEVER'),
    ('Ashby', '5c. ASHBY'),
    ('GoogleForms', '5d. GOOGLE FORMS'),
    ('SmartRecruiters', '5e. SMARTRECRUITERS'),
    ('Generic', '5f. GENERIC'),
    ('Workday', '6. FILL WORKDAY'),
    ('LinkedIn', '5g. LINKEDIN')
]

print('Section markers:')
for name, marker in markers:
    idx = c.find(marker)
    print(f'{name:20} at index {idx}')

# Get the functions list
print('\\nFunctions found:')
import re
funcs = re.findall(r'async function (fill\w+)\(profile\)', c)
for f in funcs:
    print(' -', f)
