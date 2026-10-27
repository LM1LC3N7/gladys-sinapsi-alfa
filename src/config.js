// -----------------------------------------------------------------------------
// The configuration the user fills (manifest `config_schema`), normalized: the
// address of the Alfa and the margin of the index guards. The address parser
// comes from gladys-ctc (approved), the margin from gladys-pure-energie.
// -----------------------------------------------------------------------------

import { isIP } from 'node:net';
import {
  DEFAULT_PORT,
  INDEX_MAX_KW_DEFAULT,
  INDEX_MAX_KW_MAX,
  INDEX_MAX_KW_MIN,
} from './constants.js';

const LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i;

const isControl = (ch) => ch.charCodeAt(0) < 0x20 || ch.charCodeAt(0) === 0x7f;

/**
 * The address of the Alfa typed by the user: an IPv4 address or a host
 * name, with an optional port (502 by default). A pasted URL is reduced to
 * its host and port. Never a broadcast, a multicast address, 0.0.0.0, an
 * IPv4 address written another way (010.0.0.1) nor a control byte.
 * @returns {{ host: string, port: number } | undefined} undefined when invalid or empty.
 */
export function parseAddress(raw) {
  let text = String(raw ?? '')
    .trim()
    .toLowerCase();
  if ([...text].some(isControl)) {
    return undefined;
  }
  text = text.replace(/^[a-z][a-z0-9+.-]*:\/\//, '').replace(/[/?#].*$/, '');
  if (text === '' || text.length > 260 || /\s/.test(text)) {
    return undefined;
  }
  const match = text.match(/^([^:@[\]]+)(?::(\d{1,5}))?$/);
  if (!match) {
    return undefined;
  }
  const host = match[1];
  const port = match[2] === undefined ? DEFAULT_PORT : Number(match[2]);
  if (!Number.isInteger(port) || port < 1 || port > 65535 || host.length > 253) {
    return undefined;
  }
  if (isIP(host) === 4) {
    const parts = host.split('.');
    const octets = parts.map(Number);
    if (
      octets.some((o, i) => String(o) !== parts[i]) ||
      octets[0] === 0 ||
      octets[0] >= 224 ||
      octets[3] === 255
    ) {
      return undefined;
    }
    return { host, port };
  }
  if (/^[\d.]+$/.test(host)) {
    return undefined;
  }
  return host.split('.').every((label) => LABEL.test(label)) ? { host, port } : undefined;
}

/** The address as shown: `host`, or `host:port` when the port is not 502. */
export const addressText = (address) =>
  address ? (address.port === DEFAULT_PORT ? address.host : `${address.host}:${address.port}`) : '';

/** The margin of the guards in kW: a number within the bounds, else the default. */
function maxKwOf(raw) {
  const value =
    typeof raw === 'number'
      ? raw
      : typeof raw === 'string' && /^\d{1,4}(?:\.\d{1,3})?$/.test(raw.trim())
        ? Number(raw.trim())
        : NaN;
  return Number.isFinite(value) && value >= INDEX_MAX_KW_MIN && value <= INDEX_MAX_KW_MAX
    ? value
    : INDEX_MAX_KW_DEFAULT;
}

export function normalizeConfig(raw = {}) {
  const typed = typeof raw?.address === 'string' ? raw.address.trim() : '';
  const address = parseAddress(typed);
  return {
    address,
    /** Something was typed that is not an address (never shown back). */
    invalidAddress: typed !== '' && !address,
    maxKw: maxKwOf(raw?.max_power_kw),
  };
}

/** Whether the form is complete enough to read the Alfa. */
export const isComplete = (config) => Boolean(config.address);

/** Whether two configurations read the same Alfa (the same host and port). */
export const sameAddress = (a, b) =>
  (!a && !b) || Boolean(a && b && a.host === b.host && a.port === b.port);
