"""Fix ai_answer_service.py by removing orphaned lines with invalid characters."""
with open('app/services/ai_answer_service.py', 'r', encoding='utf-8', errors='replace') as f:
    content = f.read()

# Remove the orphaned old prompt fragment
old_fragment = """The answer must feel like it was written by this specific candidate about their specific background.\"\"\"\n4. Keep answers 100-200 words for text areas, shorter for single-line fields\n5. Sound natural, enthusiastic, and professional \u2014 not robotic\n6. Focus on technical skills, real experience, and genuine motivation\n7. Do NOT make up fake companies, degrees, or experiences\n8. Return only the answer text \u2014 no labels, no explanations\"\"\""""

new_fragment = 'The answer must feel like it was written by this specific candidate about their specific background."""'

content = content.replace(old_fragment, new_fragment)

# Also fix any remaining em dashes in string literals outside triple quotes
# Replace em dash with regular hyphen in non-docstring contexts
import re
# Only replace em dashes that are outside triple-quoted strings in f-strings
# Safe: replace em dash in f-string content
content = content.replace('\u2014 not robotic', '- not robotic')
content = content.replace('\u2014 no labels', '- no labels')
content = content.replace('\u2014 not robotic', '- not robotic')

with open('app/services/ai_answer_service.py', 'w', encoding='utf-8') as f:
    f.write(content)

print("Fixed. Verifying syntax...")
import ast
try:
    ast.parse(content)
    print("Syntax OK")
except SyntaxError as e:
    print(f"Still has error at line {e.lineno}: {e.msg}")
    lines = content.split('\n')
    for i in range(max(0,e.lineno-3), min(len(lines),e.lineno+2)):
        print(f"  {i+1}: {lines[i]}")
