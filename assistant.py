"""Grounded request retrieval with TF-IDF; no generated clinical advice."""
import re
from datetime import datetime
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.metrics.pairwise import cosine_similarity

EXAMPLES = {
    "appointment": ["when is my next appointment", "read my appointment details", "what time am I seeing the doctor", "my doctor visit", "which doctor will I see", "appointment date and time"],
    "medications": ["read my medication schedule", "what are my saved medicines", "tell me my medicine instructions", "read my prescription schedule", "my medication information", "when do I take my saved medicine"],
    "visiting": ["what are the visiting hours", "when can my family visit", "visitor timings", "visiting time in the hospital", "what time can visitors come", "when are visits allowed"],
    "registration": ["how do I register", "where is registration", "where is the reception desk", "how do I check in", "patient registration process", "where do I go to register"],
    "pharmacy": ["where is the pharmacy", "find the pharmacy", "where can I collect my prescribed medicines", "pharmacy location", "where is the medicine counter", "how do I find the hospital pharmacy"],
    "departments": ["what departments are available", "list hospital departments", "where is general medicine", "department locations", "where is cardiology", "where is ophthalmology", "where is orthopedics", "where is orthopaedics", "find the eye department"],
    "reminders": ["show my reminders", "read upcoming reminders", "what reminders do I have", "set a reminder", "remind me in one minute", "create a reminder", "add a reminder for medicine"],
    "assistance": ["I need staff assistance", "please call a nurse", "I need a nurse", "request staff help", "can someone assist me", "ask a staff member to help", "I need help from hospital staff"],
}

HOSPITAL = {
    "visiting": "Sample hospital visiting hours are 4 PM to 6 PM, every day. Please check with reception for ward-specific arrangements.",
    "registration": "The sample registration desk is on the ground floor, beside the main reception. Staff can assist you with check-in.",
    "pharmacy": "The sample pharmacy is on the ground floor, beside reception. Ask staff for assistance reaching it. This assistant does not provide walking navigation.",
}
DEPARTMENTS = [
    {"name": "General medicine", "location": "First floor · Room 204", "icon": "stethoscope"},
    {"name": "Cardiology", "location": "First floor · Room 210", "icon": "heart"},
    {"name": "Ophthalmology", "location": "Ground floor · Room 108", "icon": "eye"},
    {"name": "Orthopedics", "location": "Ground floor · Room 112", "icon": "activity"},
]

VOICE_GUIDANCE = (
    "Welcome to CareVoice. I'm here to help with your hospital visit. "
    "You've tapped the large microphone in the centre of your screen. "
    "When you hear the tone, speak naturally and then pause. I'll answer aloud and listen again. "
    "Ask about appointments, saved medication instructions, hospital services, reminders, or staff assistance. "
    "Say help for guidance, repeat to hear an answer again, or done, thank you, to finish. "
    "You can also tap the same microphone again to stop. "
    "If your browser asks for microphone access, choose Allow. How can I help you today?"
)


class RequestMatcher:
    def __init__(self):
        self.labels = []
        corpus = []
        for label, examples in EXAMPLES.items():
            self.labels.extend([label] * len(examples))
            corpus.extend(examples)
        self.vectorizer = TfidfVectorizer(ngram_range=(1, 2), stop_words="english", sublinear_tf=True)
        self.matrix = self.vectorizer.fit_transform(corpus)

    def match(self, text):
        scores = cosine_similarity(self.vectorizer.transform([text]), self.matrix)[0]
        ranked = sorted(((max(float(s) for s, label in zip(scores, self.labels) if label == intent), intent)
                         for intent in EXAMPLES), reverse=True)
        score, intent = ranked[0]
        # A conservative baseline, measured on the included independent test set.
        if score < 0.28 or score - ranked[1][0] < 0.06:
            return "unknown", round(score, 3)
        return intent, round(score, 3)


def clinical_question(text):
    return bool(re.search(
        r"\b(diagnos\w*|symptoms?|chest pain|can't breathe|cannot breathe|overdose|suicid\w*)\b|"
        r"(?:what|which) (?:medicine|drug|treatment) should|(?:change|increase|double|skip|stop) (?:my |the )?(?:dose|medicine|medication)|"
        r"\b(?:cure|treat) (?:my|a|the)\b|how (?:much|many) .* (?:take|tablets)|what .*dose", text))


def conversation_finished(text):
    normalized = re.sub(r"[^a-z0-9' ]", " ", text.lower().replace('’', "'"))
    normalized = re.sub(r"\s+", " ", normalized).strip()
    return bool(re.fullmatch(
        r"(?:(?:okay|ok|well|thanks|thank you) )?(?:(?:i'm|i am|im) (?:all )?(?:done|finished)(?: now| for now| for today)?|"
        r"(?:that's|that is|thats) (?:all|it)(?: for now)?|(?:all )?(?:done|finished)(?: now| for now)?|no more questions|nothing else|"
        r"end (?:the )?conversation|stop (?:the )?conversation|goodbye|bye(?: bye)?)"
        r"(?: (?:and )?(?:thank you|thanks)(?: very much| so much)?)?", normalized))


def followup_intent(text, previous):
    """Limited, explicit follow-ups; this is not an open-ended language model."""
    normalized = re.sub(r"[^a-z ]", "", text).strip()
    if previous in {'appointment', 'visiting'} and normalized in {
        'what time', 'what time is it', 'what time is that', 'and the time',
        'when is it', 'what day is it', 'which day', 'what time again',
    }:
        return previous
    if previous == 'appointment' and normalized in {'where is it', 'which room', 'where do i go', 'which doctor', 'who is the doctor'}:
        return 'appointment'
    if previous in {'pharmacy', 'registration', 'departments'} and normalized in {'where is it', 'where is that', 'tell me the location again'}:
        return previous
    return None


def information_response(intent, text, data):
    if intent == "appointment":
        a = data["appointment"]
        if not a:
            return "There is no saved appointment in your account yet. I can still help with hospital information and reminders. What would you like to do?"
        when = datetime.fromisoformat(a["starts_at"])
        return (f"Your saved sample appointment is on {when.strftime('%A, %d %B %Y')} at "
                f"{when.strftime('%I:%M %p').lstrip('0')} India time, with {a['doctor']} in "
                f"{a['department']}, {a['room']}. This is a fictional demonstration record.")
    if intent == "medications":
        if not data['medications']:
            return "There are no saved medication instructions in your account yet. I can help with hospital information or reminders instead."
        entries = " ".join(f"{m['name']}, {m['time_label']}. {m['instruction']}" for m in data["medications"])
        return "Your fictional medication schedule: " + entries + " These are demonstration entries, not a prescription."
    if intent in HOSPITAL:
        return HOSPITAL[intent]
    if intent == "departments":
        query = text.replace("orthopaedics", "orthopedics")
        matches = [d for d in DEPARTMENTS if d["name"].lower() in query or (d["name"] == "Ophthalmology" and "eye" in query)]
        selected = matches or DEPARTMENTS
        return "Sample hospital locations. " + ". ".join(f"{d['name']}: {d['location'].replace('·', ',')}" for d in selected) + ". Please ask staff for assistance reaching a department."
    return "I can read appointments, saved medication instructions, hospital information and reminders, or record a staff assistance request. Which would you like?"
