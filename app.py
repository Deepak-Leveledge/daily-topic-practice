import json
import os
import random

import requests
from dotenv import load_dotenv
from flask import Flask, jsonify, render_template, request
from werkzeug.utils import secure_filename

load_dotenv()
app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = 25 * 1024 * 1024

GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-3.8-flash")
GROQ_STT_MODEL = os.getenv("GROQ_STT_MODEL", "whisper-large-v3-turbo")

TOPICS = [
    {"category": "Everyday life", "level": "Easy", "title": "A small habit that makes your day better", "explanation": "A habit is something you do regularly. Small habits, like taking a short walk or planning your morning, can affect how your whole day feels.", "example": "For example, drinking a glass of water after waking up can help you start the day with a simple routine."},
    {"category": "Technology", "level": "Stretch", "title": "Should people take breaks from their phones?", "explanation": "Phones help us communicate and find information, but they can also interrupt sleep, work, and face-to-face conversations. A phone break means choosing not to use your phone for a period of time.", "example": "For example, someone might keep their phone away during dinner so they can focus on the people around them."},
    {"category": "Big ideas", "level": "Stretch", "title": "What does it mean to live a meaningful life?", "explanation": "People find meaning in different things, such as relationships, learning, helping others, or creating something. There is no single answer that fits everyone.", "example": "For example, one person may feel fulfilled by caring for family, while another may find meaning in solving difficult problems."},
    {"category": "Opinions", "level": "Easy", "title": "Is it better to plan your free time or be spontaneous?", "explanation": "Planning means deciding in advance what you will do. Being spontaneous means making choices in the moment, without a fixed plan.", "example": "For example, you could plan a weekend trip, or decide on Saturday morning to explore a place nearby."},
    {"category": "Society", "level": "Stretch", "title": "How can a city become a better place to live?", "explanation": "A city affects people through transport, housing, parks, safety, and access to services. Improving one area can make daily life easier for many residents.", "example": "For example, reliable buses may help people get to work without needing to own a car."},
    {"category": "Culture", "level": "Easy", "title": "Why do people enjoy stories?", "explanation": "Stories let us experience events through another person's point of view. They can entertain us, teach us something, or help us understand feelings.", "example": "For example, a film about someone overcoming a challenge may encourage viewers to keep trying in their own lives."},
    {"category": "Learning", "level": "Stretch", "title": "Is making mistakes an important part of learning?", "explanation": "A mistake can show us what we do not understand yet. When we notice the reason for a mistake and try again, we can improve.", "example": "For example, a person learning to cook may burn a dish once and then learn to control the heat better."},
    {"category": "Quotes & ideas", "level": "Stretch", "title": "“The journey matters as much as the destination.” What does this mean to you?", "explanation": "This idea suggests that the process of reaching a goal can be valuable, not only the final result. We may learn, meet people, or change along the way.", "example": "For example, learning a language takes time, and the practice itself can build confidence before you become fluent."},
    {"category": "Work & study", "level": "Easy", "title": "What makes someone a good teammate?", "explanation": "A teammate works with other people toward a shared goal. Good teamwork can involve listening, sharing ideas, and doing your part reliably.", "example": "For example, on a group project, one person may organize the tasks while another checks the final work."},
    {"category": "Environment", "level": "Stretch", "title": "What is one change that could make everyday life more sustainable?", "explanation": "Sustainability means using resources in a way that can continue without causing unnecessary harm. Everyday choices can affect waste, energy, and the environment.", "example": "For example, carrying a reusable bottle can reduce the number of disposable bottles someone uses."},
    {"category": "Creativity", "level": "Easy", "title": "If you could learn any new skill this year, what would you choose?", "explanation": "A skill is an ability you develop through practice. People choose skills for enjoyment, work, or personal growth.", "example": "For example, learning photography could help someone notice interesting details in ordinary places."},
    {"category": "Future", "level": "Stretch", "title": "Which everyday task would you most like technology to improve?", "explanation": "Technology can change how we do routine tasks, saving time or making them easier. However, a useful change should solve a real problem for people.", "example": "For example, a simple tool that helps people compare bus routes could make daily travel less stressful."},
]


def gemini_text(prompt):
    key = os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY")
    if not key:
        return f'Add GEMINI_API_KEY or GOOGLE_API_KEY in your .env file to use Gemini text generation. Prompt was: {prompt}'
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{GEMINI_MODEL}:generateContent"
    response = requests.post(
        url,
        headers={"x-goog-api-key": key, "Content-Type": "application/json"},
        json={"contents": [{"parts": [{"text": prompt}]}], "generationConfig": {"temperature": 0.9}},
        timeout=25,
    )
    response.raise_for_status()
    data = response.json()
    return data["candidates"][0]["content"]["parts"][0]["text"].strip()


def parse_json_reply(text):
    if not text:
        return None
    cleaned = text.strip().removeprefix("```json").removeprefix("```").removesuffix("```").strip()
    return json.loads(cleaned)


@app.get("/")
def home():
    return render_template("index.html")


@app.get("/api/status")
def status():
    return jsonify({"gemini": bool(os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY")), "groq": bool(os.getenv("GROQ_API_KEY"))})


@app.post("/api/topic")
def topic():
    payload = request.get_json(silent=True) or {}
    recent = payload.get("recent", [])[-12:]
    try:
        generated = gemini_text(
            "Create one fresh English speaking-practice topic. Choose a varied category (technology, everyday life, opinions, "
            "society, culture, learning, work, environment, creativity, future, or a quote/idea). Vary difficulty between Easy and Stretch. "
            "Return only valid JSON with keys category, level, title, explanation, example. Explanation must be 2-3 simple English sentences; "
            "example must be one short concrete example. Make it understandable without specialist knowledge. Avoid these recent topics: "
            + json.dumps(recent)
        )
        result = parse_json_reply(generated)
        if isinstance(result, dict) and all(result.get(k) for k in ("category", "level", "title", "explanation", "example")):
            result["level"] = "Stretch" if str(result["level"]).lower() == "stretch" else "Easy"
            return jsonify(result)
    except (requests.RequestException, KeyError, ValueError, TypeError):
        app.logger.exception("Gemini topic request failed; using local topic bank")
    available = [item for item in TOPICS if item["title"] not in recent] or TOPICS
    return jsonify(random.choice(available))


@app.post("/api/idea")
def idea():
    payload = request.get_json(silent=True) or {}
    topic_title = str(payload.get("title", "this topic"))[:200]
    try:
        generated = gemini_text(
            f"Give one tiny, open-ended English speaking prompt to help someone continue talking about: {topic_title}. "
            "Use simple English, one sentence, and do not give them a full answer."
        )
        if generated:
            return jsonify({"idea": generated.strip('" '), "source": "gemini"})
    except requests.RequestException:
        app.logger.exception("Gemini idea request failed; using local prompt")
    return jsonify({"idea": random.choice([
        "Can you connect this idea to something you have seen in everyday life?",
        "What is one example that could help someone understand your point?",
        "What might be a different point of view on this topic?",
        "Why do you think this matters to people?",
        "What could happen in the future because of this?",
    ]), "source": "local"})


@app.post("/api/feedback")
def feedback():
    key = os.getenv("GROQ_API_KEY")
    gemini_key = os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY")
    if not key:
        return jsonify({"error": "Add GROQ_API_KEY in your .env file to transcribe a session."}), 503
    audio = request.files.get("audio")
    if not audio or not audio.filename:
        return jsonify({"error": "No recording was received. Please record a short response first."}), 400
    filename = secure_filename(audio.filename) or "practice.webm"
    try:
        transcribed = requests.post(
            "https://api.groq.com/openai/v1/audio/transcriptions",
            headers={"Authorization": f"Bearer {key}"},
            files={"file": (filename, audio.stream, audio.mimetype or "audio/webm")},
            data={"model": GROQ_STT_MODEL, "language": "en", "response_format": "json"},
            timeout=90,
        )
        transcribed.raise_for_status()
        transcript = transcribed.json().get("text", "").strip()
        if not transcript:
            return jsonify({"error": "I could not hear enough speech to make a transcript. Try recording again."}), 422
        if not gemini_key:
            return jsonify({"transcript": transcript, "feedback": None, "feedback_error": "Add GEMINI_API_KEY to generate feedback. The transcript is ready."})
        try:
            review = gemini_text(
                "You are a kind, practical English speaking coach for a learner who wants to think and speak in English. "
                "Review this speech transcript for the given topic. Be kind, specific, concise, and use simple English. "
                "Return only valid JSON with these keys: what_went_well (one short sentence), improve (one short sentence), "
                "scores (object with grammar, vocabulary, relevance, fluency; each has score as an integer from 1 to 10 and "
                "reason as one simple sentence), corrections (array of at most 2 objects, each with original, improved, reason; "
                "quote only real sentences from the transcript, and do not invent mistakes), error_tags (array of at most 3 "
                "objects with tag and explanation; tag must be one of verb_tense, articles, prepositions, sentence_structure, "
                "word_choice, subject_verb_agreement, repetition, off_topic, filler_words, fragment_sentences), next_tip "
                "(one small practice tip). Score grammar, vocabulary, and relevance from the transcript. Fluency must be clearly "
                "labelled as a rough estimate from text only; judge continuity and repeated phrasing, not speed, pauses, or pronunciation. "
                "Do not criticize accent or infer pronunciation. If the transcript is too short to judge a category, give a neutral score "
                "and say there is not enough text. Topic: " + str(request.form.get("topic", ""))[:300] + ". Transcript: " + transcript
            )
            feedback_data = parse_json_reply(review)
            if not isinstance(feedback_data, dict):
                raise ValueError("Gemini returned invalid feedback JSON")
        except (requests.RequestException, KeyError, ValueError, TypeError):
            app.logger.exception("Gemini feedback failed after transcription")
            return jsonify({"transcript": transcript, "feedback": None, "feedback_error": "Transcript saved. Gemini feedback could not be generated this time."})
        return jsonify({"transcript": transcript, "feedback": feedback_data})
    except (requests.RequestException, KeyError, ValueError, TypeError) as error:
        app.logger.exception("Optional voice feedback failed")
        return jsonify({"error": "Feedback could not be generated right now. Your practice session is still saved on this page."}), 502


if __name__ == "__main__":
    app.run(debug=os.getenv("FLASK_DEBUG", "false").lower() == "true")
