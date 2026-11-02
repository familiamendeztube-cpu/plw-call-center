import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SCRIPT = new URL('../../infra/asterisk/plw-agents.sh', import.meta.url);
const hasBash =
  spawnSync('bash', ['-c', 'tar --version && sed --version && openssl version'], {
    stdio: 'ignore',
  }).status === 0;

// The Vocex part of the installer's pjsip.conf, with a stand-in password.
const TRUNK_CONF = `[transport-udp]
type=transport
protocol=udp
bind=0.0.0.0:5060

[transport-wss]
type=transport
protocol=wss
bind=0.0.0.0

[vocex]
type=registration
transport=transport-udp
outbound_auth=vocex
server_uri=sip:sip.vocex.net
client_uri=sip:10000000@sip.vocex.net
contact_user=10000000
retry_interval=60
max_retries=100000

[vocex]
type=auth
auth_type=userpass
username=10000000
password=trunk-password-stand-in

[vocex]
type=aor
contact=sip:sip.vocex.net:5060

[vocex]
type=endpoint
transport=transport-udp
context=from-vocex
disallow=all
allow=alaw,ulaw
outbound_auth=vocex
aors=vocex
from_user=10000000
from_domain=sip.vocex.net
direct_media=no

[vocex]
type=identify
endpoint=vocex
match=sip.vocex.net
`;

const ECHO_DIALPLAN = `[from-vocex]
exten => s,1,Echo()
`;

// Runs the real functions with the server's tools replaced by stand-ins.
const HARNESS = `
source ./plw-agents.sh
check_root() { :; }
chown() { :; }
sleep() { :; }
asterisk() {
  case $2 in
    'pjsip show registrations')
      if [[ -f trunk-down || ( -f trunk-drops-on-reload && -f reloaded ) ]]; then
        echo 'vocex/sip:sip.vocex.net  vocex  Rejected'
      else
        echo 'vocex/sip:sip.vocex.net  vocex  Registered'
      fi ;;
    'module show like '*) [[ -f module-missing ]] || echo "\${2##* }.so  Running" ;;
    'pjsip show endpoint vocex') echo ' identify_by : ip' ;;
    'pjsip show endpoint '*) echo " Endpoint:  \${2##* }  Not in use" ;;
    'dialplan show from-agents') grep XXXXXXX conf/extensions.conf ;;
    'module reload res_pjsip.so') touch reloaded ;;
  esac
}
"$@"
`;

function createServer() {
  const dir = mkdtempSync(join(tmpdir(), 'plw-agents-'));
  mkdirSync(join(dir, 'conf'));
  cpSync(SCRIPT, join(dir, 'plw-agents.sh'));
  writeFileSync(join(dir, 'harness.sh'), HARNESS);
  writeFileSync(join(dir, 'conf/pjsip.conf'), TRUNK_CONF);
  writeFileSync(join(dir, 'conf/extensions.conf'), ECHO_DIALPLAN);

  return {
    dir,
    read: (name) => readFileSync(join(dir, 'conf', name), 'utf8'),
    flag: (name) => writeFileSync(join(dir, name), ''),
    backups: () => readdirSync(dir).filter((name) => name.startsWith('asterisk-backup-')),
    run(...args) {
      const result = spawnSync('bash', ['harness.sh', ...args], {
        cwd: dir,
        encoding: 'utf8',
        env: { ...process.env, PLW_CONF_DIR: 'conf', PLW_BACKUP_DIR: '.' },
      });
      return { ...result, output: result.stdout + result.stderr };
    },
    remove: () => rmSync(dir, { recursive: true, force: true }),
  };
}

function passwordOf(agentsConf, agent) {
  return new RegExp(`^username=${agent}\\npassword=(.+)$`, 'm').exec(agentsConf)?.[1];
}

function serverTest(name, run) {
  test(name, { skip: hasBash ? false : 'bash with tar, sed and openssl is not available' }, () => {
    const server = createServer();
    try {
      run(server);
    } finally {
      server.remove();
    }
  });
}

serverTest('setup adds logins and leaves the Vocex settings untouched except for identify_by', (server) => {
  const result = server.run('setup_agents', 'agent-1', 'agent-2');

  assert.equal(result.status, 0, result.output);
  const pjsip = server.read('pjsip.conf');
  const withoutAddedLines = pjsip
    .replace('identify_by=ip\n', '')
    .replace('\n#include pjsip_agents.conf\n', '');
  assert.equal(withoutAddedLines, TRUNK_CONF);
  assert.match(pjsip, /context=from-vocex\nidentify_by=ip\n/);
  assert.equal(server.backups().length, 1);
});

serverTest('each agent gets a separate password and none reach the output', (server) => {
  const result = server.run('setup_agents', 'agent-1', 'agent-2');

  const agents = server.read('pjsip_agents.conf');
  const first = passwordOf(agents, 'agent-1');
  const second = passwordOf(agents, 'agent-2');
  assert.match(first, /^[0-9a-f]{32}$/);
  assert.match(second, /^[0-9a-f]{32}$/);
  assert.notEqual(first, second);
  assert.ok(!result.output.includes(first));
  assert.ok(!result.output.includes(second));
  assert.ok(!agents.includes('trunk-password-stand-in'));
});

serverTest('agent logins are WebRTC, need a password and use the restricted context', (server) => {
  server.run('setup_agents', 'agent-1');

  const agents = server.read('pjsip_agents.conf');
  for (const line of [
    'webrtc=yes',
    'auth=agent-1',
    'context=from-agents',
    'allow=alaw,ulaw',
    'direct_media=no',
    'rtp_timeout=30',
    'allow_transfer=no',
    'max_contacts=1',
  ]) {
    assert.ok(agents.split('\n').includes(line), line);
  }
});

serverTest('incoming calls ring only the first agent and cannot reach outbound dialing', (server) => {
  server.run('setup_agents', 'agent-3', 'agent-1');

  const dialplan = server.read('extensions.conf');
  assert.match(dialplan, /^INBOUND_AGENT=agent-3$/m);
  const inbound = dialplan.slice(dialplan.indexOf('[from-vocex]'), dialplan.indexOf('[from-agents]'));
  assert.ok(!inbound.includes('@vocex'));
  assert.ok(!inbound.includes('from-agents'));
  assert.match(inbound, /Dial\(PJSIP\/\$\{INBOUND_AGENT\},\$\{RING_SECONDS\}\)/);
});

serverTest('running setup again keeps passwords and adds nothing twice', (server) => {
  server.run('setup_agents', 'agent-1');
  const before = server.read('pjsip_agents.conf');

  server.run('setup_agents', 'agent-1');

  assert.equal(server.read('pjsip_agents.conf'), before);
  const pjsip = server.read('pjsip.conf');
  assert.equal(pjsip.match(/#include pjsip_agents\.conf/g).length, 1);
  assert.equal(pjsip.match(/identify_by=ip/g).length, 1);
});

serverTest('a later agent is added without changing the first password', (server) => {
  server.run('setup_agents', 'agent-1');
  const first = passwordOf(server.read('pjsip_agents.conf'), 'agent-1');

  server.run('setup_agents', 'agent-1', 'agent-2');

  const agents = server.read('pjsip_agents.conf');
  assert.equal(passwordOf(agents, 'agent-1'), first);
  assert.ok(passwordOf(agents, 'agent-2'));
});

serverTest('nothing changes when the Vocex line is down before the change', (server) => {
  server.flag('trunk-down');

  const result = server.run('setup_agents', 'agent-1');

  assert.notEqual(result.status, 0);
  assert.match(result.output, /Nothing was changed/);
  assert.equal(server.read('pjsip.conf'), TRUNK_CONF);
  assert.equal(server.read('extensions.conf'), ECHO_DIALPLAN);
  assert.deepEqual(server.backups(), []);
});

serverTest('nothing changes when a browser module is missing', (server) => {
  server.flag('module-missing');

  const result = server.run('setup_agents', 'agent-1');

  assert.notEqual(result.status, 0);
  assert.match(result.output, /Nothing was changed/);
  assert.equal(server.read('pjsip.conf'), TRUNK_CONF);
});

serverTest('the backup goes back by itself if Vocex drops after the change', (server) => {
  server.flag('trunk-drops-on-reload');

  const result = server.run('setup_agents', 'agent-1');

  assert.notEqual(result.status, 0);
  assert.match(result.output, /backup was put back/);
  assert.equal(server.read('pjsip.conf'), TRUNK_CONF);
  assert.equal(server.read('extensions.conf'), ECHO_DIALPLAN);
  assert.ok(!existsSync(join(server.dir, 'conf/pjsip_agents.conf')));
});

serverTest('rollback removes everything setup added', (server) => {
  server.run('setup_agents', 'agent-1');

  const result = server.run('rollback', server.backups()[0]);

  assert.equal(result.status, 0, result.output);
  assert.equal(server.read('pjsip.conf'), TRUNK_CONF);
  assert.equal(server.read('extensions.conf'), ECHO_DIALPLAN);
  assert.ok(!existsSync(join(server.dir, 'conf/pjsip_agents.conf')));
});

serverTest('rotate replaces one password and keeps the other', (server) => {
  server.run('setup_agents', 'agent-1', 'agent-2');
  const before = server.read('pjsip_agents.conf');

  const result = server.run('rotate_password', 'agent-1');

  const after = server.read('pjsip_agents.conf');
  assert.equal(result.status, 0, result.output);
  assert.notEqual(passwordOf(after, 'agent-1'), passwordOf(before, 'agent-1'));
  assert.equal(passwordOf(after, 'agent-2'), passwordOf(before, 'agent-2'));
  assert.ok(!result.output.includes(passwordOf(after, 'agent-1')));
});

serverTest('the password command gives one agent password to a pipe and nothing else', (server) => {
  server.run('setup_agents', 'agent-1', 'agent-2');

  const result = server.run('show_password', 'agent-1');

  assert.equal(result.stdout, passwordOf(server.read('pjsip_agents.conf'), 'agent-1'));
});

serverTest('unknown or malformed agent names are refused', (server) => {
  server.run('setup_agents', 'agent-1');

  assert.notEqual(server.run('show_password', 'agent-9').status, 0);
  assert.notEqual(server.run('show_password', 'vocex').status, 0);
  assert.notEqual(server.run('setup_agents', 'agent-1;rm').status, 0);
  assert.notEqual(server.run('rotate_password', 'agent-9').status, 0);
});
