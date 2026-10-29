# CareVoice — Phase III implementation notes

Project: Voice Based AI Assistant for Visually Impaired Patients in Healthcare Settings.

## Implemented system

The browser handles microphone input and device speech output. It sends the
recognized text to a Python Flask API. A TF-IDF vectorizer and cosine-similarity
matcher select a supported request; fixed response templates retrieve fictional
appointment, medication and hospital information. SQLite stores reminders and
confirmed assistance requests. A separate local staff screen displays and
acknowledges requests.

Patient speech -> browser speech recognition -> text -> Flask -> request matcher
-> SQLite / sample knowledge base -> grounded response -> browser speech synthesis.

The current patient screen uses a minimal healthcare-blue interface and Manrope
typography. A large central microphone replaces the visual dashboard, question
shortcuts, typing box and reminder form. The first tap speaks guidance before
listening starts. The same microphone stops the conversation on a second tap.
Restarting a conversation skips onboarding until the page is reloaded. The
two-note Web Audio listening cue is unlocked by a user tap and plays when
recognition starts; a local WAV fallback supports browsers without Web Audio.
Icons and fonts are stored locally. A separate patient overview provides a
caregiver-friendly view of all saved appointments, medication instructions,
reminders, assistance requests and sample hospital locations for the current
account. It supports reminder management and request acknowledgement; it is
not a separate caregiver role or hospital integration.

## Modules and milestones

| Module | Implementation status | Verification status |
|---|---|---|
| Patient interface and responsive styles | Implemented | Desktop and phone-width browser review completed; no horizontal overflow observed at the checked width |
| Appointment, medication and hospital retrieval | Implemented | Backend integration and text-matching smoke evaluation |
| Microphone input | Implemented | Real microphone/browser-service check pending |
| Spoken replies, repeat, stop, speed and voice settings | Implemented | JavaScript syntax checked; audio playback check pending |
| One-time reminder storage, due state and acknowledgement | Implemented | Backend persistence and due-state tests pass |
| Spoken reminder setup and notification | Implemented | Guided setup, confirmation, cancellation and duration validation tested; device audio/timing check pending |
| Staff-request confirmation and acknowledgement | Implemented | Backend confirmation, cancellation, acknowledgement and duplicate-confirmation tests pass |
| Keyboard labels, contrast and text settings | Implemented | Keyboard/screen-reader assessment pending |
| Turn-taking voice conversation | Implemented | State-controller and playback tests pass; real microphone/audio check pending |
| Local accounts and scoped records | Implemented | Registration, password hashing, login/logout and cross-account isolation tested |
| ElevenLabs voice adapter | Implemented and locally configured | Mocked success/failure and key protection tested; live MP3 generation verified through the Flask endpoint |
| Mobile app design | Six screen concepts implemented | Browser board visually inspected; native app and target-user tests are future work |

## Measured development checks

- Backend/integration/parser suite: 23 tests across the three Python test files,
  including patient-overview account isolation and all saved appointments.
- JavaScript controller/playback/cue suite: 14 tests covering onboarding once per
  page load, browser timer binding, turn-taking, cancellation, silence, device
  output, cloud fallback and the two-note cue. Browser stop/restart was checked;
  real laptop microphone recognition and audible tone checks remain pending.
- Independent-phrasing development smoke set: 16 supported questions and 4
  unrelated questions. The supported questions use wording different from the
  retrieval examples, but are still developer-authored.
- Correct supported matches: **15 / 16 (93.75%)**.
- Unrelated questions rejected: **4 / 4**.
- One question about relatives visiting was rejected as ambiguous. This is an
  observed limitation, not silently counted as a correct answer.
- Latest measured text-matching median: see `test-results/evaluation.json`.
  This measures the local matcher, not microphone recognition, network time,
  speech playback, clinical accuracy, or end-to-end response time.
- JavaScript syntax: checked with Node for patient and staff scripts.

Do not present these small development checks as a general accuracy guarantee or
validation with visually impaired patients. Do not mark pending manual checks as
passed before observing them.

## Coding quality

- Database, matching, routes, templates and client behaviour are separate modules.
- SQL operations use parameterized statements; writes use transactions.
- Request text and reminder values have type, length and date validation.
- User-provided strings are rendered with `textContent`, not HTML interpolation.
- JSON errors distinguish invalid input, missing records and failed storage.
- Assistance confirmation is short-lived; a repeated yes does not create a second request.
- Database failures never produce a success acknowledgement.
- Reminder checking does not interrupt an active spoken reply.
- No real clinical records or external staff messaging integration is included.
  Voice credentials remain in the ignored local `.env` file, outside frontend code.

## Manual validation to complete on the demonstration laptop

| Check | Procedure | Record actual result |
|---|---|---|
| Microphone recognition | Ask an appointment question in Chrome after granting microphone access | Pending |
| Voice output | Tap central microphone for spoken onboarding; test repeat and stop | First-tap guidance and second-tap stop observed in browser; real speaker playback pending |
| One-minute reminder | Say set a reminder, give a label, say in one minute, confirm yes; keep page open | Spoken-turn API workflow verified; live device timing pending |
| Reminder acknowledgement | Say dismiss reminders; confirm dismissed status persists | Backend persistence verified; live speech recognition pending |
| Staff workflow | Request help, say/type yes, open staff screen, acknowledge | Backend verified; UI pending |
| Keyboard operation | Reach and activate central microphone; open/close labelled settings | Labels and settings checked; full assistive-technology review pending |
| Narrow screen | Inspect layout and controls at mobile width; check for horizontal overflow | Reviewed at phone width, including larger text; no horizontal overflow observed |
| Microphone refusal | Deny access and confirm a spoken recovery instruction and stopped microphone | Live permission test pending |
| Unknown request | Ask an unrelated question and confirm supported-command guidance | Backend verified; UI pending |
| Clinical boundary | Ask for a treatment recommendation and confirm referral to a professional | Backend verified; UI pending |

The central-microphone website was reviewed at desktop and phone widths. The
desktop microphone measured 200 by 200 pixels, centred at (640, 450) in a
1280 by 900 viewport. On a 390 by 844 phone viewport it measured 178 by 178 pixels,
centred at (195, 412). No horizontal overflow was observed, including larger text.
First-tap guidance and second-tap stopping were checked. Preview
images are saved under `output/previews/`. A live ElevenLabs MP3 was generated
through the Flask voice endpoint. Real microphone recognition and speaker playback
on the demonstration device remain unverified.

## Limitations and future work

This is a localhost prototype with hashed-password patient accounts. New accounts
begin empty and have isolated reminders and requests. The guest workspace retains
the fictional patient records. A separate authenticated hospital staff role is not
implemented; the assistance dashboard shows only the current workspace. The app
reads saved appointments but does not book them. Medication
entries are sample labels, not prescriptions. Spoken reminders accept relative
seconds, minutes and hours within 24 hours, with confirmation. Arbitrary calendar-date
parsing is not implemented. Alerts need an open
browser page; background throttling may delay them. Speech recognition may use a
remote service. Hospital integration, multilingual support, closed-app
notifications, password recovery, email verification and indoor navigation are future work. The local help queue does
not contact a real nurse or emergency service.
