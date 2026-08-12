"""
AI Answer Generation Endpoint
Generates context-aware answers for open-ended job application questions
using NVIDIA NIM (Mistral) based on the candidate's resume/profile.
"""
from flask import Blueprint, request, jsonify
import logging
from datetime import datetime

logger = logging.getLogger(__name__)

ai_answers_bp = Blueprint('ai_answers', __name__, url_prefix='/api/v1/ai')


@ai_answers_bp.route('/answer-question', methods=['POST'])
def answer_question():
    """
    Generate an AI answer for an open-ended job application question.

    Request:
    {
        "question": "Why do you want to work at Google?",
        "field_label": "Why do you want to work here?",
        "field_type": "textarea",
        "context": {
            "company_name": "Google",
            "job_title": "Software Engineer",
            "job_description": "..."   // optional
        },
        "profile": {
            "name": "Akkisetty Kumar",
            "skills": ["Python", "React"],
            "experience": "2 years",
            ...
        }
    }

    Response:
    {
        "success": true,
        "answer": "I am excited about Google because...",
        "field_label": "Why do you want to work here?",
        "confidence": 0.9,
        "tokens_used": 245
    }
    """
    try:
        if not request.is_json:
            return jsonify({'success': False, 'error': 'Content-Type must be application/json'}), 400

        data = request.get_json(silent=True)
        if not data:
            return jsonify({'success': False, 'error': 'Missing request body'}), 400

        question   = data.get('question', '')
        field_label = data.get('field_label', question)
        field_type  = data.get('field_type', 'textarea')
        context     = data.get('context', {})
        profile     = data.get('profile', {})

        if not question and not field_label:
            return jsonify({'success': False, 'error': 'question or field_label is required'}), 400

        if not profile:
            return jsonify({'success': False, 'error': 'profile is required'}), 400

        # Generate the answer
        from app.services.ai_answer_service import AIAnswerService
        service = AIAnswerService()
        result  = service.generate_answer(
            question=question or field_label,
            field_label=field_label,
            field_type=field_type,
            context=context,
            profile=profile
        )

        return jsonify(result), 200 if result.get('success') else 500

    except Exception as e:
        logger.exception(f'Error in answer_question: {e}')
        return jsonify({'success': False, 'error': 'Internal server error'}), 500


@ai_answers_bp.route('/answer-questions-batch', methods=['POST'])
def answer_questions_batch():
    """
    Generate AI answers for multiple open-ended questions in one call.

    Request:
    {
        "questions": [
            {"label": "Why this company?", "type": "textarea"},
            {"label": "Describe yourself", "type": "textarea"},
            {"label": "Cover Letter", "type": "textarea"}
        ],
        "context": {
            "company_name": "Google",
            "job_title": "SDE Intern"
        },
        "profile": { ... }
    }

    Response:
    {
        "success": true,
        "answers": [
            {"label": "Why this company?", "answer": "...", "confidence": 0.9},
            ...
        ]
    }
    """
    try:
        if not request.is_json:
            return jsonify({'success': False, 'error': 'Content-Type must be application/json'}), 400

        data = request.get_json(silent=True)
        if not data:
            return jsonify({'success': False, 'error': 'Missing request body'}), 400

        questions = data.get('questions', [])
        context   = data.get('context', {})
        profile   = data.get('profile', {})

        if not questions:
            return jsonify({'success': False, 'error': 'questions array is required'}), 400
        if not profile:
            return jsonify({'success': False, 'error': 'profile is required'}), 400

        from app.services.ai_answer_service import AIAnswerService
        service = AIAnswerService()
        answers = []

        for q in questions:
            label  = q.get('label', '')
            ftype  = q.get('type', 'textarea')
            result = service.generate_answer(
                question=label, field_label=label,
                field_type=ftype, context=context, profile=profile
            )
            answers.append({
                'label':      label,
                'answer':     result.get('answer', ''),
                'confidence': result.get('confidence', 0),
                'used_ai':    result.get('used_ai', False)
            })

        return jsonify({'success': True, 'answers': answers}), 200

    except Exception as e:
        logger.exception(f'Error in answer_questions_batch: {e}')
        return jsonify({'success': False, 'error': 'Internal server error'}), 500
