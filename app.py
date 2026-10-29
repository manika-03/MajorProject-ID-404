"""CareVoice local demonstration app. Run: python app.py"""
from datetime import datetime, timezone, timedelta
from pathlib import Path
import os
import re
import secrets
import sqlite3
import time
from threading import Lock

from flask import Flask, Response, jsonify, redirect, render_template, request, session
from werkzeug.exceptions import HTTPException
from werkzeug.security import check_password_hash, generate_password_hash

from assistant import DEPARTMENTS, VOICE_GUIDANCE, RequestMatcher, clinical_question, conversation_finished, followup_intent, information_response
from spoken_reminders import advance_reminder, begin_reminder, duration_label
from configuration import load_local_environment, session_secret
from database import IST, connection, initialize, patient_data, reminders, utc_now
from voice_provider import VoiceUnavailable, create_audio

ROOT = Path(__file__).resolve().parent
HELP = VOICE_GUIDANCE


def create_app(test_config=None):
    load_local_environment(ROOT)
    app = Flask(__name__)
    app.config.update(SECRET_KEY=(test_config or {}).get('SECRET_KEY') or session_secret(ROOT), DATABASE=str(ROOT / "instance" / "carevoice.db"),
                      MAX_CONTENT_LENGTH=8192, SESSION_COOKIE_HTTPONLY=True, SESSION_COOKIE_SAMESITE="Strict",
                      PERMANENT_SESSION_LIFETIME=timedelta(hours=12),
                      ELEVENLABS_API_KEY=os.environ.get('ELEVENLABS_API_KEY', ''),
                      ELEVENLABS_VOICE_ID=os.environ.get('ELEVENLABS_VOICE_ID', ''),
                      ELEVENLABS_MODEL_ID=os.environ.get('ELEVENLABS_MODEL_ID', 'eleven_flash_v2_5'))
    if test_config:
        app.config.update(test_config)
    initialize(app.config["DATABASE"])
    matcher = RequestMatcher()
    rate_windows = {}
    rate_lock = Lock()
    dummy_hash = generate_password_hash(secrets.token_hex(16))

    def limited(bucket, maximum, seconds=300):
        key = (bucket, request.remote_addr)
        now = time.monotonic()
        with rate_lock:
            # Each bucket retains its own time window under concurrent requests.
            for old in list(rate_windows):
                window = 60 if old[0] == 'tts' else 300
                rate_windows[old] = [t for t in rate_windows[old] if now-t < window]
                if not rate_windows[old]:
                    del rate_windows[old]
            entries = rate_windows.setdefault(key, [])
            if len(entries) >= maximum:
                return True
            entries.append(now)
            return False

    def account():
        user_id = session.get('user_id')
        if user_id:
            with connection(app.config['DATABASE']) as db:
                row = db.execute('SELECT user_account.id, email, patient_id, name FROM user_account JOIN patient ON patient.id = user_account.patient_id WHERE user_account.id = ?', (user_id,)).fetchone()
            if row:
                return dict(row)
        return None

    def patient_id():
        user = account()
        return user['patient_id'] if user else 1

    @app.before_request
    def local_requests():
        # JSON + same-origin checks apply to login as well as patient mutations.
        if request.method in {"POST", "DELETE", "PATCH"}:
            origin = request.headers.get("Origin")
            if origin and origin != request.host_url.rstrip("/"):
                return jsonify(error="Cross-origin changes are not allowed."), 403
            if request.mimetype != "application/json":
                return jsonify(error="Send a JSON request."), 415

    @app.after_request
    def headers(response):
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["Referrer-Policy"] = "same-origin"
        response.headers["Content-Security-Policy"] = "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; media-src 'self' blob:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'"
        if request.path.startswith("/api/"):
            response.headers["Cache-Control"] = "no-store"
        return response

    def payload():
        value = request.get_json(silent=True)
        return value if isinstance(value, dict) else {}

    @app.get("/")
    def home():
        return render_template("index.html", account=account())

    @app.get('/login')
    def login_page():
        if account():
            return redirect('/')
        return render_template('login.html')

    @app.get('/mobile-design')
    def mobile_design():
        return render_template('mobile-design.html')

    @app.post('/api/auth/register')
    def register():
        if limited('auth', 15):
            return jsonify(error='Too many account attempts. Please wait five minutes.'), 429
        data = payload()
        name, email, password = data.get('name'), data.get('email'), data.get('password')
        if (not isinstance(name, str) or not 1 <= len(name.strip()) <= 80 or
                not isinstance(email, str) or len(email) > 254 or
                not re.fullmatch(r'[^\s@]+@[^\s@]+\.[^\s@]+', email.strip()) or
                not isinstance(password, str) or not 8 <= len(password) <= 128):
            return jsonify(error='Enter your name, a valid email, and a password of 8 to 128 characters.'), 400
        email = email.strip().casefold()
        password_hash = generate_password_hash(password)
        try:
            with connection(app.config['DATABASE']) as db:
                if db.execute('SELECT 1 FROM user_account WHERE email = ?', (email,)).fetchone():
                    return jsonify(error='An account with this email already exists. Please sign in.'), 409
                cursor = db.execute('INSERT INTO patient (name, code) VALUES (?, ?)', (name.strip(), 'CV-' + secrets.token_hex(4).upper()))
                identifier = cursor.lastrowid
                cursor = db.execute('INSERT INTO user_account (email, password_hash, patient_id, created_at) VALUES (?, ?, ?, ?)',
                                    (email, password_hash, identifier, utc_now().isoformat()))
                user_id = cursor.lastrowid
        except sqlite3.IntegrityError:
            return jsonify(error='This account could not be created. Please try signing in.'), 409
        session.clear()
        session['user_id'] = user_id
        session.permanent = True
        return jsonify(message='Your account is ready.', redirect='/'), 201

    @app.post('/api/auth/login')
    def login():
        if limited('auth', 15):
            return jsonify(error='Too many account attempts. Please wait five minutes.'), 429
        data = payload()
        email, password = data.get('email'), data.get('password')
        if not isinstance(email, str) or not isinstance(password, str) or len(email) > 254 or len(password) > 128:
            return jsonify(error='Enter a valid email and password.'), 400
        with connection(app.config['DATABASE']) as db:
            row = db.execute('SELECT id, password_hash FROM user_account WHERE email = ?', (email.strip().casefold(),)).fetchone()
        correct = check_password_hash(row['password_hash'] if row else dummy_hash, password)
        if not row or not correct:
            return jsonify(error='The email or password is incorrect.'), 401
        session.clear()
        session['user_id'] = row['id']
        session.permanent = True
        return jsonify(message='Welcome back.', redirect='/')

    @app.post('/api/auth/logout')
    def logout():
        session.clear()
        return jsonify(message='You have signed out.', redirect='/')

    @app.get('/api/auth/me')
    def me():
        user = account()
        return jsonify(authenticated=bool(user), account=user)

    @app.get("/staff")
    def staff():
        return render_template("staff.html")

    def overview_data():
        identifier = patient_id()
        with connection(app.config['DATABASE']) as db:
            patient = dict(db.execute('SELECT * FROM patient WHERE id = ?', (identifier,)).fetchone())
            appointments = [dict(row) for row in db.execute('SELECT * FROM appointment WHERE patient_id = ? ORDER BY starts_at', (identifier,))]
            medications = [dict(row) for row in db.execute('SELECT * FROM medication WHERE patient_id = ? ORDER BY id', (identifier,))]
            requests = [dict(row) for row in db.execute('SELECT * FROM assistance WHERE patient_id = ? ORDER BY id DESC', (identifier,))]
        return dict(patient=patient, appointments=appointments, medications=medications,
                    reminders=reminders(app.config['DATABASE'], identifier), requests=requests,
                    departments=DEPARTMENTS, account=account(), server_time=utc_now().isoformat())

    @app.template_filter('india_time')
    def india_time(value):
        return datetime.fromisoformat(value).astimezone(IST).strftime('%d %b %Y · %I:%M %p')

    @app.get('/patient-overview')
    def patient_overview():
        response = app.make_response(render_template('patient-overview.html', **overview_data()))
        response.headers['Cache-Control'] = 'no-store'
        return response

    @app.get('/api/patient-overview')
    def patient_overview_api():
        return jsonify(**overview_data())

    @app.get("/api/bootstrap")
    def bootstrap():
        return jsonify(**patient_data(app.config["DATABASE"], patient_id()), departments=DEPARTMENTS,
                       reminders=reminders(app.config["DATABASE"], patient_id()), server_time=utc_now().isoformat(),
                       account=account(), guidance=VOICE_GUIDANCE, voice={'elevenlabs_available':bool(app.config['ELEVENLABS_API_KEY'] and app.config['ELEVENLABS_VOICE_ID'])})

    @app.post('/api/tts')
    def tts():
        if not (app.config['ELEVENLABS_API_KEY'] and app.config['ELEVENLABS_VOICE_ID']):
            return jsonify(error='ElevenLabs is not configured. The device voice is available.'), 503
        if limited('tts', 30, 60):
            return jsonify(error='Voice request limit reached. Please use the device voice briefly.'), 429
        text = payload().get('text')
        if not isinstance(text, str) or not text.strip() or len(text) > 1600:
            return jsonify(error='Voice text must contain 1 to 1600 characters.'), 400
        try:
            audio = create_audio(text, app.config['ELEVENLABS_API_KEY'], app.config['ELEVENLABS_VOICE_ID'], app.config['ELEVENLABS_MODEL_ID'])
        except VoiceUnavailable as error:
            return jsonify(error=str(error)), 502
        return Response(audio, mimetype='audio/mpeg', headers={'Cache-Control':'no-store'})

    @app.post("/api/chat")
    def chat():
        start = time.perf_counter()
        text = payload().get("message")
        if not isinstance(text, str) or not text.strip() or len(text) > 500:
            return jsonify(error="Please enter a question between 1 and 500 characters."), 400
        text = re.sub(r"\s+", " ", text.strip().lower().replace('’', "'"))
        control = re.sub(r"\s+", " ", re.sub(r"[^a-z0-9' ]", ' ', text)).strip()
        score = None
        action = None
        pending = session.get("pending_assistance", 0)
        session.pop("pending_assistance", None)
        reminder_draft = session.get('pending_reminder')
        if reminder_draft and time.time() - reminder_draft.get('started_at', 0) > 300:
            session.pop('pending_reminder', None)
            reminder_draft = None
        if conversation_finished(text):
            intent, response, action = 'farewell', "You're welcome. Your conversation has ended and the microphone is off. Take care.", 'end_conversation'
            session.pop('last_intent', None)
            session.pop('pending_reminder', None)
        elif pending and time.time() - pending < 120 and control in {"yes", "yes please", "confirm", "confirm request"}:
            with connection(app.config["DATABASE"]) as db:
                cursor = db.execute("INSERT INTO assistance (patient_id, message, created_at) VALUES (?, ?, ?)",
                                    (patient_id(), "Patient requested staff assistance.", utc_now().isoformat()))
                identifier = cursor.lastrowid
            intent, response = "assistance_confirmed", f"Your sample assistance request number {identifier} has been recorded on the local staff dashboard. Staff have not acknowledged it yet. This does not call a real nurse or emergency service."
        elif control in {"no", "cancel", "cancel reminder", "cancel the reminder", "never mind", "no thanks"} or (re.search(r"\b(don't|do not|not|cancel)\b", text) and re.search(r"\b(nurse|staff|assistance|call)\b", text)):
            session.pop('pending_reminder', None)
            intent, response = "cancel", ("The reminder was not saved. What would you like to do next?" if reminder_draft else "No staff assistance request was recorded. What would you like to do next?")
        elif clinical_question(text):
            intent, response = "clinical_boundary", "I cannot assess symptoms, recommend treatment or change medication. Please speak to a healthcare professional. If you need urgent help, contact nearby staff or your local emergency service directly. This prototype does not contact emergency services."
        elif control in {"repeat", "repeat that", "say that again", "read that again"}:
            intent, response = "repeat", session.get("last_response", HELP)
        elif control in {"help", "hello", "hi", "what can you do", "commands", "help me", "instructions", "read instructions", "how do i use this", "how do i use carevoice"}:
            intent, response = "help", HELP
        elif control in {'thank you', 'thanks', 'thank you very much'}:
            intent, response = 'thanks', "You're welcome. What else would you like to know? Say done, thank you to end our conversation."
        elif control in {"stop", "stop speaking", "be quiet"}:
            intent, response, action = "stop", "Speech stopped.", "stop"
            session.pop('pending_reminder', None)
        elif reminder_draft:
            draft, response, complete = advance_reminder(reminder_draft, text)
            intent = 'reminder_setup'
            if complete:
                due = utc_now() + timedelta(seconds=draft['seconds'])
                with connection(app.config['DATABASE']) as db:
                    db.execute('INSERT INTO reminder (patient_id, label, due_at, created_at) VALUES (?, ?, ?, ?)',
                               (patient_id(), draft['label'], due.isoformat(), utc_now().isoformat()))
                session.pop('pending_reminder', None)
                intent = 'reminder_created'
                response = f"Your reminder to {draft['label']} is saved for {duration_label(draft['seconds'])} from now. Keep this page open so I can speak the reminder."
            else:
                session['pending_reminder'] = draft
        elif control in {'dismiss reminder', 'dismiss reminders', 'dismiss due reminders', 'acknowledge reminder', 'i heard the reminder'}:
            with connection(app.config['DATABASE']) as db:
                changed = db.execute('UPDATE reminder SET acknowledged_at = ? WHERE patient_id = ? AND acknowledged_at IS NULL AND due_at <= ?',
                                     (utc_now().isoformat(), patient_id(), utc_now().isoformat())).rowcount
            intent, response = 'reminder_dismissed', ('The due reminder alerts are dismissed.' if changed else 'There are no due reminder alerts to dismiss.')
        else:
            context_intent = followup_intent(text, session.get('last_intent'))
            intent, score = (context_intent, None) if context_intent else matcher.match(text)
            if intent == "assistance":
                session["pending_assistance"] = time.time()
                response = "Would you like me to record a staff assistance request on the local demo dashboard? Say yes to confirm, or no to cancel. This does not call a real nurse."
            elif intent == "reminders":
                active = [r for r in reminders(app.config["DATABASE"], patient_id()) if not r["acknowledged_at"]]
                if re.search(r"\b(set|create|add|remind)\b", text):
                    draft, response = begin_reminder(text)
                    draft['started_at'] = time.time()
                    session['pending_reminder'] = draft
                else:
                    response = "You have no pending reminders. Say set a reminder if you would like to create one." if not active else "Your pending reminders: " + "; ".join(f"{r['label']} on {datetime.fromisoformat(r['due_at']).astimezone(IST).strftime('%d %B at %I:%M %p')} India time" for r in active[:5])
                    if len(active) > 5:
                        response += f". There are {len(active)-5} more in the reminders list."
            else:
                response = information_response(intent, text, patient_data(app.config["DATABASE"], patient_id()))
            if intent not in {'unknown', 'assistance'}:
                session['last_intent'] = intent
        if intent != "repeat":
            session["last_response"] = response
        return jsonify(response=response, intent=intent, similarity=score, action=action,
                       processing_ms=round((time.perf_counter() - start) * 1000, 2))

    @app.get("/api/reminders")
    def list_reminders():
        return jsonify(reminders=reminders(app.config["DATABASE"], patient_id()))

    @app.post("/api/reminders")
    def add_reminder():
        data = payload()
        label = data.get("label")
        if not isinstance(label, str) or not 1 <= len(label.strip()) <= 120:
            return jsonify(error="Enter a reminder label between 1 and 120 characters."), 400
        try:
            due = datetime.fromisoformat(data.get("due_at", "").replace("Z", "+00:00"))
            if due.tzinfo is None or due.utcoffset() is None:
                raise ValueError
            due = due.astimezone(timezone.utc)
            if not utc_now() < due <= utc_now() + timedelta(days=365):
                raise ValueError
        except (ValueError, TypeError, AttributeError):
            return jsonify(error="Choose a future time within the next year, including its time zone."), 400
        with connection(app.config["DATABASE"]) as db:
            cursor = db.execute("INSERT INTO reminder (patient_id, label, due_at, created_at) VALUES (?, ?, ?, ?)",
                                (patient_id(), label.strip(), due.isoformat(), utc_now().isoformat()))
            identifier = cursor.lastrowid
        return jsonify(id=identifier, message="Reminder saved. Keep the app open to receive it."), 201

    @app.post("/api/reminders/<int:identifier>/acknowledge")
    def acknowledge_reminder(identifier):
        with connection(app.config["DATABASE"]) as db:
            row = db.execute("SELECT * FROM reminder WHERE id = ? AND patient_id = ?", (identifier, patient_id())).fetchone()
            if not row:
                return jsonify(error="Reminder not found."), 404
            if datetime.fromisoformat(row["due_at"]) > utc_now():
                return jsonify(error="This reminder is not due yet. You can remove it instead."), 409
            db.execute("UPDATE reminder SET acknowledged_at = COALESCE(acknowledged_at, ?) WHERE id = ?", (utc_now().isoformat(), identifier))
        return jsonify(message="Reminder dismissed.")

    @app.delete("/api/reminders/<int:identifier>")
    def delete_reminder(identifier):
        with connection(app.config["DATABASE"]) as db:
            changed = db.execute("DELETE FROM reminder WHERE id = ? AND patient_id = ?", (identifier, patient_id())).rowcount
        return (jsonify(message="Reminder removed."), 200) if changed else (jsonify(error="Reminder not found."), 404)

    @app.get("/api/assistance")
    def assistance():
        with connection(app.config["DATABASE"]) as db:
            rows = db.execute("SELECT assistance.*, patient.name, patient.code FROM assistance JOIN patient ON patient.id = assistance.patient_id WHERE patient_id = ? ORDER BY assistance.id DESC", (patient_id(),)).fetchall()
        return jsonify(requests=[dict(row) for row in rows])

    @app.post("/api/assistance/<int:identifier>/acknowledge")
    def acknowledge_assistance(identifier):
        with connection(app.config["DATABASE"]) as db:
            changed = db.execute("UPDATE assistance SET acknowledged_at = COALESCE(acknowledged_at, ?) WHERE id = ? AND patient_id = ?", (utc_now().isoformat(), identifier, patient_id())).rowcount
        return (jsonify(message="Request acknowledged."), 200) if changed else (jsonify(error="Request not found."), 404)

    @app.errorhandler(sqlite3.Error)
    def storage_error(error):
        app.logger.exception("Database operation failed")
        return jsonify(error="The local database is unavailable. Your action could not be confirmed. Please try again."), 503

    @app.errorhandler(HTTPException)
    def http_error(error):
        if request.path.startswith("/api/"):
            return jsonify(error=error.description), error.code
        return error

    return app


if __name__ == "__main__":
    create_app().run(host="127.0.0.1", port=int(os.environ.get("PORT", 5000)), debug=False)
