#!/usr/bin/env python3
"""Outbound-only queue synchronizer and durable CDR uploader (Python stdlib)."""
import csv
import io
import json
import os
import re
import sqlite3
import subprocess
import sys
import time
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

AGENT = re.compile(r'^agent-[0-9]+$')
QUEUE = 'plw-inbound'
STATE = Path('/var/lib/plw-bridge')
CDR = Path('/var/log/asterisk/cdr-custom/plw.csv')


def cli(command):
    result = subprocess.run(['/usr/sbin/asterisk', '-rx', command], capture_output=True, text=True, timeout=8, check=True)
    return result.stdout


def members():
    text = cli('queue show ' + QUEUE)
    if 'No such command' in text or 'No such queue' in text or QUEUE + ' has ' not in text:
        raise RuntimeError('Queue unavailable')
    return {match.group(1): '(paused' in line for line in text.splitlines()
            if (match := re.search(r'PJSIP/(agent-[0-9]+)(?=[\s)])', line))}


def set_paused(agent, paused):
    if not AGENT.fullmatch(agent):
        raise ValueError('Invalid agent')
    verb = 'pause' if paused else 'unpause'
    response = cli(f'queue {verb} member PJSIP/{agent} queue {QUEUE}')
    if ('paused interface' if paused else 'unpaused interface') not in response:
        raise RuntimeError('Queue update rejected')


def pause_all():
    for agent in members():
        set_paused(agent, True)


def request(body):
    url = os.environ['PLW_BRIDGE_URL']
    if not re.fullmatch(r'https://[a-z0-9]+\.supabase\.co/functions/v1/asterisk-bridge', url):
        raise ValueError('Invalid bridge URL')
    token = os.environ['PLW_BRIDGE_TOKEN']
    if not re.fullmatch(r'[a-f0-9]{64}', token):
        raise ValueError('Invalid bridge token')
    req = urllib.request.Request(url, data=json.dumps(body).encode(), headers={
        'Content-Type': 'application/json', 'X-PLW-Bridge-Token': token,
    })
    with urllib.request.urlopen(req, timeout=6) as response:
        return json.load(response)


def eligibility(body):
    rows = body['agents']
    if not isinstance(rows, list):
        raise ValueError('Invalid eligibility')
    result = {}
    for row in rows:
        name = row['username']
        if not AGENT.fullmatch(name) or type(row['available']) is not bool or name in result:
            raise ValueError('Invalid eligibility')
        result[name] = row['available']
    return result


def parse_cdr(row):
    # Custom CDR order defined by install.sh. Only the originating leg is counted.
    if len(row) != 12:
        raise ValueError('Invalid CDR columns')
    uid, linked, channel, peer, source, dest, context, disposition, seconds, start, end, sequence = row
    inbound = context == 'from-vocex' and channel.startswith('PJSIP/vocex-')
    outbound = context == 'from-agents' and channel.startswith('PJSIP/agent-')
    if not inbound and not outbound:
        return None
    endpoint = peer if inbound else channel
    match = re.match(r'^PJSIP/(agent-[0-9]+)-', endpoint)
    # UNANSWERED inbound calls belong to the queue, never blame the last attempted agent.
    agent = match.group(1) if match and (outbound or disposition == 'ANSWERED') else None
    number = source if inbound else dest
    if not re.fullmatch(r'[+0-9]{0,20}', number):
        number = ''
    stamp = lambda value: datetime.fromtimestamp(float(value), timezone.utc).isoformat()
    return dict(unique_id=uid + "." + sequence, linked_id=linked or uid, sip_username=agent,
                direction='inbound' if inbound else 'outbound', number=number,
                disposition=disposition, talk_seconds=int(seconds),
                started_at=stamp(start), ended_at=stamp(end))


def collect(db):
    """Spool before advancing the cursor. Retain offsets by inode across renames."""
    # Inspect rotated files too so a restart after logrotate doesn't discard records.
    for path in sorted(CDR.parent.glob('plw.csv*')):
        if not path.is_file() or path.suffix == '.gz':
            continue
        stat = path.stat()
        identity = f'{stat.st_dev}:{stat.st_ino}'
        cursor = db.execute('SELECT offset FROM cursors WHERE identity=?', (identity,)).fetchone()
        offset = cursor[0] if cursor and cursor[0] <= stat.st_size else 0
        with path.open('rb') as stream:
            stream.seek(offset)
            for _ in range(1000):
                line = stream.readline()
                if not line or not line.endswith(b'\n'):
                    break
                call = parse_cdr(next(csv.reader(io.StringIO(line.decode()))))
                with db:
                    if call:
                        db.execute('INSERT OR IGNORE INTO outbox VALUES (?,?)', (call['unique_id'], json.dumps(call)))
                    db.execute('INSERT OR REPLACE INTO cursors VALUES (?,?)', (identity, stream.tell()))


def upload(db):
    rows = db.execute('SELECT id, payload FROM outbox LIMIT 100').fetchall()
    if not rows:
        return
    response = request({'action': 'calls', 'calls': [json.loads(row[1]) for row in rows]})
    if response.get('accepted') != len(rows):
        raise RuntimeError('Call batch not acknowledged')
    with db:
        db.executemany('DELETE FROM outbox WHERE id=?', [(row[0],) for row in rows])


def main():
    if '--pause-all' in sys.argv:
        pause_all()
        return
    STATE.mkdir(mode=0o700, parents=True, exist_ok=True)
    db = sqlite3.connect(STATE / 'outbox.sqlite3')
    db.executescript('CREATE TABLE IF NOT EXISTS outbox(id TEXT PRIMARY KEY,payload TEXT NOT NULL);'
                     'CREATE TABLE IF NOT EXISTS cursors(identity TEXT PRIMARY KEY,offset INTEGER NOT NULL);')
    pause_all()
    while True:
        try:
            allowed = eligibility(request({'action': 'eligibility'}))
            for agent, paused in members().items():
                desired = not allowed.get(agent, False)
                if paused != desired:
                    set_paused(agent, desired)
        except Exception:
            # Fail closed; pausing queue membership does not terminate ongoing calls.
            print('Queue sync failed; pausing members', flush=True)
            try:
                pause_all()
            except Exception:
                raise RuntimeError('Cannot pause members') from None
        try:
            collect(db)
            upload(db)
        except Exception:
            print('Call records pending; will retry', flush=True)
        time.sleep(5)


if __name__ == '__main__':
    main()
