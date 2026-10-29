"""Small, local SQLite store. Every seeded record is fictional."""
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path
import sqlite3

IST = timezone(timedelta(hours=5, minutes=30))


def utc_now():
    return datetime.now(timezone.utc)


@contextmanager
def connection(path):
    db = sqlite3.connect(path, timeout=10)
    db.row_factory = sqlite3.Row
    db.execute("PRAGMA foreign_keys = ON")
    try:
        yield db
        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


def initialize(path):
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    with connection(path) as db:
        db.executescript("""
            CREATE TABLE IF NOT EXISTS patient (
                id INTEGER PRIMARY KEY, name TEXT NOT NULL, code TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS appointment (
                id INTEGER PRIMARY KEY, patient_id INTEGER NOT NULL REFERENCES patient(id),
                doctor TEXT NOT NULL, department TEXT NOT NULL, room TEXT NOT NULL,
                starts_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS medication (
                id INTEGER PRIMARY KEY, patient_id INTEGER NOT NULL REFERENCES patient(id),
                name TEXT NOT NULL, instruction TEXT NOT NULL, time_label TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS reminder (
                id INTEGER PRIMARY KEY AUTOINCREMENT, patient_id INTEGER NOT NULL REFERENCES patient(id),
                label TEXT NOT NULL, due_at TEXT NOT NULL, created_at TEXT NOT NULL,
                acknowledged_at TEXT
            );
            CREATE TABLE IF NOT EXISTS assistance (
                id INTEGER PRIMARY KEY AUTOINCREMENT, patient_id INTEGER NOT NULL REFERENCES patient(id),
                message TEXT NOT NULL, created_at TEXT NOT NULL, acknowledged_at TEXT
            );
            CREATE TABLE IF NOT EXISTS user_account (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                email TEXT NOT NULL UNIQUE COLLATE NOCASE,
                password_hash TEXT NOT NULL,
                patient_id INTEGER NOT NULL UNIQUE REFERENCES patient(id),
                created_at TEXT NOT NULL
            );
        """)
        if not db.execute("SELECT 1 FROM patient WHERE id = 1").fetchone():
            tomorrow = datetime.now(IST).date() + timedelta(days=1)
            appointment_time = datetime.combine(tomorrow, datetime.min.time(), IST).replace(hour=10, minute=30)
            db.execute("INSERT INTO patient VALUES (1, ?, ?)", ("Alex Morgan", "CV-DEMO-001"))
            db.execute("INSERT INTO appointment VALUES (1, 1, ?, ?, ?, ?)",
                       ("Dr. Aditi Sharma", "General medicine", "Room 204, first floor",
                        appointment_time.isoformat()))
            db.executemany("INSERT INTO medication VALUES (?, 1, ?, ?, ?)", [
                (1, "Sample medicine A", "Follow the saved sample instruction: after breakfast.", "8:00 AM"),
                (2, "Sample medicine B", "Follow the saved sample instruction: after dinner.", "8:00 PM"),
            ])


def patient_data(path, patient_id=1):
    with connection(path) as db:
        return {
            "patient": dict(db.execute("SELECT * FROM patient WHERE id = ?", (patient_id,)).fetchone()),
            "appointment": next((dict(row) for row in db.execute("SELECT * FROM appointment WHERE patient_id = ? ORDER BY starts_at LIMIT 1", (patient_id,))), None),
            "medications": [dict(row) for row in db.execute("SELECT * FROM medication WHERE patient_id = ? ORDER BY id", (patient_id,))],
        }


def reminders(path, patient_id=1):
    with connection(path) as db:
        rows = [dict(row) for row in db.execute(
            "SELECT * FROM reminder WHERE patient_id = ? ORDER BY due_at DESC, id DESC", (patient_id,))]
    now = utc_now()
    for row in rows:
        row["due"] = row["acknowledged_at"] is None and datetime.fromisoformat(row["due_at"]) <= now
    return rows
