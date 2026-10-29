from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from app import create_app
from spoken_reminders import parse_duration


class SpokenReminderTest(unittest.TestCase):
    def setUp(self):
        self.temp=TemporaryDirectory()
        self.app=create_app({'TESTING':True,'DATABASE':str(Path(self.temp.name)/'voice.db'),'SECRET_KEY':'test-only'})
        self.client=self.app.test_client()

    def tearDown(self):
        self.temp.cleanup()

    def say(self,text):
        return self.client.post('/api/chat',json={'message':text}).get_json()

    def test_reminder_is_created_using_only_spoken_turns_and_confirmation(self):
        self.assertIn('What should I remind',self.say('Set a reminder')['response'])
        self.assertIn('When should I remind',self.say('Bring appointment documents')['response'])
        self.assertIn('Say yes to save',self.say('In two minutes')['response'])
        self.assertEqual(self.client.get('/api/reminders').get_json()['reminders'],[])
        self.assertEqual(self.say('Yes, please')['intent'],'reminder_created')
        self.say('yes')
        rows=self.client.get('/api/reminders').get_json()['reminders']
        self.assertEqual(len(rows),1)
        self.assertEqual(rows[0]['label'],'bring appointment documents')

    def test_one_sentence_request_and_cancellation(self):
        result=self.say('Remind me in one minute to check my documents')
        self.assertIn('Say yes to save',result['response'])
        self.assertIn('not saved',self.say('No')['response'])
        self.say('yes')
        self.assertEqual(self.client.get('/api/reminders').get_json()['reminders'],[])

    def test_done_thank_you_cancels_pending_reminder_and_ends(self):
        self.say('Set a reminder')
        for phrase in ['Done, thank you.','done','Finished, thanks']:
            self.assertEqual(self.say(phrase)['action'],'end_conversation')
        self.say('yes')
        self.assertEqual(self.client.get('/api/reminders').get_json()['reminders'],[])

    def test_minimal_homepage_and_spoken_guidance(self):
        html=self.client.get('/').get_data(as_text=True)
        self.assertIn('class="central-microphone"',html)
        self.assertIn('aria-label="Start CareVoice.',html)
        self.assertNotIn('question-form',html)
        self.assertNotIn('question-input',html)
        self.assertNotIn('data-question',html)
        self.assertNotIn('reminder-form',html)
        self.assertIn('centre of your screen',self.client.get('/api/bootstrap').get_json()['guidance'])
        self.assertIn('tone',self.say('help')['response'])


class DurationTest(unittest.TestCase):
    def test_duration_understanding_and_bounds(self):
        for text,expected in [('in one minute',60),('two hours',7200),('twenty five minutes',1500),('10 seconds',10),('an hour',3600)]:
            self.assertEqual(parse_duration(text),expected,text)
        for text in ['zero minutes','minus one minute','25 hours','1.5 minutes','yesterday','tomorrow','5 minutes and cancel']:
            self.assertIsNone(parse_duration(text),text)
