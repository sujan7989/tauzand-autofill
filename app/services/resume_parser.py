"""
Resume Parser Service
Handles PDF and DOCX parsing without external dependencies.
Uses built-in libraries only (io, re, zipfile, xml) for portability.
"""
import re
import io
import logging
from typing import Dict, Any, Optional, List
from datetime import datetime

logger = logging.getLogger(__name__)


class ResumeParser:
    """
    Pure-Python resume parser using only built-in libraries.
    Extracts structured data from PDF (via regex/text extraction)
    and DOCX (via zipfile+xml) files.
    """

    # Name detection patterns (email precedes name in most resumes)
    NAME_PATTERNS = [
        r'([A-Z][a-z]+ [A-Z][a-z]+)',  # "John Smith"
        r'([A-Z][a-z]+ [A-Z]\. [A-Z][a-z]+)',  # "John M. Smith"
        r'^([A-Z][a-z]+) ([A-Z][a-z]+)$',  # Two-word names
    ]

    # Field extraction patterns
    FIELD_PATTERNS = {
        'email': r'[\w.+-]+@[\w-]+\.[\w.-]+',
        'phone': r'(\+?\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}',
        'linkedin': r'(?:https?://)?(?:www\.)?linkedin\.com/in/([A-Za-z0-9][A-Za-z0-9\-\_]{2,40})',
        'github':   r'(?:https?://)?(?:www\.)?github\.com/([A-Za-z0-9][A-Za-z0-9\-\_]{2,39})',
        'portfolio': r'(?:portfolio|personal|website)[:\s]+(https?://[^\s]+)',
        'zip_code': r'\b\d{5}(?:-\d{4})?\b',
        'years_experience': r'(\d+\.?\d*)\+?\s*(?:years?|yrs?)\s*(?:of\s+)?(?:experience|exp)|(?:fresher|fresh\s*graduate|0[-–]1\s*year)',
        # DOB patterns: "DOB: 15/01/2000", "Date of Birth: Jan 15, 2000", "Born: 2000-01-15"
        'dob': r'(?:dob|date\s+of\s+birth|born|birth\s+date)[:\s]+(\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4}|\d{1,2}\s+\w+\s+\d{4}|\w+\s+\d{1,2},?\s+\d{4}|\d{4}[\/\-\.]\d{1,2}[\/\-\.]\d{1,2})',
        # Salary/CTC patterns
        'salary': r'(?:salary|ctc|compensation|package|expected\s+salary|current\s+ctc)[:\s]+([^\n,;]{3,40})',
        # Notice period
        'notice_period': r'(?:notice\s+period|notice)[:\s]+(\d+\s+(?:days?|weeks?|months?)|immediate)',
        # Address line
        'address': r'(?:address|location|residing\s+at|resident\s+of)[:\s]+([^\n]{5,80})',
    }

    # Common section headers
    SECTION_HEADERS = [
        r'experience', r'work experience', r'employment', r'work history',
        r'education', r'academic', r'school',
        r'skills', r'competencies', r'technical skills',
        r'certifications', r'licenses', r'credentials',
        r'projects', r'portfolio',
        r'summary', r'objective', r'profile', r'about',
        r'awards', r'honors', r'accomplishments',
        r'languages', r'language skills',
    ]

    def __init__(self):
        self.compiled_patterns = {}
        for key, pattern in self.FIELD_PATTERNS.items():
            self.compiled_patterns[key] = re.compile(pattern, re.IGNORECASE | re.MULTILINE)

    def parse(self, file_content: bytes, filename: str, mime_type: str = '') -> Dict[str, Any]:
        """
        Parse resume file and extract structured data.

        Args:
            file_content: Raw bytes of the file
            filename: Original filename (used for extension detection)
            mime_type: MIME type hint

        Returns:
            Structured resume data dictionary
        """
        filename_lower = filename.lower()

        if filename_lower.endswith('.pdf') or mime_type == 'application/pdf':
            return self._parse_pdf(file_content, filename)
        elif filename_lower.endswith(('.docx', '.doc')):
            return self._parse_docx(file_content, filename)
        else:
            # Attempt auto-detection via content sniffing
            if file_content[:4] == b'%PDF':
                return self._parse_pdf(file_content, filename)
            elif file_content[:4] == b'PK\x03\x04':  # ZIP signature (DOCX)
                return self._parse_docx(file_content, filename)
            else:
                logger.warning(f"Unknown resume format: {filename}")
                return self._raw_parse(file_content)

    def _raw_parse(self, content: bytes) -> Dict[str, Any]:
        """Fallback: treat content as raw text."""
        try:
            text = content.decode('utf-8', errors='replace')
        except Exception:
            text = content.decode('latin-1', errors='replace')

        return {
            'resume': 'unknown',
            'name': self._extract_name(text),
            'email': self._extract_field(text, 'email'),
            'phone': self._extract_field(text, 'phone'),
            'linkedin': self._extract_field(text, 'linkedin'),
            'github': self._extract_field(text, 'github'),
            'portfolio': self._extract_field(text, 'portfolio'),
            'years_experience': self._extract_field(text, 'years_experience'),
            'skills': self._extract_skills(text),
            'raw_text': text[:2000],  # Store first 2000 chars for debugging
            'parsed_at': datetime.utcnow().isoformat() + 'Z',
            'parse_method': 'raw_text',
        }

    def _extract_name(self, text: str) -> str:
        """Extract candidate name from resume text."""
        lines = text.split('\n')[:15]

        for line in lines:
            line = line.strip()
            if not line or any(h in line.lower() for h in ['resume', 'cv', 'curriculum', '@', 'http', '|', 'ù']):
                continue

            line = re.sub(r'\s*(resume|cv|curriculum\s*vitae|page\s*\d+)\s*$', '', line, flags=re.IGNORECASE).strip()
            if not line:
                continue

            words = line.split()
            if 2 <= len(words) <= 5:
                all_alpha = all(re.match(r'^[A-Za-z.\-]+$', w) for w in words)
                if all_alpha:
                    # Accept Title Case OR ALL CAPS names (common in Indian resumes)
                    title_case_count = sum(1 for w in words if w[0].isupper() and w[1:].islower())
                    all_caps_count   = sum(1 for w in words if w.isupper())
                    if title_case_count >= len(words) * 0.5 or all_caps_count == len(words):
                        # Normalize ALL CAPS to Title Case
                        return ' '.join(w.title() for w in words)

        return ''

    def _extract_field(self, text: str, field: str) -> Optional[str]:
        """Extract a specific field using regex patterns."""
        pattern = self.compiled_patterns.get(field)
        if not pattern:
            return None

        match = pattern.search(text)
        if match:
            # For linkedin/github the pattern captures the username in group 1
            if field == 'linkedin':
                username = match.group(1) if match.lastindex and match.lastindex >= 1 else match.group(0)
                return f'https://linkedin.com/in/{username}'
            if field == 'github':
                username = match.group(1) if match.lastindex and match.lastindex >= 1 else match.group(0)
                # Skip non-user paths
                if username.lower() not in ('issues', 'pulls', 'copilot', 'features', 'marketplace'):
                    return f'https://github.com/{username}'
                return None

            value = match.group(0)
            # Clean up phone numbers
            if field == 'phone':
                # Keep + and digits only, preserve country code
                value = re.sub(r'[.\s\-()]', '', value)
            elif field in ('portfolio',):
                value = value.replace('https://https://', 'https://')
            return value

        # Fallback for LinkedIn/GitHub: look for hyperlink text patterns
        if field == 'linkedin':
            # Match linkedin.com/in/username where username is clean alphanumeric
            m = re.search(r'linkedin\.com/in/([A-Za-z0-9][A-Za-z0-9\-\_]{2,40})', text, re.IGNORECASE)
            if m:
                return f'https://linkedin.com/in/{m.group(1)}'
        if field == 'github':
            m = re.search(r'github\.com/([A-Za-z0-9][A-Za-z0-9\-\_]{2,39})(?:[/\s\n]|$)', text, re.IGNORECASE)
            if m and m.group(1).lower() not in ('issues', 'pulls', 'copilot', 'features'):
                return f'https://github.com/{m.group(1)}'
        return None

    def _extract_skills(self, text: str) -> List[str]:
        """Extract skills section from resume text."""
        skills = []

        # Common technical skills keywords
        TECH_KEYWORDS = [
            'python', 'java', 'javascript', 'typescript', 'c++', 'c#', 'ruby', 'go', 'rust',
            'react', 'angular', 'vue', 'node.js', 'nodejs', 'express', 'django', 'flask',
            'spring', 'spring boot', 'rails', 'laravel', '.net', 'asp.net',
            'sql', 'mysql', 'postgresql', 'mongodb', 'redis', 'elasticsearch',
            'aws', 'azure', 'gcp', 'docker', 'kubernetes', 'terraform', 'jenkins', 'ci/cd',
            'git', 'github', 'gitlab', 'jira', 'agile', 'scrum',
            'html', 'css', 'sass', 'tailwind', 'bootstrap',
            'tensorflow', 'pytorch', 'machine learning', 'deep learning', 'ai', 'data science',
            'linux', 'unix', 'bash', 'shell scripting',
            'rest', 'restful', 'graphql', 'microservices',
            'html5', 'css3', 'responsive design', 'web services',
            'excel', 'tableau', 'power bi', 'data visualization',
            'communication', 'leadership', 'teamwork', 'problem-solving',
        ]

        text_lower = text.lower()
        found = set()

        for skill in TECH_KEYWORDS:
            # Use word boundaries to avoid partial matches
            pattern = r'\b' + re.escape(skill) + r'\b'
            if re.search(pattern, text_lower, re.IGNORECASE):
                # Normalize skill label — preserve uppercase for known acronyms
                normalized = skill.title()
                # Uppercase known acronyms that title() mangles (e.g. "Aws" → "AWS")
                ACRONYM_MAP = {
                    'Aws': 'AWS', 'Gcp': 'GCP', 'Sql': 'SQL', 'Html': 'HTML',
                    'Html5': 'HTML5', 'Css': 'CSS', 'Css3': 'CSS3', 'Api': 'API',
                    'Ai': 'AI', 'Ml': 'ML', 'Ui': 'UI', 'Ux': 'UX',
                    'Ci/Cd': 'CI/CD', 'Rest': 'REST', 'Restful': 'RESTful',
                }
                normalized = ACRONYM_MAP.get(normalized, normalized)
                if normalized not in found:
                    found.add(normalized)
                    skills.append(normalized)

        return skills

    def _parse_pdf(self, content: bytes, filename: str) -> Dict[str, Any]:
        """
        Parse PDF by extracting text content.
        Uses basic PDF text stream extraction when PyPDF2 is unavailable.
        """
        try:
            # Try PyMuPDF (fitz) if available
            try:
                import fitz  # PyMuPDF
                return self._parse_pdf_pymupdf(content, filename)
            except ImportError:
                pass

            # Try PyPDF2 if available
            try:
                import PyPDF2
                return self._parse_pdf_pypdf2(content, filename)
            except ImportError:
                pass

            # Fallback: raw text extraction from PDF streams
            return self._parse_pdf_raw(content, filename)

        except Exception as e:
            logger.exception(f"PDF parsing failed for {filename}: {e}")
            return self._raw_parse(content)

    def _parse_pdf_pymupdf(self, content: bytes, filename: str) -> Dict[str, Any]:
        """Parse PDF using PyMuPDF (fitz) — extracts text AND hyperlinks."""
        import fitz

        text_parts = []
        linkedin_url = None
        github_url = None
        portfolio_url = None

        doc = fitz.open(stream=content, filetype='pdf')
        for page in doc:
            text_parts.append(page.get_text())
            # Extract hyperlinks — catches LinkedIn/GitHub embedded links
            for link in page.get_links():
                uri = link.get('uri', '')
                if not uri:
                    continue
                if 'linkedin.com' in uri and not linkedin_url:
                    linkedin_url = uri
                elif 'github.com' in uri and not github_url:
                    github_url = uri
                elif not portfolio_url and uri.startswith('http') and \
                     'linkedin' not in uri and 'github' not in uri and \
                     'codechef' not in uri and 'hackerrank' not in uri and \
                     'leetcode' not in uri:
                    portfolio_url = uri
        doc.close()

        full_text = '\n'.join(text_parts)
        result = self._parse_text(full_text, filename)

        # Override with hyperlink URLs — more reliable than regex on text
        if linkedin_url:
            result['linkedin'] = linkedin_url
            result['social']['linkedin'] = linkedin_url
            result['contact']['linkedin'] = linkedin_url
        if github_url:
            result['github'] = github_url
            result['social']['github'] = github_url
            result['contact']['github'] = github_url
        if portfolio_url:
            result['portfolio'] = portfolio_url
            result['social']['portfolio'] = portfolio_url

        return result

    def _parse_pdf_pypdf2(self, content: bytes, filename: str) -> Dict[str, Any]:
        """Parse PDF using PyPDF2."""
        import PyPDF2

        text_parts = []
        reader = PyPDF2.PdfReader(io.BytesIO(content))
        for page in reader.pages:
            text_parts.append(page.extract_text() or '')
        full_text = '\n'.join(text_parts)
        return self._parse_text(full_text, filename)

    def _parse_pdf_raw(self, content: bytes, filename: str) -> Dict[str, Any]:
        """
        Fallback PDF parsing: extract text streams from PDF bytes.
        Less accurate but works without any external libraries.
        """
        # Extract text between BT/ET (Begin Text/End Text) markers
        text_blocks = re.findall(r'BT(.*?)ET', content.decode('latin-1', errors='replace'), re.DOTALL)
        lines = []

        for block in text_blocks:
            # Extract strings in parentheses (PDF string format)
            strings = re.findall(r'\(([^)]*)\)', block)
            for s in strings:
                decoded = self._pdf_decode_string(s)
                if decoded and any(c.isalpha() for c in decoded):
                    lines.append(decoded)

        full_text = '\n'.join(lines)
        return self._parse_text(full_text, filename)

    def _pdf_decode_string(self, s: str) -> str:
        """Decode escaped PDF strings."""
        if not s:
            return ''
        # Handle common PDF escape sequences
        s = s.replace('\\n', '\n').replace('\\r', '\r').replace('\\t', '\t')
        s = s.replace('\\(', '(').replace('\\)', ')').replace('\\\\', '\\')
        # Remove non-printable characters
        s = ''.join(c for c in s if c.isprintable() or c in '\n\r\t')
        return s.strip()

    def _parse_docx(self, content: bytes, filename: str) -> Dict[str, Any]:
        """
        Parse DOCX using built-in zipfile + xml.
        DOCX is a ZIP file containing XML documents.
        """
        try:
            import zipfile

            full_text_parts = []
            with zipfile.ZipFile(io.BytesIO(content), 'r') as zf:
                # Parse main document XML
                try:
                    with zf.open('word/document.xml') as doc_xml:
                        xml_content = doc_xml.read()
                        text = self._extract_docx_text(xml_content)
                        if text:
                            full_text_parts.append(text)
                except KeyError:
                    pass

                # Parse headers
                for name in zf.namelist():
                    if name.startswith('word/header') and name.endswith('.xml'):
                        try:
                            with zf.open(name) as header_xml:
                                text = self._extract_docx_text(header_xml.read())
                                if text:
                                    full_text_parts.append(text)
                        except Exception:
                            pass

            full_text = '\n'.join(full_text_parts)
            return self._parse_text(full_text, filename)

        except Exception as e:
            logger.exception(f"DOCX parsing failed for {filename}: {e}")
            return self._raw_parse(content)

    def _extract_docx_text(self, xml_content: bytes) -> str:
        """Extract text from DOCX XML content."""
        try:
            import xml.etree.ElementTree as ET

            root = ET.fromstring(xml_content)
            # Define namespace
            ns = {'w': 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'}
            # Extract all text nodes
            paragraphs = root.findall('.//w:p', ns)
            lines = []
            for para in paragraphs:
                texts = para.findall('.//w:t', ns)
                line = ''.join(t.text or '' for t in texts)
                if line.strip():
                    lines.append(line)
            return '\n'.join(lines)
        except Exception:
            # Fallback: regex extraction
            text_matches = re.findall(r'<w:t[^>]*>([^<]*)</w:t>', xml_content.decode('utf-8', errors='replace'))
            return '\n'.join(text_matches)

    def _parse_text(self, text: str, filename: str) -> Dict[str, Any]:
        """
        Core parsing logic: extract structured data from plain text.
        """
        # Normalize whitespace
        text = re.sub(r'\r\n', '\n', text)
        text = re.sub(r'[ \t]+', ' ', text)
        text = re.sub(r'\n{3,}', '\n\n', text)

        # Extract all expensive fields once
        name        = self._extract_name(text)
        name_parts  = name.split() if name else []
        first_name  = name_parts[0] if name_parts else ''
        last_name   = ' '.join(name_parts[1:]) if len(name_parts) > 1 else ''
        email       = self._extract_field(text, 'email')
        phone       = self._extract_field(text, 'phone')
        linkedin    = self._extract_field(text, 'linkedin')
        github      = self._extract_field(text, 'github')
        portfolio   = self._extract_field(text, 'portfolio')
        years_exp   = self._extract_field(text, 'years_experience')
        skills      = self._extract_skills(text)
        city        = self._extract_city_from_text(text)
        summary     = self._extract_section(text, ['summary', 'objective', 'profile', 'about'])
        projects    = self._extract_section(text, ['project', 'portfolio', 'work sample'])
        experience  = self._extract_experience(text)
        education   = self._extract_education(text)

        # ── New fields ────────────────────────────────────────────────────────
        dob             = self._extract_dob(text)
        address         = self._extract_address(text, city)
        country         = self._extract_country(text)
        state           = self._extract_state(text, city)
        zip_code        = self._extract_field(text, 'zip_code')
        gender          = self._extract_gender(text)
        nationality     = self._extract_nationality(text)
        work_auth       = self._extract_work_authorization(text)
        notice_period   = self._extract_field(text, 'notice_period')
        salary          = self._extract_field(text, 'salary')
        relocation      = self._extract_relocation(text)
        languages       = self._extract_languages(text)
        certifications  = self._extract_certifications(text)

        # Current job info from most recent experience entry
        current_title   = experience[0].get('title', '')   if experience else ''
        current_company = experience[0].get('company', '') if experience else ''

        return {
            'resume':           filename,
            'name':             name,
            'email':            email,
            'phone':            phone,
            'linkedin':         linkedin,
            'github':           github,
            'portfolio':        portfolio,
            'years_experience': years_exp or '',
            'skills':           skills,
            'summary':          summary,
            'projects':         projects,
            'experience':       experience,
            'education':        education,
            'raw_text':         text[:3000],
            'parsed_at':        datetime.utcnow().isoformat() + 'Z',
            'parse_method':     'document',

            # Personal details
            'first_name':       first_name,
            'last_name':        last_name,
            'dob':              dob,
            'gender':           gender,
            'nationality':      nationality,

            # Contact & location
            'city':             city,
            'address':          address,
            'state':            state,
            'country':          country,
            'zip_code':         zip_code or '',

            # Professional context
            'current_title':    current_title,
            'current_company':  current_company,
            'work_authorization': work_auth,
            'notice_period':    notice_period or '',
            'salary_expectation': salary or '',
            'willing_to_relocate': relocation,
            'languages':        languages,
            'certifications':   certifications,

            # Nested structures (legacy support)
            'contact': {
                'email':    email,
                'phone':    phone,
                'city':     city,
                'address':  address,
                'state':    state,
                'country':  country,
                'zip_code': zip_code or '',
                'linkedin': linkedin,
                'github':   github,
            },
            'personal': {
                'full_name':  name,
                'first_name': first_name,
                'last_name':  last_name,
                'dob':        dob,
                'gender':     gender,
                'nationality': nationality,
            },
            'social': {
                'linkedin':  linkedin,
                'github':    github,
                'portfolio': portfolio,
            },
            'professional': {
                'current_title':   current_title,
                'current_company': current_company,
                'years_experience': years_exp or '',
                'notice_period':   notice_period or '',
                'salary_expectation': salary or '',
                'willing_to_relocate': relocation,
                'work_authorization': work_auth,
            },
        }

    def _extract_section(self, text: str, keywords: list) -> str:
        """Extract a named section from resume text (e.g. Summary, Projects)."""
        lines = text.split('\n')
        in_section = False
        section_lines = []

        for line in lines:
            stripped = line.strip()
            if not stripped:
                if in_section and section_lines:
                    section_lines.append('')
                continue

            # Check if this line is a section header matching our keywords
            lower = stripped.lower().replace(':', '').replace('-', ' ').strip()
            is_header = (
                len(stripped) < 40 and
                any(kw in lower for kw in keywords) and
                (stripped.isupper() or re.match(r'^[A-Z][a-zA-Z\s\-&]+$', stripped))
            )

            if is_header:
                # Start collecting this section (stop at next header)
                if section_lines:
                    break  # already found a section, stop at next header
                in_section = True
                continue

            if in_section:
                # Stop if we hit another section header
                is_next_header = (
                    len(stripped) < 40 and
                    stripped.isupper() and
                    not stripped[0].isdigit()
                ) or re.match(r'^(EXPERIENCE|EDUCATION|SKILLS|CERTIF|AWARD|HONOR|LANGUAGE|REFERENCE|WORK|EMPLOY|FREELANCE|TECHNICAL|PROJECTS?)', stripped, re.IGNORECASE)

                if is_next_header and section_lines:
                    break
                section_lines.append(stripped)

        result = ' '.join(s for s in section_lines if s).strip()
        return result[:500] if result else ''

    def _extract_experience(self, text: str) -> list:
        """Extract work experience entries from resume text."""
        entries = []
        lines = text.split('\n')
        in_exp = False

        i = 0
        while i < len(lines):
            line = lines[i].strip()
            # Find experience section header (ALL CAPS or title case)
            if re.match(r'^(freelance\s+experience|work\s+experience|experience|employment|work\s+history)\s*$',
                        line, re.IGNORECASE):
                in_exp = True
                i += 1
                continue

            if in_exp:
                # Stop at next major section
                if re.match(r'^(technical skills|skills|projects?|education|certif|award|language|reference|summary|publication)',
                            line, re.IGNORECASE) and len(line) < 60:
                    break

                # Pattern: job title on one line, date range on the NEXT line
                # e.g. "Freelance Software Developer" then "2025 - Present"
                date_m = re.search(
                    r'(20\d{2}|19\d{2})\s*[-–—to]+\s*(20\d{2}|Present|Current|\d{4})',
                    line, re.IGNORECASE
                )
                if date_m:
                    # Collect up to 3 previous non-empty lines before the date
                    prev_lines = []
                    for back in range(1, 5):
                        idx_back = i - back
                        if idx_back < 0:
                            break
                        candidate = lines[idx_back].strip()
                        if not candidate:
                            continue
                        # Stop if we hit section header or another date line
                        if re.match(r'^(freelance\s+experience|work\s+experience|experience|employment|work\s+history|education|skills|projects)', candidate, re.IGNORECASE):
                            break
                        if re.search(r'(20\d{2}|19\d{2})\s*[-–—to]+', candidate, re.IGNORECASE):
                            break
                        # Skip bullet/description lines — they belong to the PREVIOUS entry
                        if candidate and candidate[0] in ('•', '-', '–', '▪', '*', 'ò'):
                            break
                        if re.match(r'^(Developed|Built|Created|Implemented|Designed|Led|Managed|Worked|Collaborated|Achieved|Improved|Reduced|Increased|Delivered|Supported|Maintained|Automated)', candidate, re.IGNORECASE):
                            break
                        prev_lines.append(candidate)

                    # Heuristic: job titles are usually action/role words; company names are proper nouns
                    # Format A: [title]  → date              (1 prev line)
                    # Format B: [title, company] → date      (2 prev lines)
                    # Format C: [title, company, location] → date (3 prev lines)
                    title_line   = ''
                    company_line = ''

                    if len(prev_lines) >= 2:
                        # Line closest to date is more likely to be company/location
                        # Line further from date is more likely to be job title
                        candidate_title   = prev_lines[-1]  # furthest from date = title
                        candidate_company = prev_lines[0]   # closest to date = company

                        # A line is a job title if it has title-like words
                        TITLE_KEYWORDS = r'(engineer|developer|analyst|manager|intern|designer|consultant|lead|architect|officer|director|scientist|specialist|coordinator|associate|executive|administrator|head|vp|president|founder|co-founder|freelance)'
                        COMPANY_SUFFIX  = r'(LLC|Inc|Ltd|Corp|Co\.|GmbH|Pvt|Technologies|Solutions|Systems|Services|Group|Labs|Studio|Agency|Software|Tech)'

                        if re.search(TITLE_KEYWORDS, candidate_title, re.IGNORECASE):
                            title_line   = candidate_title
                            company_line = candidate_company
                        elif re.search(COMPANY_SUFFIX, candidate_company, re.IGNORECASE):
                            title_line   = candidate_title
                            company_line = candidate_company
                        else:
                            # Can't tell — use first as title
                            title_line   = candidate_title
                            company_line = candidate_company
                    elif len(prev_lines) == 1:
                        title_line = prev_lines[0]

                    # Sanitize
                    if len(title_line)   > 100: title_line   = title_line[:100]
                    if len(company_line) > 80:  company_line = ''

                    entry = {
                        'title':   title_line,
                        'company': company_line,
                        'from':    date_m.group(1),
                        'to':      date_m.group(2),
                    }

                    # Collect description from subsequent bullet lines
                    desc_lines = []
                    j = i + 1
                    while j < min(i + 10, len(lines)):
                        nl = lines[j].strip()
                        if not nl:
                            j += 1
                            continue
                        # Stop if next title/date found
                        if re.search(r'(20\d{2}|19\d{2})\s*[-–—]', nl):
                            break
                        if re.match(r'^(technical skills|skills|projects|education|certif)', nl, re.IGNORECASE):
                            break
                        # Bullet points → description
                        if nl[0] in ('ò','•','-','–','▪','*') or nl.startswith('Developed') or \
                           nl.startswith('Built') or nl.startswith('Created') or nl.startswith('Implemented'):
                            desc_lines.append(nl.lstrip('ò•-–▪* ').strip())
                        j += 1

                    entry['description'] = ' '.join(desc_lines[:4])
                    # If still no company and title has "freelance", mark company as Freelance
                    if not entry.get('company'):
                        if 'freelance' in entry.get('title', '').lower():
                            entry['company'] = 'Freelance'

                    if entry.get('title') and not any(
                        e.get('title', '').lower() == entry['title'].lower() for e in entries
                    ):
                        entries.append(entry)

            i += 1
        return entries[:5]

    def _extract_education(self, text: str) -> list:
        """Extract ALL education entries (B.Tech, 12th/Intermediate, 10th/SSC)."""
        entries = []
        lines = text.split('\n')
        in_edu = False

        i = 0
        while i < len(lines):
            line = lines[i].strip()
            if re.match(r'^education\s*$', line, re.IGNORECASE):
                in_edu = True
                i += 1
                continue
            if in_edu:
                # Stop at next major section
                if re.match(
                    r'^(technical skills|skills|experience|projects|freelance|certif|award|language|reference|extra|publication)',
                    line, re.IGNORECASE) and len(line) < 60:
                    break

                # An institution line must contain a real institution keyword
                # Do NOT match degree strings like "Intermediate (MPC)", "B.Tech", "10th"
                is_real_institution = (
                    len(line) > 5 and
                    re.search(
                        # Generic institution keywords — works for any school/college/university worldwide
                        r'(university|college|school|institute|board|academy|polytechnic|'
                        r'chse|cbse|icse|igcse|ib\b|state board|matriculation|'
                        r'sr\.?\s*sec|senior\s+sec|higher\s+sec)',
                        line, re.IGNORECASE
                    ) and
                    # Must NOT be just a degree string (e.g. "High School Diploma", "Secondary School (10th)")
                    not re.match(
                        r'^(b\.?tech|m\.?tech|bsc|msc|intermediate|12th|10th|ssc|hsc|diploma|'
                        r'bachelor|master|mpc|cec|bipc|high\s+school\s+diploma|'
                        r'secondary\s+school\s*[\(\-]?|higher\s+secondary|senior\s+secondary)\b',
                        line, re.IGNORECASE
                    )
                )

                if is_real_institution:
                    entry = {'institution': line.strip()}
                    j = i + 1
                    while j < min(i + 7, len(lines)):
                        next_line = lines[j].strip()
                        if not next_line:
                            j += 1
                            continue
                        # Date range
                        date_m = re.search(
                            r'(20\d{2}|19\d{2}|\d{4})\s*[–\-–to]+\s*(20\d{2}|19\d{2}|Present|\d{4})',
                            next_line, re.IGNORECASE
                        )
                        if date_m and not entry.get('from'):
                            entry['from'] = date_m.group(1)
                            entry['to']   = date_m.group(2)
                        # Degree line
                        elif not entry.get('degree') and \
                             re.search(r'(b\.?tech|m\.?tech|bsc|msc|ba|ma|be|me|bca|mca|'
                                       r'12th|10th|inter|intermediate|ssc|hsc|diploma|'
                                       r'bachelor|master|engineering|science|arts|commerce|mpc|cec)',
                                       next_line, re.IGNORECASE) and len(next_line) < 80:
                            entry['degree'] = next_line.strip()
                        # GPA / percentage
                        elif re.search(r'(cgpa|gpa|%|grade|percentage)', next_line, re.IGNORECASE):
                            gpa_m = re.search(r'[\d.]+', next_line)
                            if gpa_m and not entry.get('gpa'):
                                entry['gpa'] = gpa_m.group(0)
                        j += 1

                    # Do NOT infer/fabricate degree — only use what's in the resume.
                    # If no degree text was found near this institution, leave it empty.

                    # Special case: if institution contains CBSE/ICSE/board keywords
                    # and no degree was found, infer it as "10th" / "Secondary"
                    if not entry.get('degree'):
                        inst_lower = entry.get('institution', '').lower()
                        if 'cbse' in inst_lower or 'icse' in inst_lower or 'igcse' in inst_lower or 'state board' in inst_lower:
                            entry['degree'] = '10th (Secondary)'
                        elif 'junior college' in inst_lower or 'intermediate' in inst_lower:
                            entry['degree'] = 'Intermediate'

                    # Derive field_of_study from degree string
                    deg = (entry.get('degree') or '').strip()
                    fos = None
                    # "B.Tech in Computer Science and Engineering (Cyber Security)" → "Computer Science and Engineering"
                    m_in = re.search(r'\bin\s+([^(\n]+?)(?:\s*\([^)]*\))?\s*$', deg, re.IGNORECASE)
                    if m_in:
                        fos = m_in.group(1).strip()
                    elif re.search(r'mpc|mathematics|physics|chemistry', deg, re.IGNORECASE):
                        fos = 'Mathematics, Physics, Chemistry'
                    elif re.search(r'bipc|biology', deg, re.IGNORECASE):
                        fos = 'Biology, Physics, Chemistry'
                    elif re.search(r'cec|commerce|economics', deg, re.IGNORECASE):
                        fos = 'Commerce, Economics'
                    elif re.search(r'10th|ssc|secondary|cbse|icse', deg, re.IGNORECASE):
                        fos = 'General'
                    if fos:
                        entry['field_of_study'] = fos

                    # Avoid duplicates
                    if entry.get('institution') and not any(
                        e.get('institution','').lower() == entry['institution'].lower()
                        for e in entries
                    ):
                        entries.append(entry)
            i += 1
        return entries[:3]

    def _extract_city_from_text(self, text: str) -> str:
        """Extract city/location hint from text."""
        # Pattern 1: "City, State" or "City, ST" on its own line (header area)
        city_pattern = re.compile(
            r'\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?),\s*([A-Z]{2}|[A-Z][a-z]+)\b',
            re.MULTILINE
        )
        for match in city_pattern.finditer(text[:1000]):  # only check header area
            city, state = match.groups()
            if city.lower() not in ('resume', 'curriculum', 'name', 'email', 'phone'):
                return f"{city}, {state}"

        # Pattern 2: Known Indian/major cities mentioned near the top of resume
        KNOWN_CITIES = [
            'Hyderabad', 'Bangalore', 'Bengaluru', 'Mumbai', 'Delhi', 'Chennai',
            'Kolkata', 'Pune', 'Ahmedabad', 'Jaipur', 'Surat', 'Lucknow',
            'Visakhapatnam', 'Vizag', 'Coimbatore', 'Nagpur', 'Noida', 'Gurgaon',
            'Chandigarh', 'Indore', 'Bhopal', 'Kochi', 'Thiruvananthapuram',
            'New York', 'San Francisco', 'Seattle', 'Austin', 'Chicago', 'Boston',
            'Los Angeles', 'London', 'Toronto', 'Singapore', 'Dubai', 'Sydney',
        ]
        header_text = text[:800]
        for city in KNOWN_CITIES:
            if city.lower() in header_text.lower():
                # Verify it's not part of a company/institution name
                # by checking surrounding context is not "University of X" or "X Corp"
                idx = header_text.lower().find(city.lower())
                context_start = max(0, idx - 30)
                context_end   = min(len(header_text), idx + len(city) + 30)
                ctx = header_text[context_start:context_end].lower()
                if not any(w in ctx for w in ['university', 'college', 'institute', 'school', 'corp', 'pvt', 'ltd']):
                    return city

        # Pattern 3: "Location: City" or "City | State" in header
        loc_match = re.search(r'(?:location|address|city)[:\s]+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)', text[:500], re.IGNORECASE)
        if loc_match:
            return loc_match.group(1).strip()

        return ''

    # ─── New extraction helpers ───────────────────────────────────────────────

    def _extract_dob(self, text: str) -> str:
        """Extract date of birth from resume text."""
        # Look only in the header area (first 600 chars)
        header = text[:600]
        pattern = re.compile(
            r'(?:dob|date\s+of\s+birth|born|birth\s+date|birthdate)[:\s]+'
            r'(\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4}'
            r'|\d{1,2}\s+\w+\s+\d{4}'
            r'|\w+\s+\d{1,2},?\s+\d{4}'
            r'|\d{4}[\/\-\.]\d{1,2}[\/\-\.]\d{1,2})',
            re.IGNORECASE
        )
        m = pattern.search(header)
        if m:
            return m.group(1).strip()
        return ''

    def _extract_address(self, text: str, city: str) -> str:
        """Extract street address from resume."""
        # Look for "Address:", "H.No", "Plot No", "Flat", "Door No"
        pattern = re.compile(
            r'(?:address|residing\s+at|h\.?\s*no|plot\s+no|flat\s+no|door\s+no|'
            r'#\s*\d+|street|road|lane|avenue|nagar|colony)[:\s,]+([^\n]{5,80})',
            re.IGNORECASE
        )
        m = pattern.search(text[:1000])
        if m:
            addr = m.group(1).strip().rstrip(',.')
            # Trim if it absorbed the city
            if city and city.lower() in addr.lower():
                addr = addr[:addr.lower().find(city.lower())].strip().rstrip(',')
            if len(addr) > 5:
                return addr
        return ''

    def _extract_state(self, text: str, city: str) -> str:
        """Extract state/province from resume."""
        # Common Indian states
        STATES = {
            'andhra pradesh': 'Andhra Pradesh', 'telangana': 'Telangana',
            'karnataka': 'Karnataka', 'tamil nadu': 'Tamil Nadu',
            'maharashtra': 'Maharashtra', 'gujarat': 'Gujarat',
            'delhi': 'Delhi', 'uttar pradesh': 'Uttar Pradesh',
            'rajasthan': 'Rajasthan', 'west bengal': 'West Bengal',
            'kerala': 'Kerala', 'punjab': 'Punjab', 'haryana': 'Haryana',
            'madhya pradesh': 'Madhya Pradesh',
            # US states abbreviations
            'ca': 'CA', 'ny': 'NY', 'tx': 'TX', 'wa': 'WA', 'ma': 'MA',
            'fl': 'FL', 'il': 'IL', 'ga': 'GA', 'nc': 'NC', 'va': 'VA',
        }
        header = text[:800].lower()
        for state_lower, state_display in STATES.items():
            if re.search(r'\b' + re.escape(state_lower) + r'\b', header):
                return state_display
        # Pattern: "City, State" → extract the state part
        if city:
            m = re.search(re.escape(city) + r',\s*([A-Za-z\s]{2,25})(?:\s|,|\n|$)', text[:600], re.IGNORECASE)
            if m:
                st = m.group(1).strip().rstrip(',.')
                if 2 <= len(st) <= 25:
                    return st
        return ''

    def _extract_country(self, text: str) -> str:
        """Extract country from resume."""
        COUNTRIES = [
            'india', 'united states', 'usa', 'united kingdom', 'uk',
            'canada', 'australia', 'germany', 'singapore', 'uae',
            'new zealand', 'netherlands', 'france', 'sweden',
        ]
        DISPLAY = {
            'india': 'India', 'united states': 'United States', 'usa': 'United States',
            'united kingdom': 'United Kingdom', 'uk': 'United Kingdom',
            'canada': 'Canada', 'australia': 'Australia', 'germany': 'Germany',
            'singapore': 'Singapore', 'uae': 'UAE', 'new zealand': 'New Zealand',
            'netherlands': 'Netherlands', 'france': 'France', 'sweden': 'Sweden',
        }
        header = text[:800].lower()
        for c in COUNTRIES:
            if re.search(r'\b' + re.escape(c) + r'\b', header):
                return DISPLAY.get(c, c.title())
        return ''

    def _extract_gender(self, text: str) -> str:
        """Extract gender if explicitly stated in resume."""
        m = re.search(
            r'(?:gender|sex)[:\s]+(male|female|non[- ]binary|prefer\s+not\s+to\s+say)',
            text[:600], re.IGNORECASE
        )
        if m:
            return m.group(1).strip().title()
        return ''

    def _extract_nationality(self, text: str) -> str:
        """Extract nationality from resume."""
        m = re.search(
            r'(?:nationality|citizenship)[:\s]+([A-Za-z\s]{3,30})',
            text[:600], re.IGNORECASE
        )
        if m:
            nat = m.group(1).strip().rstrip('.,')
            if len(nat) <= 30:
                return nat.title()
        return ''

    def _extract_work_authorization(self, text: str) -> str:
        """Extract work authorization status."""
        text_lower = text[:1000].lower()
        # Check for common work auth phrases
        if re.search(r'authorized\s+to\s+work|work\s+authori[sz]', text_lower):
            if re.search(r'\byes\b|authorized', text_lower):
                return 'Authorized to work'
        if re.search(r'citizen|permanent\s+resident', text_lower):
            return 'Citizen/Permanent Resident'
        if re.search(r'\bvisa\b', text_lower):
            m = re.search(r'(h[- ]?1b|l[- ]?1|f[- ]?1|opt|cpt|student\s+visa|work\s+visa)', text_lower)
            if m:
                return m.group(1).upper()
        # Default for Indian candidates: assume yes for Indian companies
        if re.search(r'india|indian', text_lower):
            return 'Yes'
        return 'Yes'  # default conservative answer

    def _extract_relocation(self, text: str) -> str:
        """Extract relocation willingness."""
        text_lower = text[:1000].lower()
        if re.search(r'willing\s+to\s+relocat|open\s+to\s+relocat|relocat', text_lower):
            if re.search(r'\byes\b|willing|open', text_lower):
                return 'Yes'
            if re.search(r'\bno\b|not\s+willing', text_lower):
                return 'No'
        return 'Yes'  # default optimistic

    def _extract_languages(self, text: str) -> List[str]:
        """Extract languages spoken."""
        langs = []
        m = re.search(
            r'(?:languages?|language\s+skills?|known\s+languages?)[:\s]+([^\n]{3,120})',
            text, re.IGNORECASE
        )
        if m:
            raw = m.group(1)
            # Split on comma, semicolon, slash, |
            parts = re.split(r'[,;/|]', raw)
            for p in parts:
                p = p.strip().rstrip('.')
                # Only keep plausible language names (2-25 chars, no digits)
                if 2 <= len(p) <= 25 and not re.search(r'\d', p):
                    langs.append(p.title())
        # Always include English if resume is in English
        if text and not any('english' in l.lower() for l in langs):
            langs.insert(0, 'English')
        return langs[:6]

    def _extract_certifications(self, text: str) -> List[str]:
        """Extract certifications and licenses."""
        certs = []
        m = re.search(
            r'(?:certifications?|licenses?|credentials?|accreditations?)[:\s]*\n((?:[^\n]+\n?){1,8})',
            text, re.IGNORECASE
        )
        if m:
            block = m.group(1)
            for line in block.split('\n'):
                line = line.strip().lstrip('•-*▪ ')
                if 5 <= len(line) <= 100 and not re.match(
                    r'^(education|experience|skills|projects|summary)', line, re.IGNORECASE
                ):
                    certs.append(line)
        return certs[:8]
