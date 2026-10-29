"""Optional server-side ElevenLabs adapter. API keys never reach the browser."""
import json
import re
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


class VoiceUnavailable(Exception):
    pass


def create_audio(text, api_key, voice_id, model_id='eleven_flash_v2_5'):
    if not api_key or not voice_id:
        raise VoiceUnavailable('ElevenLabs is not configured. Use the device voice for now.')
    if not re.fullmatch(r'[A-Za-z0-9_-]{1,100}', voice_id):
        raise VoiceUnavailable('The configured voice ID is invalid.')
    payload = json.dumps({'text':text, 'model_id':model_id}).encode('utf-8')
    req = Request(f'https://api.elevenlabs.io/v1/text-to-speech/{voice_id}?output_format=mp3_44100_128',
                  data=payload, headers={'xi-api-key':api_key, 'Content-Type':'application/json', 'Accept':'audio/mpeg'}, method='POST')
    try:
        with urlopen(req, timeout=12) as response:
            audio = response.read(10 * 1024 * 1024 + 1)
            if len(audio) > 10 * 1024 * 1024 or not response.headers.get('Content-Type', '').startswith('audio/'):
                raise VoiceUnavailable('The voice service returned an unexpected response.')
            return audio
    except HTTPError as error:
        if error.code in {401, 403}:
            raise VoiceUnavailable('ElevenLabs could not authorize this voice. Check the server configuration.') from None
        if error.code == 429:
            raise VoiceUnavailable('The voice service is busy or its usage limit was reached.') from None
        raise VoiceUnavailable('ElevenLabs could not generate this reply. The device voice will be used.') from None
    except (URLError, TimeoutError, OSError):
        raise VoiceUnavailable('The voice service could not connect. The device voice will be used.') from None
