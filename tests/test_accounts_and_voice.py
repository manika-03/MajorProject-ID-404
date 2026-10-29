from datetime import timedelta
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch

from app import create_app
from database import connection, utc_now
from voice_provider import VoiceUnavailable, create_audio


class AccountAndVoiceTest(unittest.TestCase):
    def setUp(self):
        self.temp=TemporaryDirectory()
        self.path=str(Path(self.temp.name)/'accounts.db')
        self.app=create_app({'TESTING':True,'DATABASE':self.path,'SECRET_KEY':'test-only','ELEVENLABS_API_KEY':'','ELEVENLABS_VOICE_ID':''})
        self.client=self.app.test_client()

    def tearDown(self):
        self.temp.cleanup()

    def register(self,client,email='alex@example.test'):
        return client.post('/api/auth/register',json={'name':'Alex Example','email':email,'password':'test-password-123'})

    def test_registration_hash_login_and_logout(self):
        self.assertEqual(self.register(self.client).status_code,201)
        user=self.client.get('/api/auth/me').get_json()
        self.assertTrue(user['authenticated'])
        self.assertNotIn('password',str(user))
        with connection(self.path) as db:
            row=db.execute('SELECT password_hash FROM user_account').fetchone()
            self.assertNotEqual(row['password_hash'],'test-password-123')
        bootstrap=self.client.get('/api/bootstrap').get_json()
        self.assertIsNone(bootstrap['appointment'])
        self.assertEqual(bootstrap['medications'],[])
        self.assertEqual(self.client.post('/api/auth/logout',json={}).status_code,200)
        self.assertFalse(self.client.get('/api/auth/me').get_json()['authenticated'])
        self.assertEqual(self.client.post('/api/auth/login',json={'email':'ALEX@EXAMPLE.TEST','password':'wrong'}).status_code,401)
        self.assertEqual(self.client.post('/api/auth/login',json={'email':'ALEX@EXAMPLE.TEST','password':'test-password-123'}).status_code,200)
        self.assertEqual(self.client.get('/login').status_code,302)

    def test_accounts_and_guest_cannot_access_each_others_records(self):
        other=self.app.test_client();guest=self.app.test_client()
        self.register(self.client);self.register(other,'other@example.test')
        result=self.client.post('/api/reminders',json={'label':'Private reminder','due_at':(utc_now()+timedelta(minutes=1)).isoformat()})
        identifier=result.get_json()['id']
        for outsider in [other,guest]:
            self.assertEqual(outsider.get('/api/reminders').get_json()['reminders'],[])
            self.assertEqual(outsider.delete(f'/api/reminders/{identifier}',json={}).status_code,404)
            self.assertEqual(outsider.post(f'/api/reminders/{identifier}/acknowledge',json={}).status_code,404)
        self.client.post('/api/chat',json={'message':'I need a nurse'})
        self.client.post('/api/chat',json={'message':'yes'})
        request_id=self.client.get('/api/assistance').get_json()['requests'][0]['id']
        self.assertEqual(other.get('/api/assistance').get_json()['requests'],[])
        self.assertEqual(other.post(f'/api/assistance/{request_id}/acknowledge',json={}).status_code,404)
        self.assertEqual(len(self.client.get('/api/reminders').get_json()['reminders']),1)

    def test_invalid_registration_duplicate_and_throttling(self):
        self.assertEqual(self.client.post('/api/auth/register',json={'name':'A','email':'bad','password':'short'}).status_code,400)
        self.register(self.client)
        self.assertEqual(self.register(self.client).status_code,409)
        client=self.app.test_client()
        results=[client.post('/api/auth/login',json={'email':'not@example.test','password':'wrong'}).status_code for _ in range(16)]
        self.assertEqual(results[-1],429)

    def test_followup_and_farewell_do_not_create_assistance(self):
        self.client.post('/api/chat',json={'message':'When is my appointment?'})
        follow=self.client.post('/api/chat',json={'message':'What time?'}).get_json()
        self.assertEqual(follow['intent'],'appointment')
        self.client.post('/api/chat',json={'message':'I need a nurse'})
        for phrase in ["I'm done now, thank you.",'I am finished for today thanks',"That's all, thank you!",'Thank you, that is all','Goodbye']:
            reply=self.client.post('/api/chat',json={'message':phrase}).get_json()
            self.assertEqual(reply['action'],'end_conversation',phrase)
        self.client.post('/api/chat',json={'message':'yes'})
        self.assertEqual(self.client.get('/api/assistance').get_json()['requests'],[])
        continuing=self.client.post('/api/chat',json={'message':"I'm not done yet"}).get_json()
        self.assertNotEqual(continuing['action'],'end_conversation')
        self.client.post('/api/chat',json={'message':'I need a nurse'})
        self.assertEqual(self.client.post('/api/chat',json={'message':'Yes, please.'}).get_json()['intent'],'assistance_confirmed')
        self.assertEqual(self.client.post('/api/chat',json={'message':'Hello!'}).get_json()['intent'],'help')

    def test_empty_account_replies_are_honest(self):
        self.register(self.client)
        appointment=self.client.post('/api/chat',json={'message':'When is my appointment?'}).get_json()
        self.assertIn('no saved appointment',appointment['response'])
        medication=self.client.post('/api/chat',json={'message':'Read my medication schedule'}).get_json()
        self.assertIn('no saved medication',medication['response'])

    def test_voice_is_optional_and_key_is_not_exposed(self):
        self.assertEqual(self.client.post('/api/tts',json={'text':'Hello'}).status_code,503)
        self.app.config.update(ELEVENLABS_API_KEY='private-test-key',ELEVENLABS_VOICE_ID='voice123')
        bootstrap=self.client.get('/api/bootstrap').get_json()
        self.assertTrue(bootstrap['voice']['elevenlabs_available'])
        self.assertNotIn('private-test-key',str(bootstrap))
        with patch('app.create_audio',return_value=b'fake-audio'):
            reply=self.client.post('/api/tts',json={'text':'Hello'})
            self.assertEqual(reply.mimetype,'audio/mpeg')
            self.assertEqual(reply.data,b'fake-audio')
        with patch('app.create_audio',side_effect=VoiceUnavailable('Voice unavailable')):
            self.assertEqual(self.client.post('/api/tts',json={'text':'Hello'}).status_code,502)
        self.assertEqual(self.client.post('/api/tts',json={'text':'x'*1601}).status_code,400)

    def test_voice_adapter_uses_server_header_and_expected_model(self):
        response=unittest.mock.MagicMock()
        response.__enter__.return_value=response
        response.headers={'Content-Type':'audio/mpeg'}
        response.read.return_value=b'test-mp3'
        with patch('voice_provider.urlopen',return_value=response) as opener:
            audio=create_audio('Hello','secret-test-key','testvoice')
            sent=opener.call_args.args[0]
            self.assertEqual(sent.get_header('Xi-api-key'),'secret-test-key')
            self.assertIn(b'eleven_flash_v2_5',sent.data)
            self.assertEqual(audio,b'test-mp3')
        with self.assertRaises(VoiceUnavailable):
            create_audio('Hello','key','../invalid')

    def test_new_pages_and_assets(self):
        for path in ['/login','/mobile-design','/patient-overview','/static/patient-overview.js','/static/patient-overview.css','/static/listening-cue.js','/static/listen-cue.wav','/static/fonts/Manrope-Variable.ttf','/static/voice-playback.js','/static/conversation.js']:
            with self.client.get(path) as response:
                self.assertEqual(response.status_code,200,path)

    def test_overview_shows_all_saved_visits_and_scopes_every_record_to_the_account(self):
        guest=self.app.test_client()
        self.register(self.client)
        patient_id=self.client.get('/api/auth/me').get_json()['account']['patient_id']
        with connection(self.path) as db:
            for days in [1, 2]:
                db.execute('INSERT INTO appointment (patient_id,doctor,department,room,starts_at) VALUES (?,?,?,?,?)',
                           (patient_id,'Private doctor '+str(days),'Private clinic','Room 5',(utc_now()+timedelta(days=days)).isoformat()))
            db.execute('INSERT INTO medication (patient_id,name,instruction,time_label) VALUES (?,?,?,?)',
                       (patient_id,'Private saved medicine','Private instruction','9 AM'))
        self.client.post('/api/reminders',json={'label':'Private overview reminder','due_at':(utc_now()+timedelta(minutes=1)).isoformat()})
        self.client.post('/api/chat',json={'message':'I need a nurse'})
        self.client.post('/api/chat',json={'message':'yes'})
        own=self.client.get('/api/patient-overview').get_json()
        self.assertEqual(len(own['appointments']),2)
        self.assertEqual(own['medications'][0]['instruction'],'Private instruction')
        self.assertEqual(own['reminders'][0]['label'],'Private overview reminder')
        self.assertEqual(len(own['requests']),1)
        self.assertEqual(own['patient']['id'],patient_id)
        guest_data=guest.get('/api/patient-overview').get_json()
        self.assertEqual(guest_data['patient']['id'],1)
        self.assertNotIn('Private',str(guest_data))
        own_page=self.client.get('/patient-overview')
        self.assertIn(b'Private doctor 1',own_page.data)
        self.assertIn(b'Private doctor 2',own_page.data)
        self.assertIn('no-store',own_page.headers['Cache-Control'])
        self.assertNotIn(b'Private',guest.get('/patient-overview').data)
        self.assertIn(b'href="/patient-overview"',self.client.get('/').data)


if __name__=='__main__':
    unittest.main(verbosity=2)
