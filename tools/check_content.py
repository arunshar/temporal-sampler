#!/usr/bin/env python3
"""Check the public package's numeric integrity, references and privacy boundary."""
from pathlib import Path
from html.parser import HTMLParser
from urllib.parse import urlsplit, unquote
import hashlib, json, re, statistics

ROOT = Path(__file__).resolve().parents[1]
class Page(HTMLParser):
 def __init__(self):
  super().__init__(); self.ids=[]; self.links=[]; self.skip=0; self.prose=[]
 def handle_starttag(self, tag, attrs):
  attrs=dict(attrs)
  if tag in {'script','style','pre','code'}:self.skip+=1
  if attrs.get('id'):self.ids.append(attrs['id'])
  for key in ('href','src'):
   if attrs.get(key):self.links.append(attrs[key])
 def handle_endtag(self, tag):
  if tag in {'script','style','pre','code'}:self.skip=max(0,self.skip-1)
 def handle_data(self,data):
  if not self.skip:self.prose.append(data)

page=Page();page.feed((ROOT/'index.html').read_text())
assert len(page.ids)==len(set(page.ids)), 'Duplicate HTML id'
for link in page.links:
 u=urlsplit(link)
 if u.scheme or u.netloc:continue
 if not u.path:
  assert not u.fragment or unquote(u.fragment) in page.ids, 'Missing anchor '+link
 else:
  p=(ROOT/unquote(u.path)).resolve()
  assert p.is_relative_to(ROOT) and p.is_file(), 'Missing local target '+link
prose=' '.join(page.prose)
assert '\u2014' not in prose and ';' not in prose, 'Prose punctuation rail'
for text in ['Mac CPU, demo-scale model, five runs per scenario','consistent with','UNVERIFIED','ensemble mean only','mocked test','one code transition and one saved history']:
 assert text in prose, 'Missing evidence caveat '+text
r=json.loads((ROOT/'evidence/results.json').read_text())
assert len(r['groups'])==8 and len(r['runs'])==40
for g in r['groups']:
 runs=[x for x in r['runs'] if x['scenario']==g['key']]
 assert len(runs)==5
 assert format(statistics.median(x['total_seconds'] for x in runs),'.3f')==g['total'], g['key']+' median'
 expected=f"{min(x['total_seconds'] for x in runs):.3f} to {max(x['total_seconds'] for x in runs):.3f}"
 assert expected==g['range'],g['key']+' range'
 assert all(x['infer_attempts']==g['attempts'] and x['sample_count']==g['samples'] for x in runs)
 if g['interval'] and g['interval']!='UNVERIFIED':
  assert format(statistics.median(x['failure_to_next_attempt_s'] for x in runs),'.3f')==g['interval']
 if g['key']=='f2':assert g['interval']=='UNVERIFIED' and all(x['failure_to_next_attempt_s'] is None for x in runs)
kill=[x for x in r['runs'] if x['scenario'] in ('f1-hb','f1-nohb','f6')]
assert len(kill)==15 and all(x['sample_count']==2 for x in kill)
for e in json.loads((ROOT/'code/source-manifest.json').read_text()):
 p=ROOT/'code'/(e['name']+'.go.txt')
 assert hashlib.sha256(p.read_bytes()).hexdigest()==e['sha256'], 'Changed pinned excerpt '+e['name']
private=[r'/Users/[^/\s]+',r'aruns-macbook',r'-----BEGIN [A-Z ]*PRIVATE KEY-----',r'gh[pousr]_[A-Za-z0-9]{25,}',r'github_pat_[A-Za-z0-9_]{30,}']
scanned=0
for p in ROOT.rglob('*'):
 if not p.is_file() or '__pycache__' in p.parts:continue
 if p.suffix in {'.json','.js','.html','.css','.md','.txt','.csv','.cjs','.yml','.yaml'}:
  text=p.read_text()
  for pattern in private:
   assert not re.search(pattern,text,re.I), 'Private material in '+str(p.relative_to(ROOT))
  scanned+=1
assert not list(ROOT.rglob('*.env')), 'Unexpected environment file'
assert not (ROOT/'.git').exists(), 'The public package must not contain another repository history'
print(f'CONTENT_CHECK: PASS ({len(r["runs"])} recorded runs, {len(page.links)} references, {scanned} text files)')
