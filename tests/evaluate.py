"""Independent phrasing smoke evaluation, not a clinical or broad AI benchmark."""
import json
from pathlib import Path
import statistics
import sys
import time

sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from assistant import RequestMatcher

CASES = [
    ('Tell me when my doctor appointment is scheduled','appointment'),
    ('Can you tell me the date of my appointment','appointment'),
    ('Please read the medicines in my saved schedule','medications'),
    ('Show my medication instructions','medications'),
    ('At what time may relatives visit me','visiting'),
    ('Tell me the hospital visiting hours please','visiting'),
    ('I want to find the registration desk','registration'),
    ('Where should I check in at the hospital','registration'),
    ('Can you tell me the location of the pharmacy','pharmacy'),
    ('I am looking for the hospital pharmacy','pharmacy'),
    ('Tell me where cardiology is located','departments'),
    ('Show the departments at this hospital','departments'),
    ('Could you show the reminders I have saved','reminders'),
    ('I want to create a new reminder','reminders'),
    ('Could a nurse come and assist me','assistance'),
    ('Please request assistance from a staff member','assistance'),
    ('Who won the cricket match yesterday','unknown'),
    ('Write me a poem about the moon','unknown'),
    ('What is the capital of France','unknown'),
    ('How do I repair a bicycle','unknown'),
]

if __name__ == '__main__':
    matcher=RequestMatcher(); results=[]; durations=[]
    for text, expected in CASES:
        start=time.perf_counter(); intent,score=matcher.match(text); durations.append((time.perf_counter()-start)*1000)
        results.append({'question':text,'expected':expected,'actual':intent,'similarity':score,'passed':intent==expected})
    supported=[r for r in results if r['expected']!='unknown']; unknown=[r for r in results if r['expected']=='unknown']
    report={'supported_correct':sum(r['passed'] for r in supported),'supported_total':len(supported),
            'unknown_rejected':sum(r['passed'] for r in unknown),'unknown_total':len(unknown),
            'median_matching_ms':round(statistics.median(durations),3),'cases':results,
            'limitations':'Small developer-authored smoke set. No audio, clinical validation, or target-user study. Includes first-call overhead. Matching scores are not probabilities.'}
    destination=Path(__file__).resolve().parents[1]/'test-results'
    destination.mkdir(exist_ok=True)
    (destination/'evaluation.json').write_text(json.dumps(report,indent=2),encoding='utf-8')
    print(json.dumps(report,indent=2))
