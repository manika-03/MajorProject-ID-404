"""Integration checks of persistence, boundaries, confirmation, and failure recovery."""
import json
from datetime import timedelta
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch

from app import create_app
from database import connection, utc_now


class CareVoiceTest(unittest.TestCase):
    def setUp(self):
        self.temp = TemporaryDirectory()
        self.path = str(Path(self.temp.name) / 'test.db')
        self.app = create_app({'TESTING':True, 'DATABASE':self.path, 'SECRET_KEY':'test-only'})
        self.client = self.app.test_client()

    def tearDown(self):
        self.temp.cleanup()

    def ask(self, text):
        return self.client.post('/api/chat', json={'message':text})

    def test_pages_and_seed_data(self):
        for path in ['/', '/staff', '/static/styles.css', '/static/app.js', '/static/care-illustration.svg']:
            with self.client.get(path) as response:
                self.assertEqual(response.status_code,200)
        data = self.client.get('/api/bootstrap').get_json()
        self.assertEqual(data['patient']['code'],'CV-DEMO-001')
        self.assertEqual(len(data['departments']),4)

    def test_information_and_repeat(self):
        reply = self.ask('What time am I seeing the doctor?').get_json()
        self.assertEqual(reply['intent'],'appointment')
        self.assertIn('Dr. Aditi Sharma',reply['response'])
        self.assertEqual(self.ask('repeat').get_json()['response'],reply['response'])

    def test_unknown_and_clinical_boundary(self):
        self.assertEqual(self.ask('What is the weather in Paris?').get_json()['intent'],'unknown')
        self.assertEqual(self.ask('What medicine should I take for a fever?').get_json()['intent'],'clinical_boundary')
        self.assertEqual(self.ask('Should I double my dose?').get_json()['intent'],'clinical_boundary')

    def test_assistance_requires_confirmation_and_does_not_duplicate(self):
        first = self.ask('Please call a nurse').get_json()
        self.assertEqual(first['intent'],'assistance')
        self.assertEqual(self.client.get('/api/assistance').get_json()['requests'],[])
        self.ask('yes')
        self.ask('yes')
        rows = self.client.get('/api/assistance').get_json()['requests']
        self.assertEqual(len(rows),1)
        self.assertIsNone(rows[0]['acknowledged_at'])
        result = self.client.post(f"/api/assistance/{rows[0]['id']}/acknowledge",json={})
        self.assertEqual(result.status_code,200)
        self.assertIsNotNone(self.client.get('/api/assistance').get_json()['requests'][0]['acknowledged_at'])

    def test_cancellation_and_expired_confirmation(self):
        self.ask('I need a nurse')
        self.ask('no')
        self.ask('yes')
        self.ask("Don't call a nurse")
        with self.client.session_transaction() as state:
            state['pending_assistance'] = 1
        self.ask('yes')
        self.assertEqual(self.client.get('/api/assistance').get_json()['requests'],[])

    def test_reminder_due_state_and_persistence(self):
        future = (utc_now()+timedelta(minutes=1)).isoformat()
        result = self.client.post('/api/reminders',json={'label':'Bring documents','due_at':future})
        self.assertEqual(result.status_code,201)
        identifier = result.get_json()['id']
        self.assertFalse(self.client.get('/api/reminders').get_json()['reminders'][0]['due'])
        self.assertEqual(self.client.post(f'/api/reminders/{identifier}/acknowledge',json={}).status_code,409)
        with connection(self.path) as db:
            db.execute('UPDATE reminder SET due_at = ? WHERE id = ?',((utc_now()-timedelta(seconds=1)).isoformat(),identifier))
        restarted = create_app({'TESTING':True,'DATABASE':self.path}).test_client()
        self.assertTrue(restarted.get('/api/reminders').get_json()['reminders'][0]['due'])
        self.assertEqual(self.client.post(f'/api/reminders/{identifier}/acknowledge',json={}).status_code,200)
        row = self.client.get('/api/reminders').get_json()['reminders'][0]
        self.assertFalse(row['due'])
        self.assertIsNotNone(row['acknowledged_at'])
        self.assertEqual(self.client.delete(f'/api/reminders/{identifier}',json={}).status_code,200)

    def test_invalid_requests(self):
        for message in ['', 'x'*501, 123, None]:
            self.assertEqual(self.client.post('/api/chat',json={'message':message}).status_code,400)
        for due in ['not-a-date','2020-01-01T12:00:00Z','2030-01-01T00:00:00',None]:
            self.assertEqual(self.client.post('/api/reminders',json={'label':'test','due_at':due}).status_code,400)
        self.assertEqual(self.client.post('/api/chat',data='not json').status_code,415)
        self.assertEqual(self.client.delete('/api/reminders/999',json={}).status_code,404)
        self.assertEqual(self.client.post('/api/reminders',json={'label':'','due_at':(utc_now()+timedelta(minutes=2)).isoformat()}).status_code,400)

    def test_cross_origin_changes_rejected(self):
        self.assertEqual(self.client.post('/api/chat',json={'message':'hello'},headers={'Origin':'https://unrelated.example'}).status_code,403)

    def test_failed_database_save_never_claims_success(self):
        self.ask('I need a nurse')
        import sqlite3
        with self.assertLogs(self.app.logger,level='ERROR'):
            with patch('app.connection',side_effect=sqlite3.OperationalError('simulated failure')):
                result = self.ask('yes')
        self.assertEqual(result.status_code,503)
        self.assertIn('could not be confirmed',result.get_json()['error'])
        self.assertEqual(self.client.get('/api/assistance').get_json()['requests'],[])


if __name__ == '__main__':
    unittest.main(verbosity=2)
