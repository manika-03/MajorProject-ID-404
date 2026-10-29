"""Small, explicit voice-guided reminder flow. No reminder is saved before yes."""
import re

SMALL = dict(zip('zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen'.split(), range(20)))
TENS = dict(zip('twenty thirty forty fifty sixty seventy eighty ninety'.split(), range(20, 100, 10)))


def parse_duration(text):
    cleaned = re.sub(r'[^a-z0-9 ]', ' ', text.lower())
    cleaned = re.sub(r'\s+', ' ', cleaned).strip()
    match = re.fullmatch(r'(?:in |after )?([a-z0-9 ]+) (seconds?|minutes?|hours?)(?: from now)?', cleaned)
    if not match:
        return None
    quantity, unit = match.groups()
    words = quantity.split()
    if quantity.isdigit():
        number = int(quantity)
    elif quantity in {'a', 'an'}:
        number = 1
    elif quantity in SMALL:
        number = SMALL[quantity]
    elif quantity in TENS:
        number = TENS[quantity]
    elif len(words) == 2 and words[0] in TENS and words[1] in SMALL and 0 < SMALL[words[1]] < 10:
        number = TENS[words[0]] + SMALL[words[1]]
    else:
        return None
    seconds = number * (3600 if unit.startswith('hour') else 60 if unit.startswith('minute') else 1)
    return seconds if 5 <= seconds <= 86400 else None


def duration_label(seconds):
    if seconds % 3600 == 0:
        number, unit = seconds // 3600, 'hour'
    elif seconds % 60 == 0:
        number, unit = seconds // 60, 'minute'
    else:
        number, unit = seconds, 'second'
    return f"{number} {unit}{'' if number == 1 else 's'}"


def confirmation(draft):
    return f"Remind you to {draft['label']} in {duration_label(draft['seconds'])} from your confirmation. Say yes to save it, or no to cancel."


def begin_reminder(text):
    draft = {'stage':'label'}
    # Support a simple one-sentence request as well as the guided flow.
    match = re.search(r'\bin (.+? (?:seconds?|minutes?|hours?))(?: to (.+))?\s*[.!?]?$', text)
    if match:
        seconds = parse_duration(match.group(1))
        label = (match.group(2) or '').strip(' .!?')
        if seconds:
            draft['seconds'] = seconds
            if label and len(label) <= 120:
                draft.update(label=label, stage='confirm')
                return draft, confirmation(draft)
    return draft, 'What should I remind you about? Say a short description, or say cancel.'


def advance_reminder(draft, text):
    draft = dict(draft)
    if draft['stage'] == 'label':
        label = text.strip(' .!?')
        if not 1 <= len(label) <= 120:
            return draft, 'Please say a shorter reminder description, up to 120 characters.', False
        draft['label'] = label
        if 'seconds' in draft:
            draft['stage'] = 'confirm'
            return draft, confirmation(draft), False
        draft['stage'] = 'delay'
        return draft, 'When should I remind you? For example, say in one minute or in two hours. Choose a time within the next 24 hours.', False
    if draft['stage'] == 'delay':
        seconds = parse_duration(text)
        if not seconds:
            return draft, 'Please say a number of minutes, hours or seconds, within the next 24 hours. For example, in five minutes. Say cancel to leave this reminder.', False
        draft.update(seconds=seconds, stage='confirm')
        return draft, confirmation(draft), False
    control = re.sub(r'\s+', ' ', re.sub(r'[^a-z ]', ' ', text)).strip()
    if control in {'yes', 'yes please', 'confirm', 'save it', 'save the reminder'}:
        return draft, '', True
    return draft, 'The reminder has not been saved. Say yes to save it, or no to cancel.', False
