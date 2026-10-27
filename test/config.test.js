// -----------------------------------------------------------------------------
// The configuration (src/config.js): the address of the Alfa and the margin.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addressText, normalizeConfig, parseAddress, sameAddress } from '../src/config.js';

test('addresses: IPv4, host names, an optional port (502 by default), a pasted URL', () => {
  assert.deepEqual(parseAddress('192.168.1.50'), { host: '192.168.1.50', port: 502 });
  assert.deepEqual(parseAddress(' 192.168.1.50:1502 '), { host: '192.168.1.50', port: 1502 });
  assert.deepEqual(parseAddress('modbus://Alfa.local:502/x'), { host: 'alfa.local', port: 502 });
  assert.deepEqual(parseAddress('alfa'), { host: 'alfa', port: 502 });
  assert.equal(addressText({ host: '10.0.0.2', port: 502 }), '10.0.0.2');
  assert.equal(addressText({ host: '10.0.0.2', port: 1502 }), '10.0.0.2:1502');
});

test('never a broadcast, multicast, any-address, odd IPv4, control byte or user', () => {
  for (const bad of [
    '0.0.0.0',
    '255.255.255.255',
    '192.168.1.255',
    '224.0.0.1',
    '239.1.2.3',
    '010.0.0.1',
    '1.2.3',
    '192.168.1.50:0',
    '192.168.1.50:70000',
    'user:pw@192.168.1.50',
    'alfa\r\nX: y',
    'al fa',
    '[::1]',
    '-alfa',
    'a'.repeat(300),
  ]) {
    assert.equal(parseAddress(bad), undefined, JSON.stringify(bad));
  }
});

test('normalized: invalid address flagged (never shown back), margin bounded', () => {
  assert.deepEqual(normalizeConfig({}), { address: undefined, invalidAddress: false, maxKw: 30 });
  const bad = normalizeConfig({ address: '999.1.1.1', max_power_kw: '5000' });
  assert.equal(bad.invalidAddress, true);
  assert.equal(bad.address, undefined);
  assert.equal(bad.maxKw, 30);
  assert.equal(normalizeConfig({ max_power_kw: 12 }).maxKw, 12);
  assert.equal(normalizeConfig({ max_power_kw: '6.5' }).maxKw, 6.5);
  assert.equal(normalizeConfig({ max_power_kw: '' }).maxKw, 30);
  assert.equal(normalizeConfig({ max_power_kw: 0 }).maxKw, 30);
});

test('the same Alfa: the same host and port', () => {
  assert.ok(sameAddress(parseAddress('10.0.0.2'), parseAddress('10.0.0.2:502')));
  assert.ok(!sameAddress(parseAddress('10.0.0.2'), parseAddress('10.0.0.2:1502')));
  assert.ok(sameAddress(undefined, undefined));
  assert.ok(!sameAddress(parseAddress('10.0.0.2'), undefined));
});
