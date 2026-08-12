"""
End-to-End Test Suite for Tauzand AutoFill AI Extension
Tests major ATS (Applicant Tracking System) platforms.
"""
import pytest
import json
import io


class TestResumeParser:
    """Test the resume parsing service."""

    def test_parse_pdf_text(self):
        """Test raw text PDF parsing fallback."""
        from app.services.resume_parser import ResumeParser

        parser = ResumeParser()

        # Create a minimal PDF-like text content
        pdf_content = (
            b'%PDF-1.4\n'
            b'BT /F1 12 Tf 100 700 Td (John Smith) Tj ET\n'
            b'BT /F1 12 Tf 100 680 Td (john.smith@email.com) Tj ET\n'
            b'BT /F1 12 Tf 100 660 Td (555-123-4567) Tj ET\n'
            b'%%EOF\n'
        )

        result = parser.parse(pdf_content, 'resume.pdf')
        assert result['parse_method'] in ('document', 'raw_text')
        assert 'parsed_at' in result
        assert 'raw_text' in result

    def test_parse_docx_basic(self):
        """Test DOCX parsing."""
        from app.services.resume_parser import ResumeParser
        import zipfile

        parser = ResumeParser()

        # Create minimal DOCX structure
        docx_content = io.BytesIO()
        with zipfile.ZipFile(docx_content, 'w') as zf:
            xml_content = b'''<?xml version="1.0" encoding="UTF-8"?>
            <w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
              <w:body>
                <w:p><w:r><w:t>Jane Doe</w:t></w:r></w:p>
                <w:p><w:r><w:t>jane.doe@example.com</w:t></w:r></w:p>
                <w:p><w:r><w:t>555-987-6543</w:t></w:r></w:p>
                <w:p><w:r><w:t>Python</w:t></w:r></w:p>
              </w:body>
            </w:document>'''
            zf.writestr('word/document.xml', xml_content)

        result = parser.parse(docx_content.getvalue(), 'resume.docx')
        assert 'Jane' in result['name'] or 'Jane' in str(result.get('personal', {}))
        assert 'email' in result
        assert 'phone' in result

    def test_extract_name_patterns(self):
        """Test name extraction from raw text."""
        from app.services.resume_parser import ResumeParser

        parser = ResumeParser()

        # Test case: name at top of resume
        text = (
            "John Michael Smith\n"
            "john.smith@email.com\n"
            "555-123-4567\n"
            "Resume\n"
        )
        name = parser._extract_name(text)
        assert 'John' in name and 'Smith' in name

        # Test case: email-first format
        text2 = (
            "john@email.com\n"
            "555-123-4567\n"
            "Jane Doe\n"
            "Software Engineer\n"
        )
        name2 = parser._extract_name(text2)
        assert 'Jane' in name2 or 'Doe' in name2

    def test_extract_email_phone(self):
        """Test email and phone extraction."""
        from app.services.resume_parser import ResumeParser

        parser = ResumeParser()
        text = "Contact: alice@example.com or 555.123.4567"

        email = parser._extract_field(text, 'email')
        phone = parser._extract_field(text, 'phone')

        assert email == 'alice@example.com'
        assert phone == '5551234567' or phone == '555-123-4567'

    def test_extract_skills(self):
        """Test skills extraction."""
        from app.services.resume_parser import ResumeParser

        parser = ResumeParser()
        text = (
            "Skills: Python, JavaScript, React, AWS, Docker, Git, "
            "Machine Learning, SQL, and Agile methodologies. "
            "Also familiar with leadership and communication."
        )

        skills = parser._extract_skills(text)
        assert 'Python' in skills
        assert 'React' in skills
        assert 'AWS' in skills
        assert 'Docker' in skills
        assert 'Machine Learning' in skills

    def test_github_linkedin_extraction(self):
        """Test social link extraction — now returns full URLs."""
        from app.services.resume_parser import ResumeParser

        parser = ResumeParser()
        text = (
            "LinkedIn: linkedin.com/in/johndoe\n"
            "GitHub: github.com/johndoe123\n"
        )

        linkedin = parser._extract_field(text, 'linkedin')
        github = parser._extract_field(text, 'github')

        # Parser now returns full URLs
        assert linkedin is not None and 'linkedin.com' in linkedin and 'johndoe' in linkedin
        assert github is not None and 'github.com' in github and 'johndoe123' in github

    def test_city_extraction(self):
        """Test city/state extraction."""
        from app.services.resume_parser import ResumeParser

        parser = ResumeParser()
        text = "Based in San Francisco, CA and open to remote work."

        city = parser._extract_city_from_text(text)
        assert 'San Francisco' in city or 'CA' in city


class TestFieldMappingSchema:
    """Test that field mapping produces correct schema for autofill."""

    def test_unified_mapping_schema(self, client):
        """Test /api/form/analyze/fields returns autoFill.js-compatible schema."""
        from app import create_app

        app = create_app('default')
        client = app.test_client()

        # Test request matching what background.js sends after fixing upload
        payload = {
            'resume': {
                'name': 'John Smith',
                'email': 'john@example.com',
                'phone': '5551234567',
                'first_name': 'John',
                'last_name': 'Smith',
                'personal': {
                    'full_name': 'John Smith',
                    'first_name': 'John',
                    'last_name': 'Smith'
                },
                'contact': {
                    'email': 'john@example.com',
                    'phone': '5551234567'
                }
            },
            'forms': [{
                'id': 'job_application',
                'elements': [
                    {'name': 'first_name', 'id': 'first_name', 'type': 'text'},
                    {'name': 'email', 'id': 'email', 'type': 'email'},
                    {'name': 'phone', 'id': 'phone', 'type': 'tel'},
                    {'name': 'linkedin_url', 'id': 'linkedin_url', 'type': 'text'},
                ]
            }]
        }

        response = client.post(
            '/api/form/analyze/fields',
            json=payload,
            content_type='application/json'
        )

        assert response.status_code == 200
        data = response.get_json()

        assert data['success'] is True
        assert 'mappings' in data
        assert isinstance(data['mappings'], list)

        # Verify unified schema fields
        for mapping in data['mappings']:
            assert 'form_field_name' in mapping, "Missing form_field_name"
            assert 'profile_field_name' in mapping, "Missing profile_field_name"
            assert 'mapped_value' in mapping, "Missing mapped_value"
            assert 'confidence_score' in mapping, "Missing confidence_score"
            assert 'match_type' in mapping, "Missing match_type"
            assert isinstance(mapping['confidence_score'], (int, float))
            assert 0.0 <= mapping['confidence_score'] <= 1.0

    def test_field_mapping_resume_aliases(self, client):
        """Test that resume aliasing works (firstName vs first_name)."""
        from app import create_app

        app = create_app('default')
        client = app.test_client()

        # Test with camelCase resume keys
        payload = {
            'resume': {
                'firstName': 'Alice',
                'lastName': 'Johnson',
                'emailAddress': 'alice.j@example.com',
                'phoneNumber': '555-222-3333',
            },
            'forms': [{
                'id': 'form1',
                'elements': [
                    {'name': 'first_name', 'id': 'fn', 'type': 'text'},
                    {'name': 'email', 'id': 'em', 'type': 'email'},
                    {'name': 'phone_number', 'id': 'ph', 'type': 'tel'},
                ]
            }]
        }

        response = client.post('/api/form/analyze/fields', json=payload)
        data = response.get_json()

        assert data['success'] is True

        # Check that mappings have resolved values
        for mapping in data['mappings']:
            if mapping['match_type'] == 'exact':
                assert mapping['mapped_value'] is not None
                assert mapping['mapped_value'] != ''


class TestATSSimulations:
    """
    Simulate forms from major ATS platforms to test compatibility.
    These are HTML snippets from real ATS platforms.
    """

    def test_greenhouse_style_form(self, client):
        """Test form fields typical of Greenhouse ATS."""
        from app import create_app

        app = create_app('default')
        client = app.test_client()

        # Greenhouse-style form field names
        payload = {
            'resume': {
                'first_name': 'Bob',
                'last_name': 'Wilson',
                'email': 'bob.wilson@email.com',
                'phone': '5554443333',
                'linkedin': 'bobwilson',
            },
            'forms': [{
                'id': 'greenhouse_form',
                'elements': [
                    {'name': 'first_name', 'id': 'first_name', 'type': 'text'},
                    {'name': 'last_name', 'id': 'last_name', 'type': 'text'},
                    {'name': 'email', 'id': 'email', 'type': 'email'},
                    {'name': 'phone', 'id': 'phone', 'type': 'tel'},
                    {'name': 'linkedin_url', 'id': 'linkedin_url', 'type': 'text'},
                    {'name': 'website', 'id': 'website', 'type': 'url'},
                    {'name': 'resume', 'id': 'resume', 'type': 'file'},
                    {'name': 'cover_letter', 'id': 'cover_letter', 'type': 'textarea'},
                ]
            }]
        }

        response = client.post('/api/form/analyze/fields', json=payload)
        data = response.get_json()

        assert data['success'] is True
        mappings_dict = {m['form_field_name']: m for m in data['mappings']}

        # Verify key fields matched
        assert 'first_name' in mappings_dict
        assert 'email' in mappings_dict
        assert mappings_dict['first_name']['mapped_value'] == 'Bob'

    def test_workday_style_form(self, client):
        """Test form fields typical of Workday ATS."""
        from app import create_app

        app = create_app('default')
        client = app.test_client()

        payload = {
            'resume': {
                'name': 'Carol Davis',
                'firstName': 'Carol',
                'lastName': 'Davis',
                'email': 'carol.davis@email.com',
                'phone': '5556667777',
                'address': '123 Main St, Boston, MA',
            },
            'forms': [{
                'id': 'workday_form',
                'elements': [
                    {'name': 'wd-FirstName', 'id': 'FirstName', 'type': 'text'},
                    {'name': 'wd-LastName', 'id': 'LastName', 'type': 'text'},
                    {'name': 'wd-Email', 'id': 'Email', 'type': 'text'},
                    {'name': 'wd-Phone', 'id': 'Phone', 'type': 'text'},
                    {'name': 'wd-Address', 'id': 'Address', 'type': 'text'},
                    {'name': 'wd-City', 'id': 'City', 'type': 'text'},
                    {'name': 'wd-State', 'id': 'State', 'type': 'select-one'},
                ]
            }]
        }

        response = client.post('/api/form/analyze/fields', json=payload)
        data = response.get_json()

        assert data['success'] is True
        mappings = data['mappings']

        # Should match at least name and email
        matched_names = [m['form_field_name'] for m in mappings if m['mapped_value']]
        assert any('FirstName' in n or 'firstName' in n or 'First' in n for n in matched_names)

    def test_taleo_style_form(self, client):
        """Test form fields typical of Oracle Taleo."""
        from app import create_app

        app = create_app('default')
        client = app.test_client()

        payload = {
            'resume': {
                'full_name': 'David Chen',
                'first_name': 'David',
                'last_name': 'Chen',
                'email': 'david.chen@email.com',
                'phone': '5558889999',
                'city': 'Seattle',
                'state': 'WA',
            },
            'forms': [{
                'id': 'taleo_form',
                'elements': [
                    {'name': 'requisition.fields.candidate.name', 'id': 'name', 'type': 'text'},
                    {'name': 'requisition.fields.candidate.firstName', 'id': 'firstName', 'type': 'text'},
                    {'name': 'requisition.fields.candidate.lastName', 'id': 'lastName', 'type': 'text'},
                    {'name': 'requisition.fields.candidate.email', 'id': 'email', 'type': 'text'},
                    {'name': 'requisition.fields.candidate.phone', 'id': 'phone', 'type': 'text'},
                    {'name': 'requisition.fields.candidate.city', 'id': 'city', 'type': 'text'},
                ]
            }]
        }

        response = client.post('/api/form/analyze/fields', json=payload)
        data = response.get_json()

        assert data['success'] is True
        assert isinstance(data['mappings'], list)

    def test_lever_style_form(self, client):
        """Test form fields typical of Lever ATS."""
        from app import create_app

        app = create_app('default')
        client = app.test_client()

        payload = {
            'resume': {
                'name': 'Eva Martinez',
                'email': 'eva.martinez@email.com',
                'phone': '5551112222',
                'github': 'evamartinez',
                'portfolio': 'evamartinez.dev',
            },
            'forms': [{
                'id': 'lever_form',
                'elements': [
                    {'name': 'name', 'id': 'name', 'type': 'text'},
                    {'name': 'email', 'id': 'email', 'type': 'email'},
                    {'name': 'phone', 'id': 'phone', 'type': 'tel'},
                    {'name': 'github', 'id': 'github', 'type': 'text'},
                    {'name': 'portfolio', 'id': 'portfolio', 'type': 'url'},
                    {'name': 'linkedin', 'id': 'linkedin', 'type': 'text'},
                    {'name': 'introduction', 'id': 'introduction', 'type': 'textarea'},
                ]
            }]
        }

        response = client.post('/api/form/analyze/fields', json=payload)
        data = response.get_json()

        assert data['success'] is True
        # Verify at least email and name mapped
        assert len(data['mappings']) > 0


class TestFormAnalysisEndpoint:
    """Test the /api/form/analyze endpoint."""

    def test_analyze_valid_html(self, client):
        """Test form analysis with valid HTML."""
        from app import create_app

        app = create_app('default')
        client = app.test_client()

        html = '''
        <form id="application" action="/submit" method="POST">
            <input type="text" id="first-name" name="first_name" placeholder="First Name">
            <input type="text" id="last-name" name="last_name" placeholder="Last Name">
            <input type="email" id="email" name="email" placeholder="Email Address">
            <input type="tel" id="phone" name="phone" placeholder="Phone Number">
            <textarea id="cover-letter" name="cover_letter"></textarea>
            <select id="position" name="position">
                <option value="">Select Position</option>
                <option value="engineer">Software Engineer</option>
            </select>
            <input type="submit" value="Submit Application">
        </form>
        '''

        response = client.post(
            '/api/form/analyze',
            json={'html': html, 'source_url': 'https://example.com/apply'},
            content_type='application/json'
        )

        assert response.status_code == 200
        data = response.get_json()

        assert data['success'] is True
        assert 'form_analysis' in data
        assert 'mappings' in data
        assert 'confidence' in data

    def test_analyze_empty_html(self, client):
        """Test form analysis with empty HTML."""
        from app import create_app

        app = create_app('default')
        client = app.test_client()

        response = client.post(
            '/api/form/analyze',
            json={'html': ''},
            content_type='application/json'
        )

        assert response.status_code == 400
        data = response.get_json()
        assert data['success'] is False

    def test_analyze_html_too_large(self, client):
        """Test form analysis rejects oversized HTML (5MB limit)."""
        from app import create_app

        app = create_app('default')
        client = app.test_client()

        large_html = 'x' * (6 * 1024 * 1024)  # 6MB

        response = client.post(
            '/api/form/analyze',
            json={'html': large_html},
            content_type='application/json'
        )

        assert response.status_code == 413

    def test_analyze_non_json(self, client):
        """Test form analysis rejects non-JSON."""
        from app import create_app

        app = create_app('default')
        client = app.test_client()

        response = client.post(
            '/api/form/analyze',
            data='not json',
            content_type='text/plain'
        )

        assert response.status_code == 400


class TestHealthEndpoints:
    """Test all health check endpoints."""

    def test_root_health(self, client):
        """Test root endpoint."""
        from app import create_app

        app = create_app('default')
        client = app.test_client()

        response = client.get('/')
        assert response.status_code == 200
        data = response.get_json()
        assert 'status' in data or 'message' in data

    def test_api_health(self, client):
        """Test /api/health endpoint."""
        from app import create_app

        app = create_app('default')
        client = app.test_client()

        response = client.get('/api/health')
        assert response.status_code == 200
        data = response.get_json()
        assert data['status'] == 'healthy'

    def test_form_health(self, client):
        """Test /api/form/health endpoint."""
        from app import create_app

        app = create_app('default')
        client = app.test_client()

        response = client.get('/api/form/health')
        assert response.status_code == 200
        data = response.get_json()
        assert data['status'] == 'healthy'

    def test_ai_health(self, client):
        """Test /api/v1/ai/health endpoint (graceful when NIM not configured)."""
        from app import create_app

        app = create_app('default')
        client = app.test_client()

        response = client.get('/api/v1/ai/health')
        # Should return 200 even if NIM is not configured (graceful degradation)
        assert response.status_code == 200
        data = response.get_json()
        assert 'status' in data
        assert 'nim_configured' in data


class TestBackendUploadIntegration:
    """Test upload flow with real parser."""

    def test_upload_pdf_bytes(self, client):
        """Test uploading PDF bytes through the API."""
        from app import create_app

        app = create_app('default')
        client = app.test_client()

        # Create minimal PDF bytes
        pdf_bytes = (
            b'%PDF-1.4\n'
            b'BT\n'
            b'/F1 12 Tf\n'
            b'100 700 Td\n'
            b'(Sarah Connor) Tj\n'
            b'ET\n'
            b'BT\n'
            b'100 680 Td\n'
            b'(sarah@email.com) Tj\n'
            b'ET\n'
            b'BT\n'
            b'100 660 Td\n'
            b'(555-999-8888) Tj\n'
            b'ET\n'
            b'%%EOF\n'
        )

        data = {
            'resume': (io.BytesIO(pdf_bytes), 'sarah_resume.pdf', 'application/pdf')
        }

        response = client.post(
            '/api/profile/upload',
            data=data,
            content_type='multipart/form-data'
        )

        assert response.status_code == 200
        result = response.get_json()
        assert result['success'] is True
        assert 'data' in result
        assert 'parsed_at' in result['data']
        assert result['data']['parse_method'] in ('document', 'raw_text')


# === Pytest Fixtures ===

@pytest.fixture
def client():
    """Create test client."""
    from app import create_app
    app = create_app('testing')
    with app.test_client() as c:
        yield c