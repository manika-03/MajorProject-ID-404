# CareVoice

A voice-first healthcare accessibility **student prototype**. Built with Python,
Flask, SQLite, scikit-learn and browser speech APIs. The interface uses a healthcare
blue palette, the locally bundled Manrope font, and accessible controls.

## Run on this computer

Double-click **start.bat** in this folder, then open http://127.0.0.1:5000 in Chrome.
Keep the terminal open. Press Ctrl+C there to stop the server.

Alternatively, from PowerShell in this folder:

```powershell
.\.venv\Scripts\python.exe app.py
```

If port 5000 is occupied, set `$env:PORT = '5001'` before starting, then use port 5001.

## Install on another computer

Install Python 3.12 or newer, then open a terminal in this folder:

```powershell
py -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe app.py
```

You do not need to activate the virtual environment. If Python is installed under
the `python` command rather than `py`, use `python -m venv .venv`.

## Demonstration

1. Open the patient page. The large blue microphone is the primary control,
   centred on the screen. It is a labelled button usable with a keyboard or screen reader.
2. Tap the microphone once. CareVoice speaks the instructions first, then opens
   listening. Allow the browser microphone prompt if asked. Speak after the tone.
   The clear two-note listening cue is enabled by the initial tap and sounds only
   when recognition starts. Stopping and starting again skips the introduction;
   reloading the page resets it. Say “help” to request the instructions again.
   Ask “When is my next appointment?”, “Read my medication schedule”,
   “Where is cardiology?”, or “What are the visiting hours?”.
3. After the spoken reply, the microphone listens again automatically. Ask
   “What time?” after an appointment question to demonstrate context. Say
   **“Done, thank you”** to end. Tapping the large microphone again stops immediately.
   Say “help” for instructions, “repeat” for the last reply, or “speak slower”.
   Microphone/network errors pause the session. Three silent turns pause it.
   There is no patient typing box or visual question-selection menu.
4. Say **“Set a reminder”**. Answer what to remember, then say **“in one minute”**.
   Say **“yes”** when the assistant confirms the details. Keep the page open for the
   spoken alert. Say **“dismiss reminders”** to acknowledge due alerts. This does
   not record that medicine was taken. Browser background throttling can delay alerts.
5. Ask “I need staff assistance”, then “yes”. Open http://127.0.0.1:5000/staff in
   another tab to see and acknowledge the request. This is a local simulated queue;
   it does not phone or message real staff or emergency services.
6. Try an unrelated question and a clinical question to show the fallback.

## What works

- English voice input when the browser's recognition service is available.
- A minimal central-microphone screen with spoken onboarding before listening.
- Turn-taking conversation, limited follow-up context, closing-phrase detection,
  screen-reader-accessible transcript, repeat, stop, speech speed and voice selection.
- Optional ElevenLabs text-to-speech through the Python server, with a device fallback.
- TF-IDF word/bigram retrieval with cosine similarity and rejection thresholds.
- Fictional appointment, medication schedule, department and hospital information.
- Persistent one-time reminders created through a guided spoken conversation and
  confirmation, with spoken due alerts and spoken acknowledgement.
- Confirmed staff-help requests and a polling local staff dashboard.
- Patient overview at http://127.0.0.1:5000/patient-overview, linked from the voice
  screen. A caregiver using the current account can view all saved appointments,
  medication instructions, reminders, assistance requests and sample hospital
  locations. They can add/remove reminders, dismiss due alerts and acknowledge
  requests. It refreshes every 15 seconds without replacing focused controls.
  This is the same patient workspace; separate caregiver roles are not implemented.
- A top-right account icon opens the spoken login concept. It asks for a sample
  email/login ID, reads it back for confirmation, explains the future fingerprint
  step, then lets the visitor continue as a guest by voice or button. No fingerprint
  is scanned, and a spoken ID never authenticates or selects a patient record.
- The earlier password account APIs are retained, with scrypt hashing, scoped
  records and limited login attempts; the current login interface uses guest
  access only. A persistent signing key lives in the ignored `instance/` directory.
- Keyboard controls, semantic labels, live statuses, high contrast, large text,
  reduced-motion support and responsive layout. No accessibility certification is claimed.

## Limitations to explain in your review

- Guest patient records, medicines, locations and hospital policies are fictional.
  New accounts begin empty; no appointments or medicines are invented for a new user.
- This application gives no diagnosis, prescribing, dose changes or clinical decisions.
- Browser speech recognition may send audio to a provider and require internet.
  Availability depends on the browser, account policies, device and microphone.
- Text requests in automated API tests do not establish microphone recognition quality.
- Spoken reminders require an open page, voice activation and a working device
  voice. Nothing runs after the app closes. No OS notification service is installed.
- Read-back reminder and appointment times use India time.
- Spoken reminders support relative seconds/minutes/hours within the next 24 hours.
  Arbitrary calendar dates and closed-app notifications are not implemented.
- Appointment booking, indoor navigation, hospital integration, password reset and
  email verification are not implemented. Accounts are local to this computer.
  The staff dashboard is a simulated queue scoped to the current workspace, not
  a separate hospital staff role or externally connected nurse station.
- Bind to localhost only. Flask's development server and this demo access model
  are not suitable for deployment with real patient records.
- TF-IDF is lexical retrieval, not general language understanding. Negation and
  complex multi-intent requests can be misunderstood; scope and fallback are limited.

## Code map

- `app.py`: Flask routes, validation, session confirmation and local request checks.
- `assistant.py`: example requests, TF-IDF matcher and grounded response templates.
- `database.py`: schema, fictional seed records and transaction helpers.
- `spoken_reminders.py`: guided label/time/confirmation flow and duration parsing.
- `voice_provider.py`: server-side ElevenLabs adapter; `configuration.py`: local settings.
- `templates/`: patient screen, staff screen and local SVG icons.
- `static/`: interface CSS, voice/reminder JavaScript and original vector illustration.
- `tests/`: integration checks and a small independent-phrasing evaluation.
- `instance/carevoice.db`: local SQLite file, generated on first launch.

## Verification

```powershell
.\.venv\Scripts\python.exe -m unittest discover -s tests -v
.\.venv\Scripts\python.exe tests\evaluate.py
node --test tests\conversation.test.cjs tests\login-concept.test.cjs
```

The evaluator writes actual results to `test-results/evaluation.json`. It measures
text matching only. Add your own unseen phrases, speakers and noise conditions;
do not present a small development test as patient validation.

## Phase III evidence

Capture the patient screen, a successful spoken interaction, the appointment reply,
a due reminder, and the staff acknowledgement. Record observed results for denied
microphone access, lost speech-service connectivity and keyboard-only operation.
Keep claimed milestones consistent with actual tested behaviour.

## Voice login concept and guest access

Open the account icon at the top right, or http://127.0.0.1:5000/login. Tap the
central microphone, say a sample ID such as “demo one”, then confirm it with “yes”.
CareVoice explains that fingerprint verification is planned and not connected.
Say “continue as guest”, or use the matching button, to open the fictional Alex
workspace. Say “no” to correct an ID, “try again” to restart, or “stop” to pause.

The sample identifier stays in page memory and is cleared on leaving. It is not
saved in local storage, sent to the application API, or used to open an account.
Login prompts and ID readback use the device voice; the identifier is not sent to
ElevenLabs. Browser speech recognition may still use its provider's online service.
The guest button clears any existing signed-in session before returning home.
Real fingerprint authentication, biometric enrolment and account lookup by spoken
identifier are not implemented. The earlier password APIs and their tests remain
in the source; the password form is no longer the active login interface.

## Optional ElevenLabs voice

1. In your ElevenLabs account, create a Text to Speech API key and choose a voice
   available to your account. Copy its voice ID. Never paste your key into chat.
2. Copy `.env.example` to `.env` in this folder and enter the key and voice ID locally.
3. Restart the Python server. Open Accessibility and select **ElevenLabs** under
   Spoken voice service. Test the voice.

The included model setting is `eleven_flash_v2_5`; it is configurable with
`ELEVENLABS_MODEL_ID`. Only reply text is sent for voice generation; browser speech
recognition still handles microphone input separately. The key stays on the
server, not in JavaScript. If the service fails or reaches a usage limit, the
application attempts the device voice. Internet and sufficient API credits are
required. Check the provider's current pricing and voice access before use.

The adapter has automated success/failure tests. A live ElevenLabs reply has also
been generated through CareVoice's own voice endpoint using the local credentials.
When no voice preference is saved, configured ElevenLabs is selected by default.
Use fictional healthcare content for demonstrations.

Official API reference: https://elevenlabs.io/docs/api-reference/text-to-speech/convert
Model reference: https://elevenlabs.io/docs/overview/models

## Project scope

This project is a website. A native mobile app is outside the current scope.
The older `/mobile-design` board is retained as an archived design exercise;
it is not an implemented app or a current delivery milestone. The locally
bundled font's license is in `static/fonts/OFL.txt`.
