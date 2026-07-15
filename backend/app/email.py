"""
Transactional email via Resend's REST API.

Uses httpx directly instead of the `resend` SDK to avoid adding a new
dependency - Resend's API is a single plain POST request.

IMPORTANT: with a brand-new Resend account and no verified domain, Resend's
sandbox sender (onboarding@resend.dev) will only deliver to the email
address on file for your Resend account itself - not arbitrary recipients.
To send real verification/reset emails to your actual users, verify a
domain in the Resend dashboard and update EMAIL_FROM accordingly.
"""
import logging

import httpx

from app.config import get_settings

settings = get_settings()
logger = logging.getLogger("rag.email")

RESEND_API_URL = "https://api.resend.com/emails"


def _send(to_email: str, subject: str, html: str) -> None:
    api_key = settings.RESEND_API_KEY.get_secret_value()
    if not api_key:
        # No provider configured - log instead of failing the request, so
        # registration/reset flows still work end-to-end in local dev.
        logger.warning(f"RESEND_API_KEY not set - skipping email to {to_email}: {subject}")
        return

    try:
        resp = httpx.post(
            RESEND_API_URL,
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
            },
            json={
                "from": settings.EMAIL_FROM,
                "to": [to_email],
                "subject": subject,
                "html": html,
            },
            timeout=10,
        )
        resp.raise_for_status()
    except Exception as e:
        # Email delivery failures shouldn't crash the request that triggered
        # them (e.g. registration) - log it so it's visible in Render logs.
        logger.error(f"Failed to send email to {to_email}: {e}")


def _wrap(inner_html: str) -> str:
    return f"""
    <div style="font-family: -apple-system, sans-serif; max-width: 480px; margin: 0 auto; color: #1a1a1a;">
      {inner_html}
      <p style="color: #8891a5; font-size: 12px; margin-top: 32px;">
        {settings.APP_NAME} · If you didn't request this, you can safely ignore this email.
      </p>
    </div>
    """


def send_verification_email(to_email: str, token: str) -> None:
    link = f"{settings.FRONTEND_URL}?verify={token}"
    html = _wrap(f"""
      <h2>Verify your email</h2>
      <p>Thanks for signing up for {settings.APP_NAME}. Confirm your email address to activate your account:</p>
      <p><a href="{link}" style="display:inline-block;background:#4c7ef3;color:#fff;padding:10px 22px;
         border-radius:6px;text-decoration:none;font-weight:600;">Verify email</a></p>
      <p style="font-size:13px;color:#5b6478;">Or paste this link into your browser:<br>{link}</p>
      <p style="font-size:13px;color:#5b6478;">This link expires in {settings.VERIFICATION_TOKEN_EXPIRE_HOURS} hours.</p>
    """)
    _send(to_email, f"Verify your {settings.APP_NAME} email", html)


def send_reset_email(to_email: str, token: str) -> None:
    link = f"{settings.FRONTEND_URL}?reset={token}"
    html = _wrap(f"""
      <h2>Reset your password</h2>
      <p>We received a request to reset your {settings.APP_NAME} password. Click below to choose a new one:</p>
      <p><a href="{link}" style="display:inline-block;background:#4c7ef3;color:#fff;padding:10px 22px;
         border-radius:6px;text-decoration:none;font-weight:600;">Reset password</a></p>
      <p style="font-size:13px;color:#5b6478;">Or paste this link into your browser:<br>{link}</p>
      <p style="font-size:13px;color:#5b6478;">This link expires in {settings.RESET_TOKEN_EXPIRE_MINUTES} minutes.</p>
    """)
    _send(to_email, f"Reset your {settings.APP_NAME} password", html)
