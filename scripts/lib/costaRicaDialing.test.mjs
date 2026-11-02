import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { toCostaRicaNumber } from '../../src/features/telephony/models/call.ts';

function asteriskPatternToRegExp(pattern) {
  const body = pattern.slice(1).replaceAll('X', '[0-9]');
  return new RegExp(`^${body}$`);
}

const script = readFileSync(new URL('../../infra/asterisk/plw-agents.sh', import.meta.url), 'utf8');
const allowedPatterns = [...script.matchAll(/^exten => (_[^,]+),1,Dial\(PJSIP\/\$\{VOCEX_PREFIX\}/gm)]
  .map((match) => asteriskPatternToRegExp(match[1]));

function asteriskAllows(digits) {
  return allowedPatterns.some((pattern) => pattern.test(digits));
}

const ALLOWED = ['22345678', '40106199', '50012345', '61234567', '71234567', '88888888'];
const REFUSED = [
  '',
  '911',
  '1115',
  '12345678',
  '92345678',
  '02345678',
  '8888888',
  '888888888',
  '8002860101',
  '9003654632',
  '9053654632',
  '50612345678',
  '50692345678',
  '0015551234567',
  '15551234567',
  '+15551234567',
  'agent-2',
  '8888888a',
];

test('the dialplan has both allowed number forms', () => {
  assert.equal(allowedPatterns.length, 2);
});

test('Costa Rican numbers pass in the browser and in Asterisk, with or without 506', () => {
  for (const number of ALLOWED) {
    assert.equal(toCostaRicaNumber(number), number);
    assert.equal(toCostaRicaNumber(`506${number}`), number);
    assert.equal(toCostaRicaNumber(`+506${number}`), number);
    assert.ok(asteriskAllows(number), number);
    assert.ok(asteriskAllows(`506${number}`), `506${number}`);
  }
});

test('written formats are cleaned up before the check', () => {
  assert.equal(toCostaRicaNumber('+506 4010-6199'), '40106199');
  assert.equal(toCostaRicaNumber('(506) 8888 8888'), '88888888');
});

test('everything else is refused in the browser and in Asterisk', () => {
  for (const number of REFUSED) {
    assert.equal(toCostaRicaNumber(number), null, number);
    assert.ok(!asteriskAllows(number), number);
  }
});
