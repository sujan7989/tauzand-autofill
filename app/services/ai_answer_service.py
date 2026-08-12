"""
AI Answer Service
Generates context-aware answers for open-ended job application questions.
Uses NVIDIA NIM (Mistral) when available, falls back to template-based answers.
"""
import logging
import re
from typing import Dict, Any, Optional
from datetime import datetime

logger = logging.getLogger(__name__)


# #"##"##"# Question type detection #"##"##"##"##"##"##"##"##"##"##"##"##"##"##"##"##"##"##"##"##"##"##"##"##"##"##"##"##"##"##"##"##"##"##"##"##"##"##"##"##"##"##"##"##"##"##"##"##"#
QUESTION_PATTERNS = {
    'cover_letter': [
        'cover letter', 'covering letter', 'letter of interest',
        'motivation letter', 'application letter'
    ],
    'why_company': [
        'why do you want', 'why this company', 'why google', 'why microsoft',
        'why amazon', 'why us', 'why our company', 'why tauzand', 'why join',
        'what interests you', 'what attracts you', 'why are you interested',
        'why wise', 'why apply', 'reason for applying', 'motivated to apply',
        'interest in', 'excited about', 'message to', 'message to hiring',
        'let the company know', 'company know', 'interest working',
    ],
    'about_yourself': [
        'tell us about yourself', 'describe yourself', 'introduce yourself',
        'about you', 'who are you', 'brief introduction', 'tell me about yourself',
        'professional summary', 'personal statement', 'about yourself',
        'headline', 'tagline', 'bio', 'summary', 'introduction', 'brief intro',
        'one liner', 'what do you do', 'your story', 'tell us more',
        'background', 'introduce',
    ],
    'strengths': [
        'strength', 'what are you good at', 'your best quality',
        'what makes you stand out', 'key skills', 'expertise'
    ],
    'experience': [
        'describe your experience', 'relevant experience', 'work experience',
        'professional experience', 'your experience with',
        'have you worked with', 'previous experience'
    ],
    'project': [
        'describe a project', 'tell us about a project', 'notable project',
        'significant project', 'project you worked on', 'personal project',
        'side project', 'open source', 'best project', 'proud of',
        'describe your best', 'your project', 'projects you',
        'tell about project', 'about your project',
    ],
    'challenge': [
        'challenge', 'difficult situation', 'problem you solved',
        'obstacle', 'how did you handle', 'what was the hardest'
    ],
    'goals': [
        'career goal', 'where do you see yourself', '5 years', 'long term',
        'short term goal', 'career plan', 'ambition', 'aspiration'
    ],
    'salary': [
        'salary expectation', 'expected salary', 'compensation', 'ctc',
        'current ctc', 'last drawn', 'expected ctc', 'desired ctc',
        'package', 'pay expectation', 'salary requirement', 'current salary',
        'current pay', 'last salary', 'salary range', 'cost to company',
        'expected package', 'desired salary', 'offer expectation',
    ],
    'how_did_you_hear': [
        'how did you hear', 'how did you find', 'how did you learn',
        'how you heard', 'referral', 'source of', 'found this',
        'job source', 'referred by', 'discover this', 'how did you come to know',
        'how do you know about', 'come to know about', 'know about us',
        'know about this', 'hear about this', 'hear about us',
    ],
    'relocation': [
        'willing to relocate', 'open to reloc', 'relocation', 'relocate',
        'willing to move', 'able to relocate',
    ],
    'availability': [
        'when can you start', 'notice period', 'joining date', 'available from',
        'start date', 'availability'
    ],
    'additional_info': [
        'anything else', 'additional information', 'other information',
        'is there anything', 'anything you would like to add',
        'additional comments', 'anything you want us to know'
    ],
}


def detect_question_type(label: str) -> str:
    """Detect the type of question from the field label."""
    label_lower = label.lower()
    for qtype, patterns in QUESTION_PATTERNS.items():
        for pattern in patterns:
            if pattern in label_lower:
                return qtype
    return 'general'


def extract_profile_summary(profile: Dict[str, Any]) -> Dict[str, str]:
    """Extract key fields from the profile for answer generation."""
    def get(d, *keys):
        for k in keys:
            if isinstance(d, dict) and k in d and d[k]:
                return str(d[k])
        return ''

    name       = get(profile, 'name', 'full_name') or \
                 get(profile.get('personal', {}), 'full_name', 'name')
    first      = get(profile, 'first_name') or \
                 get(profile.get('personal', {}), 'first_name')
    email      = get(profile, 'email') or get(profile.get('contact', {}), 'email')
    phone      = get(profile, 'phone') or get(profile.get('contact', {}), 'phone')
    skills_raw = profile.get('skills', [])
    # Filter out non-skills (platforms, tools that aren't skills)
    NOT_SKILLS = {'github', 'linkedin', 'gmail', 'outlook', 'windows', 'android', 'ios'}
    if isinstance(skills_raw, list):
        skills_raw = [s for s in skills_raw if s.lower() not in NOT_SKILLS]
    skills = ', '.join(skills_raw) if isinstance(skills_raw, list) else str(skills_raw or '')
    # Supplement skills from summary text if skill list is very short
    if len(skills_raw if isinstance(skills_raw, list) else []) < 4 and get(profile, 'summary'):
        import re as _re3
        skill_words = _re3.findall(r'\b(Python|Java(?:Script)?|TypeScript|React|Angular|Vue|Node|Django|Flask|SQL|MongoDB|AWS|Docker|Git|HTML|CSS|REST|API|Linux|C\+\+|Golang|Rust|Kubernetes|TensorFlow|PyTorch)\b', get(profile, 'summary'), _re3.IGNORECASE)
        extra = list(dict.fromkeys([s.strip() for s in skill_words]))
        if extra:
            existing = set(s.strip().lower() for s in (skills_raw if isinstance(skills_raw, list) else []))
            new_skills = [s for s in extra if s.lower() not in existing]
            if new_skills:
                skills = (skills + ', ' + ', '.join(new_skills)).strip(', ')
    linkedin   = get(profile, 'linkedin') or get(profile.get('social', {}), 'linkedin')
    github     = get(profile, 'github')   or get(profile.get('social', {}), 'github')
    exp        = get(profile, 'years_experience')
    # If years_experience is empty, try to derive it from experience list length/dates
    if not exp:
        exp_list = profile.get('experience', [])
        if isinstance(exp_list, list) and len(exp_list) > 0:
            exp = str(len(exp_list)) + (' year' if len(exp_list) == 1 else ' years')
    resume_fn  = get(profile, 'resume')
    summary    = get(profile, 'summary')
    # Fix PDF hyphenated words (e.g. "commu- nication" ##' "communication")
    if summary:
        import re as _re4
        summary = _re4.sub(r'(\w+)-\s+(\w+)', lambda m: m.group(1)+m.group(2) if len(m.group(1))<6 else m.group(0), summary)
        summary = summary.replace('  ', ' ').strip()
    projects   = get(profile, 'projects')
    # If no projects text, use experience description ##" it's the actual work done
    if not projects:
        exp_list = profile.get('experience', [])
        if isinstance(exp_list, list):
            for e in exp_list:
                if isinstance(e, dict) and e.get('description'):
                    projects = e['description'][:300]
                    break
    # Clean any unicode bullet chars that come from PDF parsing
    if projects:
        import re as _re2
        projects = _re2.sub(r'[^\x00-\x7F]+', ' ', projects)
        projects = _re2.sub(r'\s+', ' ', projects).strip()

    return {
        'name':     name or first or 'the candidate',
        'first':    first or (name.split()[0] if name else 'I'),
        'email':    email,
        'phone':    phone,
        'skills':   skills or '',
        'linkedin': linkedin,
        'github':   github,
        'experience': exp or '',
        'resume':   resume_fn or '',
        'summary':  summary or '',
        'projects': projects or '',
    }


# #"##"##"# Template-based answer generator (no AI needed) #"##"##"##"##"##"##"##"##"##"##"##"##"##"##"##"##"##"##"##"##"##"##"##"##"#

def template_answer(qtype: str, profile_summary: Dict[str, str],
                    context: Dict[str, Any]) -> str:
    """Generate a fully personalized answer using real resume data."""
    name     = profile_summary['name']
    first    = profile_summary['first']
    skills   = profile_summary['skills']
    exp      = profile_summary['experience']
    company  = context.get('company_name', 'your company')
    job      = context.get('job_title', 'this role')
    summary  = profile_summary.get('summary', '')
    projects = profile_summary.get('projects', '')

    # Build rich context from actual resume data
    # Clean special characters (##, ##", etc.) that may come from PDF parsing
    import re as _re
    def clean(s): return _re.sub(r'[^\x00-\x7F]+', ' ', s or '').strip()

    summary  = clean(summary)
    projects = clean(projects)
    skills_list = [s.strip() for s in skills.split(',')][:5] if skills else []
    top_skills  = ', '.join(skills_list[:3]) if skills_list else ''
    all_skills  = skills if skills else ''

    # Determine experience descriptor from actual resume value
    if exp and exp not in ('', 'Fresher', 'fresher'):
        exp_phrase = f'{exp} of experience'
        exp_intro  = f'With my {exp} of experience'
    else:
        exp_phrase = 'experience'
        exp_intro  = 'As a motivated professional'

    # Extract first project name and description
    # Handle PDF separator characters (##, ##, ###, ##")
    project_name = ''
    project_desc = ''
    if projects:
        # Clean PDF special chars: ## bullet, ## dash, em-dash, en-dash variants
        import unicodedata
        clean_proj = ''.join(
            ' ' if unicodedata.category(c) in ('Cf','Cc','So','Sm','Sk','Sc','Ps','Pe') or ord(c) > 127
            else c for c in projects
        )
        clean_proj = clean_proj.replace('  ', ' ').strip()
        lines = [l.strip() for l in clean_proj.replace('. ', '\n').split('\n') if l.strip() and len(l.strip()) > 5]
        if lines:
            project_name = lines[0][:80]
            project_desc = ' '.join(lines[:4])[:400]

    answers = {
        'cover_letter': (
            f"Dear Hiring Manager,\n\n"
            f"I am writing to express my strong interest in the {job} position"
            f"{' at ' + company if company != 'your company' else ''}. "
            f"{exp_intro}{', specializing in ' + top_skills if top_skills else ''}, "
            f"I am excited about the opportunity to contribute to your team.\n\n"
            f"{summary[:200] + '.' if summary else ('I have hands-on experience in ' + all_skills + '.' if all_skills else '')}\n\n"
            f"{('One of my key projects, ' + project_name + ', demonstrates my ability to deliver real-world solutions. ' + project_desc[:150]) if project_name else ''}\n\n"
            f"I am confident that my skills{' in ' + top_skills if top_skills else ''} align well "
            f"with the requirements of this role. "
            f"Thank you for considering my application.\n\n"
            f"Sincerely,\n{name}"
        ),
        'why_company': (
            f"I am excited about this opportunity because it aligns well with my background"
            f"{' in ' + top_skills if top_skills else ''}. "
            f"{exp_intro}, I am looking for a role where I can contribute meaningfully and grow. "
            f"The {job} position"
            f"{' at ' + company if company != 'your company' else ''} stands out as the right fit "
            f"for my expertise{' in ' + all_skills if all_skills else ''}."
        ),
        'about_yourself': (
            summary if len(summary) > 100 else
            (f"I am {name}"
             + (f", with experience in {all_skills}" if all_skills else '')
             + ('.' if all_skills else '.')
             + (f" I have worked on projects including {project_name}." if project_name else '')
             + f" I am actively looking for opportunities like {job}"
             + (f" at {company}" if company != 'your company' else '')
             + " to apply my skills and grow professionally.")
        ),
        'strengths': (
            f"My key strengths are{' my technical proficiency in ' + all_skills + ' and' if all_skills else ''} "
            f"my ability to quickly learn and adapt to new technologies. I have a strong problem-solving mindset"
            + (f" demonstrated through projects like {project_name}" if project_name else '')
            + ". I am detail-oriented and work well in teams."
        ),
        'experience': (
            f"{exp_intro}"
            + (f", I have worked with {all_skills}." if all_skills else '.')
            + (f" {project_desc[:200]}." if project_desc else '')
        ),
        'project': (
            (project_desc[:400] + '.' if project_desc else
             ('I built a project using ' + all_skills + '.' if all_skills else
              'I have worked on several technical projects.'))
            + " This required designing the architecture, implementing core features, "
            + "and delivering a working solution."
        ),
        'challenge': (
            f"One significant challenge I faced was during the development of "
            f"{project_name if project_name else 'a complex project'}. "
            f"I systematically broke the problem into smaller components, researched the best approaches, "
            f"and implemented a solution"
            + (f" using {top_skills}" if top_skills else '')
            + ". This experience strengthened my debugging skills and problem-solving ability."
        ),
        'goals': (
            f"In the next few years, I aim to grow as a software engineer"
            + (f", deepening my expertise in {top_skills}" if top_skills else '')
            + f". The {job} position"
            + (f" at {company}" if company != 'your company' else '')
            + " aligns well with my career direction."
        ),
        'salary': (
            # Smart: if fresher, say no current CTC. If experienced, say market-competitive
            (f"As a fresher, I don't have a current CTC. "
             f"My expected compensation is open to discussion based on the role and industry standards.")
            if (not exp or exp.lower() in ('', 'fresher', '0 years', '0 year'))
            else
            (f"My current compensation is market-competitive. "
             f"I am open to discussing a package that reflects the role's scope and my {exp} of experience.")
        ),
        'availability': (
            f"I am available to join"
            + (' immediately, as I am currently not serving any notice period'
               if not exp or exp.lower() in ('', 'fresher', '0 years', '0 year')
               else ' within my notice period once formalities are completed')
            + '.'
        ),
        'relocation': 'Yes, I am open to relocating for the right opportunity.',
        'how_did_you_hear': (
            'I came across this opportunity on LinkedIn while looking for roles in software development'
            + (f' matching my background in {top_skills}' if top_skills else '')
            + '. It immediately caught my attention given the role requirements.'
        ),
        'additional_info': (
            (f"I am passionate about software development"
             + (f", with hands-on experience in {all_skills}" if all_skills else '')
             + ".")
            + (f" My project {project_name} demonstrates my ability to build real-world solutions."
               if project_name else '')
            + " I am a quick learner, a team player, and I consistently deliver quality results."
        ),
        'general': (
            f"I am {name}"
            + (f", a software developer with experience in {all_skills}" if all_skills else '')
            + f". I am excited about the {job} position"
            + (f" at {company}" if company != 'your company' else '')
            + " and confident I can contribute meaningfully to your team."
        ),
    }

    return answers.get(qtype, answers['general'])


# #"##"##"# AI-powered answer generator #"##"##"##"##"##"##"##"##"##"##"##"##"##"##"##"##"##"##"##"##"##"##"##"##"##"##"##"##"##"##"##"##"##"##"##"##"##"##"##"##"##"##"##"##"#

AI_SYSTEM_PROMPT = """You are an expert career coach helping a job applicant answer application questions.

You will receive a question, the candidate's full resume profile, and context about the company/role.

RULES - follow these strictly:
1. ALWAYS write in first person ("I", "my", "me") - never "the candidate"
2. Use ONLY information from the profile provided - never invent facts
3. GROUNDING RULE: Do NOT invent companies, dates, certifications, skills, technologies, or personal facts that are not explicitly present in the profile section below.
4. For questions where resume data applies (skills, projects, experience, education) - use it specifically and precisely
5. For questions where resume data does NOT apply (how you heard, referral, etc.) - give a natural honest answer
6. Be concise: 2-4 sentences for most question types; cover letters may be longer (up to 200 words)
7. Never write more than 150 words unless it is explicitly a cover letter question
8. Sound like a real human, not a robot - no buzzword overload
9. Do NOT add labels, headers, or explanations - return ONLY the answer text
10. Use the company name and job title naturally when they are provided

SPECIAL HANDLING:
- "How did you hear / find out" -> Say you found it on LinkedIn/job board/Google while looking for relevant roles
- "Current CTC / salary" -> If fresher (no paid experience): say "I am a fresher, this would be my first role"
                            If experienced: mention it was market-competitive / give a range if possible
- "Expected CTC / salary" -> Be honest about expectations being open and negotiable based on role scope
- "Notice period / when can you join" -> Base on actual experience status (fresher = immediately, experienced = per notice)
- "Willing to relocate" -> Answer based on profile city vs job location context
- "Why this company" -> Reference the company name and something genuine about the role/technology stack
- "About yourself / introduction" -> Lead with name, key skills, and years of experience; 2-3 sentences max
- "Describe experience / project" -> Cite actual job titles, companies, and project descriptions from the profile only
"""

AI_USER_TEMPLATE = """=== CANDIDATE PROFILE SUMMARY ===
Name:             {name}
Total Experience: {experience}
Top Skills:       {skills}
Current/Latest Role: {latest_role}
Education:        {education_summary}

=== ROLE CONTEXT ===
Company:   {company}
Job Title: {job_title}
JD Excerpt:{jd}

=== QUESTION TO ANSWER ===
Question:      {question}
Question Type: {qtype}

=== FULL RESUME DETAIL (use only facts explicitly stated here) ===
Summary:
{summary}

Work History:
{work_history}

Education (full):
{education}

Certifications: {certifications}

Projects:
{projects}

LinkedIn: {linkedin}
GitHub:   {github}

Write a direct, genuine 2-4 sentence answer using only the candidate's actual background above.
Do not invent any facts. Return only the answer text with no labels or headers."""

class AIAnswerService:
    """Generates AI-powered answers for open-ended job application questions."""

    def generate_answer(
        self,
        question: str,
        field_label: str,
        field_type: str,
        context: Dict[str, Any],
        profile: Dict[str, Any]
    ) -> Dict[str, Any]:
        """
        Generate an answer for a job application question.

        Returns:
            {
                'success': bool,
                'answer': str,
                'field_label': str,
                'confidence': float,
                'used_ai': bool,
                'tokens_used': int
            }
        """
        qtype          = detect_question_type(field_label or question)
        profile_summary = extract_profile_summary(profile)
        company        = context.get('company_name', '')
        job_title      = context.get('job_title', '')

        # For factual/short-answer question types, ALWAYS use template (not AI).
        # AI tends to write verbose bios for these - template gives precise answers.
        TEMPLATE_ONLY_TYPES = {
            'salary',        # "current CTC", "expected salary" - needs precise answer
            'availability',  # "notice period", "when can you join" - needs precise answer
            'relocation',    # "willing to relocate" - one-line answer
            'how_did_you_hear',  # "how did you find" - short factual answer
        }

        if qtype in TEMPLATE_ONLY_TYPES:
            answer = template_answer(qtype, profile_summary, context)
            return {
                'success':     True,
                'answer':      answer.strip(),
                'field_label': field_label,
                'question_type': qtype,
                'confidence':  0.85,
                'used_ai':     False,
                'tokens_used': 0,
                'timestamp':   datetime.utcnow().isoformat()
            }

        # For open-ended questions: try AI first, fall back to template
        ai_answer = None
        tokens_used = 0
        used_ai = False

        try:
            ai_answer, tokens_used = self._generate_with_ai(
                question=question or field_label,
                profile_summary=profile_summary,
                context=context,
                profile=profile,
            )
            if ai_answer and len(ai_answer.strip()) > 20:
                used_ai = True
        except Exception as e:
            logger.warning(f'AI answer generation failed, using template: {e}')
            ai_answer = None

        # Fallback to template
        if not ai_answer:
            ai_answer = template_answer(qtype, profile_summary, context)

        return {
            'success':     True,
            'answer':      ai_answer.strip(),
            'field_label': field_label,
            'question_type': qtype,
            'confidence':  0.9 if used_ai else 0.75,
            'used_ai':     used_ai,
            'tokens_used': tokens_used,
            'timestamp':   datetime.utcnow().isoformat()
        }

    def _generate_with_ai(
        self,
        question: str,
        profile_summary: Dict[str, str],
        context: Dict[str, Any],
        profile: Optional[Dict[str, Any]] = None,
    ):
        """Try to generate answer using NVIDIA NIM. Returns (answer, tokens_used)."""
        try:
            from app.services.nvidia_nim_client import get_nim_client
            client = get_nim_client()
        except ValueError:
            raise RuntimeError('NVIDIA NIM not configured')

        # Build rich education string from ALL entries
        edu_list = (profile or {}).get('education', [])
        edu_lines = []
        if edu_list and isinstance(edu_list, list):
            for e in edu_list[:4]:
                edu_line = f"  - {e.get('institution','?')} | {e.get('degree','?')}"
                fos = e.get('field_of_study') or e.get('field', '')
                if fos: edu_line += f" ({fos})"
                yrs = f"{e.get('from','')}-{e.get('to','')}" if e.get('from') or e.get('to') else ''
                if yrs: edu_line += f" [{yrs}]"
                edu_lines.append(edu_line)
        edu_str = '\n'.join(edu_lines) if edu_lines else '  - Not provided'

        # Build rich work history from ALL experience entries
        exp_list = (profile or {}).get('experience', [])
        work_lines = []
        if exp_list and isinstance(exp_list, list):
            for ex in exp_list[:4]:
                title_co = f"  - {ex.get('title', ex.get('job_title','?'))} at {ex.get('company','?')}"
                yrs = f"{ex.get('from','')}-{ex.get('to','')}" if ex.get('from') or ex.get('to') else ''
                if yrs: title_co += f" ({yrs})"
                desc = ex.get('description','')
                if desc: title_co += f"\n    {desc[:250]}"
                work_lines.append(title_co)
        work_history_str = '\n'.join(work_lines) if work_lines else '  - No paid experience (Fresher)'

        # Certifications
        certs = (profile or {}).get('certifications', [])
        cert_str = ', '.join([c if isinstance(c, str) else c.get('name','') for c in certs[:6]]) if certs else 'None'

        # Job description snippet
        jd = context.get('job_description', '')
        jd_str = jd[:600] if jd else 'Not provided'

        # Get question type for richer context in prompt
        qtype = detect_question_type(question)

        # Build concise latest_role and education_summary for the profile summary block
        latest_role = 'Not provided'
        if exp_list and isinstance(exp_list, list) and len(exp_list) > 0:
            ex0 = exp_list[0]
            title0   = ex0.get('title') or ex0.get('job_title') or '?'
            company0 = ex0.get('company') or '?'
            latest_role = f"{title0} at {company0}"

        education_summary = 'Not provided'
        if edu_list and isinstance(edu_list, list) and len(edu_list) > 0:
            e0 = edu_list[0]
            deg0 = e0.get('degree') or '?'
            inst0 = e0.get('institution') or e0.get('school') or '?'
            education_summary = f"{deg0} — {inst0}"

        user_prompt = AI_USER_TEMPLATE.format(
            question=question,
            qtype=qtype,
            company=context.get('company_name', 'the company'),
            job_title=context.get('job_title', 'this position'),
            jd=jd_str,
            name=profile_summary['name'],
            latest_role=latest_role,
            education_summary=education_summary,
            summary=(profile_summary.get('summary') or 'Not provided')[:500],
            skills=profile_summary['skills'] or 'Not provided',
            experience=profile_summary['experience'] or 'Fresher (no paid experience yet)',
            work_history=work_history_str,
            education=edu_str,
            certifications=cert_str,
            projects=(profile_summary.get('projects') or 'Not provided')[:400],
            linkedin=profile_summary['linkedin'] or 'not provided',
            github=profile_summary['github'] or 'not provided',
        )

        messages = [
            {'role': 'system', 'content': AI_SYSTEM_PROMPT},
            {'role': 'user',   'content': user_prompt}
        ]

        import asyncio

        async def _call():
            return await client.chat_completion(
                messages, max_tokens=400, temperature=0.7
            )

        # Run the async call ##" use asyncio.run() which creates and tears down
        # its own event loop cleanly in a synchronous Flask context.
        try:
            response = asyncio.run(_call())
        except RuntimeError:
            # Fallback for environments where a loop is already running (e.g. pytest-asyncio)
            loop = asyncio.new_event_loop()
            try:
                response = loop.run_until_complete(_call())
            finally:
                loop.close()

        if not response.success or not response.content:
            raise RuntimeError(f'NIM returned failure: {response.error}')

        return response.content.strip(), response.tokens_used
