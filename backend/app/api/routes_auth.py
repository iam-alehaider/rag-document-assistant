from datetime import datetime, timedelta

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request
from sqlalchemy.orm import Session

from app.auth import (
    hash_password,
    verify_password,
    create_access_token,
    generate_secure_token,
    get_current_user,
)
from app.config import get_settings
from app.db import get_db, User
from app.email import send_verification_email, send_reset_email
from app.models import (
    UserCreate,
    UserLogin,
    Token,
    UserOut,
    MessageResponse,
    ResendVerificationRequest,
    EmailVerifyRequest,
    ForgotPasswordRequest,
    ResetPasswordRequest,
)
from app.rate_limit import limiter

settings = get_settings()
router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/register", response_model=UserOut, status_code=201)
@limiter.limit(settings.RATE_LIMIT_AUTH)
def register(
    request: Request,
    payload: UserCreate,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
):
    existing = db.query(User).filter(User.email == payload.email).first()
    if existing:
        raise HTTPException(status_code=400, detail="Email already registered")

    verification_token = generate_secure_token()
    user = User(
        email=payload.email,
        hashed_password=hash_password(payload.password),
        is_verified=False,
        verification_token=verification_token,
        verification_token_expires_at=datetime.utcnow()
        + timedelta(hours=settings.VERIFICATION_TOKEN_EXPIRE_HOURS),
        tos_accepted_at=datetime.utcnow(),
    )
    db.add(user)
    db.commit()
    db.refresh(user)

    # Sent after the response would normally return - keeps registration
    # fast even if the email provider is briefly slow.
    background_tasks.add_task(send_verification_email, user.email, verification_token)

    return user


@router.post("/login", response_model=Token)
@limiter.limit(settings.RATE_LIMIT_AUTH)
def login(request: Request, payload: UserLogin, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.email == payload.email).first()
    if not user or not verify_password(payload.password, user.hashed_password):
        raise HTTPException(status_code=401, detail="Incorrect email or password")

    if not user.is_verified:
        raise HTTPException(
            status_code=403,
            detail="Please verify your email before logging in. Check your inbox for the verification link.",
        )

    token = create_access_token({"sub": str(user.id)})
    return Token(access_token=token)


@router.get("/me", response_model=UserOut)
def me(user: User = Depends(get_current_user)):
    """Current user's profile - powers the account menu in the UI."""
    return user


@router.post("/verify-email", response_model=MessageResponse)
@limiter.limit(settings.RATE_LIMIT_AUTH)
def verify_email(request: Request, payload: EmailVerifyRequest, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.verification_token == payload.token).first()
    if not user:
        raise HTTPException(status_code=400, detail="Invalid or expired verification link.")
    if user.is_verified:
        return MessageResponse(message="Your email is already verified. You can log in.")
    if user.verification_token_expires_at and user.verification_token_expires_at < datetime.utcnow():
        raise HTTPException(
            status_code=400,
            detail="This verification link has expired. Request a new one from the login screen.",
        )

    user.is_verified = True
    user.verification_token = None
    user.verification_token_expires_at = None
    db.commit()

    return MessageResponse(message="Email verified successfully. You can now log in.")


@router.post("/resend-verification", response_model=MessageResponse)
@limiter.limit(settings.RATE_LIMIT_AUTH)
def resend_verification(
    request: Request,
    payload: ResendVerificationRequest,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
):
    # Always return the same generic message regardless of whether the email
    # exists or is already verified - avoids leaking which emails are
    # registered (standard practice for any public-facing account system).
    generic_message = "If that email exists and isn't verified yet, we've sent a new verification link."

    user = db.query(User).filter(User.email == payload.email).first()
    if user and not user.is_verified:
        user.verification_token = generate_secure_token()
        user.verification_token_expires_at = datetime.utcnow() + timedelta(
            hours=settings.VERIFICATION_TOKEN_EXPIRE_HOURS
        )
        db.commit()
        background_tasks.add_task(send_verification_email, user.email, user.verification_token)

    return MessageResponse(message=generic_message)


@router.post("/forgot-password", response_model=MessageResponse)
@limiter.limit(settings.RATE_LIMIT_AUTH)
def forgot_password(
    request: Request,
    payload: ForgotPasswordRequest,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
):
    generic_message = "If that email is registered, we've sent a password reset link."

    user = db.query(User).filter(User.email == payload.email).first()
    if user:
        user.reset_token = generate_secure_token()
        user.reset_token_expires_at = datetime.utcnow() + timedelta(
            minutes=settings.RESET_TOKEN_EXPIRE_MINUTES
        )
        db.commit()
        background_tasks.add_task(send_reset_email, user.email, user.reset_token)

    return MessageResponse(message=generic_message)


@router.post("/reset-password", response_model=MessageResponse)
@limiter.limit(settings.RATE_LIMIT_AUTH)
def reset_password(request: Request, payload: ResetPasswordRequest, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.reset_token == payload.token).first()
    if not user or not user.reset_token_expires_at or user.reset_token_expires_at < datetime.utcnow():
        raise HTTPException(status_code=400, detail="Invalid or expired reset link.")

    user.hashed_password = hash_password(payload.new_password)
    user.reset_token = None
    user.reset_token_expires_at = None
    db.commit()

    return MessageResponse(message="Password updated. You can now log in with your new password.")
