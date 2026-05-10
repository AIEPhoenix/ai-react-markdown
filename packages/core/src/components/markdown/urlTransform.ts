/**
 * Default URL transform — same allowlist as react-markdown / GitHub.
 *
 * @module components/markdown/urlTransform
 */

import type { UrlTransform } from './types';

const safeProtocol = /^(https?|ircs?|mailto|xmpp)$/i;

/**
 * Make a URL safe.
 *
 * Allows `http`, `https`, `irc`, `ircs`, `mailto`, and `xmpp` protocols, plus
 * URLs relative to the current protocol (e.g. `/foo`). Other protocols are
 * stripped to the empty string. Mirrors GitHub's behaviour and matches
 * `micromark-util-sanitize-uri` minus the URL-encoding pass.
 */
export const defaultUrlTransform: UrlTransform = (value) => {
  const colon = value.indexOf(':');
  const questionMark = value.indexOf('?');
  const numberSign = value.indexOf('#');
  const slash = value.indexOf('/');

  if (
    // No protocol → relative.
    colon === -1 ||
    // First colon is after `/`, `?`, or `#` → not a protocol.
    (slash !== -1 && colon > slash) ||
    (questionMark !== -1 && colon > questionMark) ||
    (numberSign !== -1 && colon > numberSign) ||
    // Allowed protocol.
    safeProtocol.test(value.slice(0, colon))
  ) {
    return value;
  }

  return '';
};
