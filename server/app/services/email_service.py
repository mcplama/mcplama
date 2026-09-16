# Copyright (c) 2026 MCPlama <dev@mcplama.com>
# SPDX-License-Identifier: AGPL-3.0-or-later

"""
Email Service
-------------
Handles sending emails via configured SMTP server.
Save as: backend/app/services/email_service.py
"""
import asyncio
import logging
import smtplib
import ssl
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from typing import Optional

logger = logging.getLogger(__name__)


async def get_smtp_config(db):
    from sqlalchemy import select
    from app.models.smtp_config import SmtpConfig
    result = await db.execute(select(SmtpConfig).where(SmtpConfig.id == 1))
    return result.scalar_one_or_none()


async def send_email(db, to: str, subject: str, html: str, text: str = "") -> bool:
    """Send an email using configured SMTP. Returns True if sent."""
    cfg = await get_smtp_config(db)
    if not cfg or not cfg.is_enabled or not cfg.host:
        logger.info(f"SMTP not configured — skipping email to {to}")
        return False

    try:
        await asyncio.to_thread(_send_sync, cfg, to, subject, html, text)
        logger.info(f"Email sent to {to}: {subject}")
        return True
    except Exception as e:
        logger.error(f"Failed to send email to {to}: {e}")
        return False


def _send_sync(cfg, to: str, subject: str, html: str, text: str):
    from app.core.encryption import decrypt

    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"] = f"{cfg.from_name} <{cfg.from_email}>"
    msg["To"] = to

    if text:
        msg.attach(MIMEText(text, "plain"))
    msg.attach(MIMEText(html, "html"))

    password = decrypt(cfg.password, "smtp:password") if cfg.password else cfg.password

    if cfg.use_tls:
        context = ssl.create_default_context()
        with smtplib.SMTP(cfg.host, cfg.port) as server:
            server.ehlo()
            server.starttls(context=context)
            if cfg.username and password:
                server.login(cfg.username, password)
            server.sendmail(cfg.from_email, to, msg.as_string())
    else:
        with smtplib.SMTP(cfg.host, cfg.port) as server:
            if cfg.username and password:
                server.login(cfg.username, password)
            server.sendmail(cfg.from_email, to, msg.as_string())


# ── Email templates ────────────────────────────────────────────────────────────

def invite_email(
    invite_url: str,
    invited_by: str,
    role: str,
    gateway_name: str = "MCPlama",
    logo_url: str = "",
) -> tuple[str, str]:
    """Returns (subject, html)"""
    subject = f"You've been invited to {gateway_name}"
    logo = (
        f'<img src="{logo_url}" alt="{gateway_name}" width="48" height="48" '
        'style="display: block; width: 48px; height: 48px; border-radius: 14px;" />'
        if logo_url
        else '<span style="color: white; font-size: 24px;">⚡</span>'
    )
    html = f"""
<!DOCTYPE html>
<html>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #0d1117; color: #cbd5e1; margin: 0; padding: 40px 20px;">
  <div style="max-width: 480px; margin: 0 auto;">
    <div style="text-align: center; margin-bottom: 32px;">
      <div style="width: 48px; height: 48px; border-radius: 14px; background: linear-gradient(135deg, #4f8ef7, #a78bfa); display: inline-flex; align-items: center; justify-content: center; overflow: hidden; margin-bottom: 16px;">
        {logo}
      </div>
      <h1 style="color: #ffffff; font-size: 22px; margin: 0;">{gateway_name}</h1>
    </div>

    <div style="background: #1c2333; border: 1px solid #2d3748; border-radius: 16px; padding: 32px;">
      <h2 style="color: #ffffff; font-size: 18px; margin: 0 0 12px;">You're invited!</h2>
      <p style="color: #94a3b8; margin: 0 0 8px;">
        <strong style="color: #cbd5e1;">{invited_by}</strong> has invited you to join {gateway_name} as a <strong style="color: #4f8ef7;">{role}</strong>.
      </p>
      <p style="color: #94a3b8; margin: 0 0 24px;">
        MCPlama is an MCP gateway that connects your AI tools (VS Code, Claude Desktop) to any MCP server.
      </p>

      <a href="{invite_url}" style="display: block; text-align: center; background: linear-gradient(135deg, #4f8ef7, #a78bfa); color: white; text-decoration: none; padding: 14px 24px; border-radius: 12px; font-weight: 600; font-size: 15px; margin-bottom: 24px;">
        Accept invitation →
      </a>

      <p style="color: #64748b; font-size: 12px; margin: 0;">
        This invitation expires in 7 days. If you didn't expect this, you can safely ignore it.
      </p>
    </div>

    <p style="text-align: center; color: #475569; font-size: 11px; margin-top: 24px;">
      {gateway_name} · Powered by MCPlama
    </p>
  </div>
</body>
</html>"""
    return subject, html


def password_reset_email(reset_url: str, user_name: str, gateway_name: str = "MCPlama") -> tuple[str, str]:
    """Returns (subject, html)"""
    subject = f"Reset your {gateway_name} password"
    html = f"""
<!DOCTYPE html>
<html>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #0d1117; color: #cbd5e1; margin: 0; padding: 40px 20px;">
  <div style="max-width: 480px; margin: 0 auto;">
    <div style="text-align: center; margin-bottom: 32px;">
      <div style="width: 48px; height: 48px; border-radius: 14px; background: linear-gradient(135deg, #4f8ef7, #a78bfa); display: inline-flex; align-items: center; justify-content: center; margin-bottom: 16px;">
        <span style="color: white; font-size: 24px;">⚡</span>
      </div>
      <h1 style="color: #ffffff; font-size: 22px; margin: 0;">{gateway_name}</h1>
    </div>

    <div style="background: #1c2333; border: 1px solid #2d3748; border-radius: 16px; padding: 32px;">
      <h2 style="color: #ffffff; font-size: 18px; margin: 0 0 12px;">Reset your password</h2>
      <p style="color: #94a3b8; margin: 0 0 24px;">
        Hi {user_name}, we received a request to reset the password on your {gateway_name} account. Click below to choose a new one.
      </p>

      <a href="{reset_url}" style="display: block; text-align: center; background: linear-gradient(135deg, #4f8ef7, #a78bfa); color: white; text-decoration: none; padding: 14px 24px; border-radius: 12px; font-weight: 600; font-size: 15px; margin-bottom: 24px;">
        Reset password →
      </a>

      <p style="color: #64748b; font-size: 12px; margin: 0;">
        This link expires in 1 hour and can only be used once. If you didn't request this, you can safely ignore this email — your password won't change.
      </p>
    </div>

    <p style="text-align: center; color: #475569; font-size: 11px; margin-top: 24px;">
      {gateway_name} · Powered by MCPlama
    </p>
  </div>
</body>
</html>"""
    return subject, html


def alert_email(
    alert_name: str,
    severity: str,
    current_value: str,
    server_name: str,
    dashboard_url: str,
    gateway_name: str = "MCPlama",
    logo_url: str = "",
) -> tuple[str, str]:
    """Returns (subject, html)"""
    severity_color = {"danger": "#f87171", "warn": "#fbbf24", "info": "#4f8ef7"}.get(severity, "#94a3b8")
    severity_label = {"danger": "🔴 CRITICAL", "warn": "🟡 WARNING", "info": "🔵 INFO"}.get(severity, severity.upper())
    logo = (
        f'<img src="{logo_url}" alt="{gateway_name}" width="48" height="48" '
        'style="display: block; width: 48px; height: 48px; border-radius: 14px;" />'
        if logo_url
        else '<span style="color: white; font-size: 24px;">⚡</span>'
    )

    subject = f"[{severity_label}] {alert_name} — {gateway_name}"
    html = f"""
<!DOCTYPE html>
<html>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #0d1117; color: #cbd5e1; margin: 0; padding: 40px 20px;">
  <div style="max-width: 480px; margin: 0 auto;">
    <div style="text-align: center; margin-bottom: 32px;">
      <div style="width: 48px; height: 48px; border-radius: 14px; background: linear-gradient(135deg, #4f8ef7, #a78bfa); display: inline-flex; align-items: center; justify-content: center; overflow: hidden; margin-bottom: 16px;">
        {logo}
      </div>
      <h1 style="color: #ffffff; font-size: 22px; margin: 0;">{gateway_name}</h1>
    </div>

    <div style="background: #1c2333; border: 1px solid {severity_color}40; border-radius: 16px; padding: 32px;">
      <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 20px;">
        <div style="width: 4px; height: 40px; background: {severity_color}; border-radius: 4px;"></div>
        <div>
          <p style="color: {severity_color}; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; margin: 0 0 4px;">{severity_label}</p>
          <h2 style="color: #ffffff; font-size: 18px; margin: 0;">{alert_name}</h2>
        </div>
      </div>

      <div style="background: #212840; border-radius: 10px; padding: 16px; margin-bottom: 20px;">
        <p style="color: #64748b; font-size: 11px; font-weight: 600; text-transform: uppercase; margin: 0 0 6px;">Current value</p>
        <p style="color: #ffffff; font-size: 15px; font-weight: 600; margin: 0;">{current_value}</p>
      </div>

      {f'<p style="color: #94a3b8; margin: 0 0 20px;">Server: <strong style="color: #cbd5e1;">{server_name}</strong></p>' if server_name else ''}

      <a href="{dashboard_url}/activity" style="display: block; text-align: center; background: #212840; color: #4f8ef7; text-decoration: none; padding: 12px 24px; border-radius: 10px; font-weight: 600; font-size: 14px; border: 1px solid #2d3748;">
        View in dashboard →
      </a>
    </div>

    <p style="text-align: center; color: #475569; font-size: 11px; margin-top: 24px;">
      {gateway_name} · Manage alerts in your dashboard
    </p>
  </div>
</body>
</html>"""
    return subject, html
