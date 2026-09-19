# Copyright (c) 2026 MCPlama <dev@mcplama.com>
# SPDX-License-Identifier: AGPL-3.0-or-later

import time
from collections import defaultdict
from datetime import datetime
from typing import List, Optional, Literal
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from pydantic import BaseModel, field_validator
from app.db.session import get_db
from app.models.user import User, UserRole
from app.core.security import verify_password, create_access_token, hash_password, decode_token
from app.core.config import settings

router = APIRouter(prefix="/auth", tags=["auth"])
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/v1/auth/login", auto_error=False)
TERMS_VERSION = "1.0"
# Bump with the version shown in the root TERMS.md whenever those terms change.
TERMS_URL = "https://raw.githubusercontent.com/mcplama/mcplama/refs/heads/main/TERMS.md"

# ── In-memory rate limiter for auth endpoints ─────────────────────────────────
_login_attempts: dict[str, list[float]] = defaultdict(list)

def _rate_check(ip: str, limit: int = 10, window: int = 60) -> None:
    now = time.time()
    bucket = [t for t in _login_attempts[ip] if now - t < window]
    bucket.append(now)
    _login_attempts[ip] = bucket
    if len(bucket) > limit:
        raise HTTPException(429, detail="Too many attempts. Please wait before trying again.")

def _set_auth_cookie(response: Response, token: str) -> None:
    secure = settings.GATEWAY_URL.startswith("https://")
    response.set_cookie(
        key="access_token",
        value=token,
        httponly=True,
        secure=secure,
        samesite="lax",
        max_age=settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60,
        path="/",
    )


class LoginIn(BaseModel):
    email: str
    password: str


class UserOut(BaseModel):
    id: int
    email: str
    name: str
    role: str
    is_active: bool
    created_at: datetime
    last_login: Optional[datetime]

    class Config:
        from_attributes = True


class TokenOut(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserOut


async def get_current_user(
    request: Request,
    token: Optional[str] = Depends(oauth2_scheme),
    db: AsyncSession = Depends(get_db),
) -> User:
    jwt_token = token or request.cookies.get("access_token")
    if not jwt_token:
        raise HTTPException(status_code=401, detail="Not authenticated")
    payload = decode_token(jwt_token)
    result = await db.execute(select(User).where(User.id == int(payload.get("sub", 0))))
    user = result.scalar_one_or_none()
    if not user or not user.is_active:
        raise HTTPException(status_code=401, detail="Invalid or inactive user")
    return user


async def require_admin(user: User = Depends(get_current_user)) -> User:
    if user.role != UserRole.admin:
        raise HTTPException(status_code=403, detail="Admin access required")
    return user


@router.get("/setup-status")
async def setup_status(db: AsyncSession = Depends(get_db)):
    from sqlalchemy import func
    result = await db.execute(
        select(func.count(User.id)).where(User.role == "admin")
    )
    return {
        "setup_done": (result.scalar() or 0) > 0,
        "terms_version": TERMS_VERSION,
        "terms_url": TERMS_URL,
    }


@router.post("/setup")
async def initial_setup(data: dict, db: AsyncSession = Depends(get_db)):
    from sqlalchemy import func
    result = await db.execute(
        select(func.count(User.id)).where(User.role == "admin")
    )
    if (result.scalar() or 0) > 0:
        raise HTTPException(400, "Setup already completed")
    if data.get("terms_accepted") is not True or data.get("terms_version") != TERMS_VERSION:
        raise HTTPException(400, "You must accept the current Terms of Use to complete setup")
    user = User(
        name=data.get("name", "Admin"),
        email=data["email"],
        hashed_password=hash_password(data["password"]),
        role="admin",
        is_active=True,
        terms_accepted_at=datetime.utcnow(),
        terms_version=TERMS_VERSION,
    )
    db.add(user)

    # Save gateway config if provided
    if data.get("gateway_name") or data.get("app_url"):
        from app.models.gateway_config import GatewayConfig
        cfg = GatewayConfig(
            id=1,
            gateway_name=data.get("gateway_name", "MCPlama"),
            app_url=data.get("app_url") or None,
        )
        await db.merge(cfg)

    # Save SMTP config if the wizard's "enable email" step was filled in.
    # Optional — the gateway works without it, but invites, alert emails, and
    # admin password reset all require it.
    if data.get("smtp_enabled") and data.get("smtp_host"):
        from app.models.smtp_config import SmtpConfig
        from app.core.encryption import encrypt
        smtp = SmtpConfig(
            id=1,
            host=data.get("smtp_host"),
            port=int(data.get("smtp_port") or 587),
            username=data.get("smtp_username") or None,
            password=encrypt(data["smtp_password"], "smtp:password") if data.get("smtp_password") else None,
            from_email=data.get("smtp_from_email") or data.get("email"),
            from_name=data.get("smtp_from_name") or data.get("gateway_name", "MCPlama"),
            use_tls=bool(data.get("smtp_use_tls", True)),
            is_enabled=True,
        )
        await db.merge(smtp)

    await db.commit()
    return {"ok": True}


@router.post("/login", response_model=TokenOut)
async def login(data: LoginIn, request: Request, response: Response, db: AsyncSession = Depends(get_db)):
    _rate_check(request.client.host if request.client else "unknown")
    result = await db.execute(select(User).where(User.email == data.email))
    user = result.scalar_one_or_none()
    if not user or not user.hashed_password or not verify_password(data.password, user.hashed_password):
        raise HTTPException(status_code=401, detail="Invalid credentials")
    if not user.is_active:
        raise HTTPException(status_code=403, detail="Account disabled")
    user.last_login = datetime.utcnow()
    await db.commit()
    token = create_access_token({"sub": str(user.id), "role": user.role.value})
    _set_auth_cookie(response, token)
    return TokenOut(access_token=token, user=UserOut.model_validate(user))


@router.post("/logout", status_code=204)
async def logout(response: Response):
    response.delete_cookie(key="access_token", path="/")


@router.get("/me", response_model=UserOut)
async def me(user: User = Depends(get_current_user)):
    return UserOut.model_validate(user)


# ── Forgot / reset password (requires SMTP configured) ─────────────────────────

class ForgotPasswordIn(BaseModel):
    email: str


class ResetPasswordIn(BaseModel):
    token: str
    password: str

    @field_validator("password")
    @classmethod
    def password_min_length(cls, v: str) -> str:
        if len(v) < 8:
            raise ValueError("Password must be at least 8 characters")
        return v


def _hash_reset_token(token: str) -> str:
    import hashlib
    return hashlib.sha256(token.encode()).hexdigest()


@router.post("/forgot-password", status_code=202)
async def forgot_password(data: ForgotPasswordIn, request: Request, db: AsyncSession = Depends(get_db)):
    """Always returns 202, whether or not the email matches an account —
    otherwise the response itself would let a caller enumerate registered
    emails."""
    _rate_check(request.client.host if request.client else "unknown", limit=5, window=300)

    from datetime import timedelta
    import secrets
    from app.services.email_service import send_email, password_reset_email, get_smtp_config

    generic_response = {"ok": True, "message": "If that email has an account, a reset link has been sent."}

    cfg = await get_smtp_config(db)
    if not cfg or not cfg.is_enabled or not cfg.host:
        # No SMTP configured — nothing we can send. Still return the generic
        # response so this endpoint can't be used to test whether SMTP is set up.
        return generic_response

    result = await db.execute(select(User).where(User.email == data.email))
    user = result.scalar_one_or_none()
    if not user or not user.is_active:
        return generic_response

    token = secrets.token_urlsafe(32)
    user.reset_token_hash = _hash_reset_token(token)
    user.reset_token_expires = datetime.utcnow() + timedelta(hours=1)
    await db.commit()

    try:
        from app.api.v1.endpoints.gateway_config_endpoint import get_effective_app_url
        gateway_url = await get_effective_app_url(db)
    except Exception:
        gateway_url = getattr(settings, "FRONTEND_URL", "http://localhost:5173")
    reset_url = f"{gateway_url}/reset-password/{token}"

    subject, html = password_reset_email(reset_url=reset_url, user_name=user.name)
    await send_email(db, user.email, subject, html)
    return generic_response


@router.post("/reset-password")
async def reset_password(data: ResetPasswordIn, db: AsyncSession = Depends(get_db)):
    token_hash = _hash_reset_token(data.token)
    result = await db.execute(select(User).where(User.reset_token_hash == token_hash))
    user = result.scalar_one_or_none()
    if not user or not user.reset_token_expires or user.reset_token_expires < datetime.utcnow():
        raise HTTPException(400, "This reset link is invalid or has expired. Request a new one.")

    user.hashed_password = hash_password(data.password)
    user.reset_token_hash = None
    user.reset_token_expires = None
    await db.commit()
    return {"ok": True}


# ── Invite system ─────────────────────────────────────────────────────────────

class InviteCreate(BaseModel):
    email: str
    role: Literal["admin", "member"] = "member"
    send_email: bool = False


class InviteOut(BaseModel):
    id: int
    email: str
    role: str
    token: str
    accepted: bool
    created_at: datetime
    expires_at: datetime
    invite_url: str
    class Config: from_attributes = True


class AcceptInvite(BaseModel):
    token: str
    name: str
    password: str


@router.post("/invite", response_model=InviteOut)
async def create_invite(data: InviteCreate, db: AsyncSession = Depends(get_db), admin: User = Depends(require_admin)):
    from app.models.invite import Invite
    from datetime import timedelta
    import secrets

    # Check user doesn't already exist
    existing = (await db.execute(select(User).where(User.email == data.email))).scalar_one_or_none()
    if existing:
        raise HTTPException(400, f"{data.email} already has an account")

    if settings.MAX_USERS > 0:
        from sqlalchemy import func
        user_count = (await db.execute(select(func.count(User.id)))).scalar() or 0
        if user_count >= settings.MAX_USERS:
            raise HTTPException(403, f"Community edition is limited to {settings.MAX_USERS} users. Upgrade to Enterprise for more.")

    token = secrets.token_urlsafe(32)
    expires = datetime.utcnow() + timedelta(days=7)
    invite = Invite(
        email=data.email,
        token=token,
        role=data.role,
        invited_by=admin.id,
        expires_at=expires,
    )
    db.add(invite)
    await db.commit()
    await db.refresh(invite)

    # Use DB gateway URL if configured (production support)
    try:
        from app.api.v1.endpoints.gateway_config_endpoint import get_effective_app_url
        gateway_url = await get_effective_app_url(db)
    except Exception:
        gateway_url = getattr(settings, "FRONTEND_URL", "http://localhost:5173")
    invite_url = f"{gateway_url}/invite/{token}"

    # Send invite email only if requested
    if data.send_email:
        from app.services.email_service import send_email, invite_email, get_smtp_config
        cfg = await get_smtp_config(db)
        if not cfg or not cfg.is_enabled or not cfg.host:
            raise HTTPException(400, "SMTP is not configured. Go to Settings → SMTP to set it up, or use 'Copy invite link' instead.")
        try:
            subject, html = invite_email(
                invite_url=invite_url,
                invited_by=admin.email,
                role=data.role,
                logo_url=f"{gateway_url.rstrip('/')}/icons/mcplama-icon-128.png",
            )
            sent = await send_email(db, data.email, subject, html)
            if not sent:
                raise HTTPException(400, "Failed to send email. Check your SMTP configuration in Settings.")
        except HTTPException:
            raise
        except Exception as e:
            raise HTTPException(400, f"Email error: {str(e)}")

    return {
        **{c.name: getattr(invite, c.name) for c in invite.__table__.columns},
        "invite_url": invite_url,
    }


@router.get("/invite/{token}")
async def get_invite(token: str, db: AsyncSession = Depends(get_db)):
    from app.models.invite import Invite
    invite = (await db.execute(select(Invite).where(Invite.token == token))).scalar_one_or_none()
    if not invite:
        raise HTTPException(404, "Invalid invite link")
    if invite.accepted:
        raise HTTPException(400, "Invite already used")
    if invite.expires_at < datetime.utcnow():
        raise HTTPException(400, "Invite has expired")
    return {"email": invite.email, "role": invite.role, "valid": True}


@router.post("/invite/{token}/accept", response_model=TokenOut)
async def accept_invite(token: str, data: AcceptInvite, response: Response, db: AsyncSession = Depends(get_db)):
    from app.models.invite import Invite
    from app.core.security import hash_password as get_password_hash, create_access_token

    invite = (await db.execute(select(Invite).where(Invite.token == token))).scalar_one_or_none()
    if not invite or invite.accepted:
        raise HTTPException(400, "Invalid or already used invite")
    if invite.expires_at < datetime.utcnow():
        raise HTTPException(400, "Invite has expired")

    if settings.MAX_USERS > 0:
        from sqlalchemy import func
        user_count = (await db.execute(select(func.count(User.id)))).scalar() or 0
        if user_count >= settings.MAX_USERS:
            raise HTTPException(403, f"Community edition is limited to {settings.MAX_USERS} users. Ask an admin to upgrade to Enterprise.")

    # Create user
    user = User(
        email=invite.email,
        name=data.name,
        hashed_password=get_password_hash(data.password),
        role=UserRole(invite.role),
        is_active=True,
    )
    db.add(user)
    invite.accepted = True
    await db.commit()
    await db.refresh(user)

    access_token = create_access_token({"sub": str(user.id)})
    _set_auth_cookie(response, access_token)

    # Trigger new_user alert checks immediately
    try:
        import asyncio
        asyncio.create_task(_check_new_user_alerts(user.email))
    except Exception:
        pass

    return {
        "access_token": access_token,
        "token_type": "bearer",
        "user": {
            "id": user.id,
            "email": user.email,
            "name": user.name,
            "role": user.role,
            "is_active": user.is_active,
            "avatar_url": user.avatar_url,
            "created_at": user.created_at,
            "last_login": user.last_login,
        }
    }


async def _check_new_user_alerts(new_user_email: str):
    """Immediately check new_user alerts and send emails."""
    try:
        from app.db.session import AsyncSessionLocal
        from app.models.alert import Alert
        from app.models.user import User as UserModel
        from app.services.email_service import send_email, alert_email
        from app.core.config import settings
        from sqlalchemy import select
        import logging
        log = logging.getLogger(__name__)

        async with AsyncSessionLocal() as db:
            result = await db.execute(
                select(Alert).where(Alert.is_enabled == True, Alert.alert_type == "new_user")
            )
            alerts = result.scalars().all()

            for alert in alerts:
                if not (alert.config or {}).get("notify_by_email"):
                    continue

                notify_ids = alert.notify_user_ids or []
                if notify_ids:
                    ur = await db.execute(select(UserModel).where(UserModel.id.in_(notify_ids), UserModel.is_active == True))
                else:
                    ur = await db.execute(select(UserModel).where(UserModel.role == "admin", UserModel.is_active == True))
                notify_users = ur.scalars().all()

                subject, html = alert_email(
                    alert_name=alert.name,
                    severity=alert.severity,
                    current_value=f"New user joined: {new_user_email}",
                    server_name="",
                    dashboard_url=gateway_url if 'gateway_url' in dir() else settings.GATEWAY_URL,
                )

                for user in notify_users:
                    sent = await send_email(db, user.email, subject, html)
                    if sent:
                        log.info(f"New user alert sent to {user.email}: {new_user_email} joined")

                from datetime import datetime
                alert.triggered_count = (alert.triggered_count or 0) + 1
                alert.last_triggered_at = datetime.utcnow()

            await db.commit()
    except Exception as e:
        import logging
        logging.getLogger(__name__).warning(f"New user alert check failed: {e}")


@router.get("/invites", response_model=List[InviteOut])
async def list_invites(db: AsyncSession = Depends(get_db), _: User = Depends(require_admin)):
    from app.models.invite import Invite
    from app.api.v1.endpoints.gateway_config_endpoint import get_effective_app_url
    result = await db.execute(select(Invite).order_by(Invite.created_at.desc()))
    invites = result.scalars().all()
    try:
        gateway_url = await get_effective_app_url(db)
    except Exception:
        gateway_url = settings.GATEWAY_URL
    return [
        {**{c.name: getattr(i, c.name) for c in i.__table__.columns}, "invite_url": f"{gateway_url}/invite/{i.token}"}
        for i in invites
    ]


@router.delete("/invites/{invite_id}", status_code=204)
async def delete_invite(invite_id: int, db: AsyncSession = Depends(get_db), _: User = Depends(require_admin)):
    from app.models.invite import Invite
    invite = (await db.execute(select(Invite).where(Invite.id == invite_id))).scalar_one_or_none()
    if invite:
        await db.delete(invite)
        await db.commit()
