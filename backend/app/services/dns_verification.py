"""TXT-record verification for T55 vanity-domain claims.

Public surface:

- `generate_txt_token(prefix='jacob-domain-verify')` — fresh URL-safe
  token suitable as the *value* portion of a TXT record:
  `jacob-domain-verify=<token>`.
- `query_txt_records(hostname, *, timeout)` — return all TXT record
  *values* for the hostname (each value already concatenated across
  multi-string records). Returns an empty list on `NXDOMAIN`,
  `NoAnswer`, or transport timeout. Other exceptions propagate.
- `verify_txt_record(hostname, expected_value, *, timeout)` —
  convenience wrapper; True iff `expected_value` appears in the
  TXT records.

The functions are deliberately small so tests can stub
`query_txt_records` instead of bringing up a fake resolver.
"""

from __future__ import annotations

import logging
import secrets
from typing import Any

import dns.resolver
from dns.exception import DNSException
from dns.rdatatype import TXT

logger = logging.getLogger(__name__)


_DEFAULT_TIMEOUT = 5.0


def generate_txt_token(prefix: str = "jacob-domain-verify") -> str:
    """Generate a `<prefix>=<rand>` TXT value the user adds to their DNS."""
    return f"{prefix}={secrets.token_urlsafe(24)}"


def _decode_txt_strings(strings: Any) -> str:
    """Concatenate TXT-record string fragments into a single utf-8 value."""
    parts: list[str] = []
    for s in strings:
        if isinstance(s, bytes):
            try:
                parts.append(s.decode("utf-8"))
            except UnicodeDecodeError:
                parts.append(s.decode("utf-8", errors="replace"))
        else:
            parts.append(str(s))
    return "".join(parts)


def query_txt_records(
    hostname: str,
    *,
    timeout: float = _DEFAULT_TIMEOUT,
    resolver: Any | None = None,
) -> list[str]:
    """Return every TXT record *value* for `hostname`.

    Returns [] on `NXDOMAIN` / `NoAnswer` / transport timeout. Other
    `DNSException` instances surface to the caller — they almost always
    indicate a misconfiguration that the operator should see.
    """
    res = resolver or dns.resolver.Resolver()
    res.lifetime = timeout
    res.timeout = timeout

    try:
        answer = res.resolve(hostname, TXT)
    except (
        dns.resolver.NoAnswer,
        dns.resolver.NXDOMAIN,
        dns.resolver.NoNameservers,
    ):
        return []
    except dns.exception.Timeout:
        logger.warning("dns_txt_timeout host=%s", hostname)
        return []
    except DNSException:
        logger.exception("dns_txt_query_failed host=%s", hostname)
        raise

    out: list[str] = []
    for rdata in answer:
        strings = getattr(rdata, "strings", None)
        if strings is not None:
            out.append(_decode_txt_strings(strings))
        else:
            out.append(str(rdata).strip('"'))
    return out


def verify_txt_record(
    hostname: str,
    expected_value: str,
    *,
    timeout: float = _DEFAULT_TIMEOUT,
    resolver: Any | None = None,
) -> bool:
    """True iff `expected_value` appears in the host's TXT records."""
    values = query_txt_records(hostname, timeout=timeout, resolver=resolver)
    return expected_value in values
