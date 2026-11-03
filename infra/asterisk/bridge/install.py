#!/usr/bin/env python3
"""Run as root from this directory. Does not restart Asterisk or replace credentials."""
import getpass
import os
from pathlib import Path
import re
import shutil
import subprocess
import tarfile
from datetime import datetime

ROOT = Path(__file__).resolve().parent
CONF = Path('/etc/asterisk')


def run(command):
    return subprocess.run(command, capture_output=True, text=True, check=True, timeout=30).stdout


def ast(command):
    return run(['/usr/sbin/asterisk', '-rx', command])


def main():
    if os.geteuid() != 0:
        raise SystemExit('Run as root')
    if Path('/etc/plw-bridge.env').exists():
        raise SystemExit('Bridge already installed. Keep the existing token; use the upgrade instructions.')
    queue = (CONF / 'queues.conf').read_text()
    agents = (CONF / 'pjsip_agents.conf').read_text()
    if '[plw-inbound]' not in queue or 'Queue(plw-inbound,' not in (CONF / 'extensions.conf').read_text():
        raise SystemExit('Expected working plw-inbound queue route is missing; nothing changed.')
    names = re.findall(r'^member\s*=>\s*PJSIP/(agent-[0-9]+)\s*$', queue, re.M)
    if len(names) != 3 or len(set(names)) != 3:
        raise SystemExit('Expected exactly three simple PJSIP queue members; nothing changed.')
    for name in names:
        if f'[{name}]' not in agents:
            raise SystemExit('Missing agent endpoint')
    for name in ['cdr.conf', 'cdr_custom.conf']:
        if (CONF / name).exists():
            raise SystemExit(f'{name} already exists. Review and merge logging settings before installation; nothing changed.')
    if 'Registered' not in ast('pjsip show registrations'):
        raise SystemExit('Vocex is not registered; nothing changed.')
    project = input('Supabase project ref: ').strip()
    if not re.fullmatch('[a-z0-9]{20}', project):
        raise SystemExit('Invalid project ref')
    token = getpass.getpass('ASTERISK_BRIDGE_TOKEN (hidden; same value as Supabase secret): ').strip()
    if not re.fullmatch('[a-f0-9]{64}', token):
        raise SystemExit('Expected a 64-character lowercase hex token')
    backup = Path('/root') / ('plw-before-bridge-' + datetime.now().strftime('%Y%m%d-%H%M%S') + '.tar.gz')
    with backup.open('xb') as handle:
        os.chmod(backup, 0o600)
        with tarfile.open(fileobj=handle, mode='w:gz') as tar:
            tar.add(CONF, arcname='asterisk', filter=lambda item: None if item.name.startswith('asterisk/keys') else item)
    print('Backup:', backup, flush=True)
    try:
        for name in names:
            queue = re.sub(r'^member\s*=>\s*PJSIP/' + re.escape(name) + r'\s*$',
                           f'member => PJSIP/{name},0,{name},PJSIP/{name},no,10,yes', queue, flags=re.M)
        (CONF / 'queues.conf').write_text(queue)
        agents = agents.replace('context=from-agents', 'context=from-agents\ndevice_state_busy_at=1')
        (CONF / 'pjsip_agents.conf').write_text(agents)
        (CONF / 'cdr.conf').write_text('[general]\nenable=yes\nunanswered=yes\ncongestion=yes\nendbeforehexten=yes\n')
        fields = ['uniqueid', 'linkedid', 'channel', 'dstchannel', 'src', 'dst', 'dcontext', 'disposition', 'billsec', 'start,u', 'end,u', 'sequence']
        mapping = ','.join('${CSV_QUOTE(${CDR(' + field + ')})}' for field in fields)
        (CONF / 'cdr_custom.conf').write_text('[mappings]\nplw.csv => ' + mapping + '\n')
        for name in ['queues.conf', 'pjsip_agents.conf', 'cdr.conf', 'cdr_custom.conf']:
            shutil.chown(CONF / name, 'asterisk', 'asterisk')
            os.chmod(CONF / name, 0o640)
        logdir = Path('/var/log/asterisk/cdr-custom')
        logdir.mkdir(exist_ok=True)
        shutil.chown(logdir, 'asterisk', 'asterisk')
        os.chmod(logdir, 0o750)
        target = Path('/opt/plw-bridge')
        target.mkdir(mode=0o700, exist_ok=True)
        shutil.copy2(ROOT / 'worker.py', target / 'worker.py')
        env = Path('/etc/plw-bridge.env')
        with env.open('x') as handle:
            os.chmod(env, 0o600)
            handle.write(f'PLW_BRIDGE_URL=https://{project}.supabase.co/functions/v1/asterisk-bridge\nPLW_BRIDGE_TOKEN={token}\n')
        # Guard the already-installed helper as well as the repository copy.
        helper = Path('/usr/local/sbin/plw-agents')
        if helper.exists():
            original = helper.read_text()
            if 'PLW_QUEUE_BRIDGE_GUARD' not in original:
                guard = '''# PLW_QUEUE_BRIDGE_GUARD
if [[ ${1:-} == setup && -f /etc/plw-bridge.env ]]; then
  echo 'Queue bridge installed: setup would overwrite routing. Use the bridge runbook.' >&2
  exit 1
fi
'''
                first, rest = original.split('\n', 1)
                helper.write_text(first + '\n' + guard + rest)
                os.chmod(helper, 0o700)
        shutil.copy2(ROOT / 'plw-bridge.service', '/etc/systemd/system/plw-bridge.service')
        shutil.copy2(ROOT / 'plw-bridge.logrotate', '/etc/logrotate.d/plw-bridge')
        # Dependencies may already be loaded. Verify actual module state, not CLI exit code.
        for module in ['func_cdr', 'func_strings', 'cdr_custom']:
            ast(f'module load {module}.so')
            state = ast(f'module show like {module}')
            if module + '.so' not in state or 'Running' not in state or 'Not Running' in state:
                raise RuntimeError('Required CDR module did not start: ' + module)
        ast('module reload cdr_custom.so')
        ast('module reload cdr')
        ast('module reload res_pjsip.so')
        ast('module reload app_queue.so')
        if 'Registered' not in ast('pjsip show registrations'):
            raise RuntimeError('Vocex check failed')
        run(['systemctl', 'daemon-reload'])
        run(['systemctl', 'enable', '--now', 'plw-bridge'])
        run(['systemctl', 'is-active', '--quiet', 'plw-bridge'])
        print('Installed. Check queue state after 10 seconds and complete the live validation runbook.')
    except Exception:
        subprocess.run(['systemctl', 'disable', '--now', 'plw-bridge'], capture_output=True)
        with tarfile.open(backup) as tar:
            tar.extractall('/etc', filter='data')
        for name in ['cdr.conf', 'cdr_custom.conf']:
            (CONF / name).unlink(missing_ok=True)
        Path('/etc/plw-bridge.env').unlink(missing_ok=True)
        for command in ['module reload res_pjsip.so', 'module reload app_queue.so', 'module reload cdr']:
            ast(command)
        print('Installation failed; Asterisk configuration restored from', backup)
        raise


if __name__ == '__main__':
    main()
