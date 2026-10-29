"""Load only the optional settings used by this app; do not execute .env content."""
import os
from pathlib import Path


def load_local_environment(root):
    path = Path(root) / '.env'
    if not path.is_file():
        return
    allowed = {'ELEVENLABS_API_KEY', 'ELEVENLABS_VOICE_ID', 'ELEVENLABS_MODEL_ID'}
    for line in path.read_text(encoding='utf-8').splitlines():
        if '=' not in line or line.strip().startswith('#'):
            continue
        key, value = line.split('=', 1)
        if key.strip() in allowed:
            os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


def session_secret(root):
    import secrets
    path = Path(root) / 'instance' / 'session-secret'
    path.parent.mkdir(exist_ok=True)
    if not path.exists():
        try:
            with path.open('x', encoding='utf-8') as handle:
                handle.write(secrets.token_hex(32))
        except FileExistsError:
            pass
    return path.read_text(encoding='utf-8').strip()
