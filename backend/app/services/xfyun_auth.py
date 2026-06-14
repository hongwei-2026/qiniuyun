import base64
import hashlib
import hmac
from datetime import datetime, timezone


def http_date(dt: datetime | None = None) -> str:
    dt = dt or datetime.now(timezone.utc)
    weekday = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"][dt.weekday()]
    month = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep",
             "Oct", "Nov", "Dec"][dt.month - 1]
    return (
        f"{weekday}, {dt.day:02d} {month} {dt.year} "
        f"{dt.hour:02d}:{dt.minute:02d}:{dt.second:02d} GMT"
    )


def sha256_digest(body: str) -> str:
    digest = hashlib.sha256(body.encode("utf-8")).digest()
    return "SHA-256=" + base64.b64encode(digest).decode("utf-8")


def sha256_digest_bytes(body: bytes) -> str:
    digest = hashlib.sha256(body).digest()
    return "SHA-256=" + base64.b64encode(digest).decode("utf-8")


def build_auth_headers(
    *,
    host: str,
    method: str,
    path: str,
    body: str,
    api_key: str,
    api_secret: str,
    date: str | None = None,
) -> dict[str, str]:
    return build_auth_headers_for_bytes(
        host=host,
        method=method,
        path=path,
        body=body.encode("utf-8"),
        api_key=api_key,
        api_secret=api_secret,
        content_type="application/json",
        date=date,
    )


def build_auth_headers_for_bytes(
    *,
    host: str,
    method: str,
    path: str,
    body: bytes,
    api_key: str,
    api_secret: str,
    content_type: str,
    date: str | None = None,
) -> dict[str, str]:
    date = date or http_date()
    digest = sha256_digest_bytes(body)
    signature_origin = (
        f"host: {host}\n"
        f"date: {date}\n"
        f"{method} {path} HTTP/1.1\n"
        f"digest: {digest}"
    )
    signature = base64.b64encode(
        hmac.new(
            api_secret.encode("utf-8"),
            signature_origin.encode("utf-8"),
            digestmod=hashlib.sha256,
        ).digest()
    ).decode("utf-8")
    authorization = (
        f'api_key="{api_key}",algorithm="hmac-sha256", '
        f'headers="host date request-line digest", signature="{signature}"'
    )
    return {
        "Content-Type": content_type,
        "Accept": "application/json",
        "Host": host,
        "Date": date,
        "Digest": digest,
        "Authorization": authorization,
    }
