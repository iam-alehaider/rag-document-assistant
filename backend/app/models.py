
from datetime import datetime
from typing import Optional
from pydantic import BaseModel, EmailStr, Field, field_validator


# ---------- Auth ----------
class UserCreate(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8)
    tos_accepted: bool = Field(
        description="Must be true - the person must accept the Terms of Service and Privacy Policy to register."
    )

    @field_validator("tos_accepted")
    @classmethod
    def validate_tos_accepted(cls, v: bool) -> bool:
        if not v:
            raise ValueError("You must accept the Terms of Service and Privacy Policy to create an account.")
        return v


class UserLogin(BaseModel):
    email: EmailStr
    password: str


class Token(BaseModel):
    access_token: str
    token_type: str = "bearer"


class UserOut(BaseModel):
    id: int
    email: EmailStr
    created_at: datetime
    is_verified: bool
    theme_preference: str


ALLOWED_THEMES = {"dark", "light", "system", "oled"}


class PreferencesUpdate(BaseModel):
    theme_preference: str

    @field_validator("theme_preference")
    @classmethod
    def validate_theme(cls, v: str) -> str:
        if v not in ALLOWED_THEMES:
            raise ValueError(f"theme_preference must be one of {ALLOWED_THEMES}")
        return v


class MessageResponse(BaseModel):
    message: str


class ResendVerificationRequest(BaseModel):
    email: EmailStr


class EmailVerifyRequest(BaseModel):
    token: str


class ForgotPasswordRequest(BaseModel):
    email: EmailStr


class ResetPasswordRequest(BaseModel):
    token: str
    new_password: str = Field(min_length=8)


# ---------- Documents ----------
class DocumentOut(BaseModel):
    id: str
    filename: str
    chunks: int
    status: str
    error_message: Optional[str] = None
    uploaded_at: datetime


# ---------- Chat ----------
class ChatRequest(BaseModel):
    question: str
    document_id: Optional[str] = None  # restrict search to one doc, or None = search all user's docs
    session_id: Optional[str] = None   # for conversation continuity


class SourceChunk(BaseModel):
    document_id: str
    filename: str
    chunk_text: str
    score: float


class ChatResponse(BaseModel):
    answer: str
    sources: list[SourceChunk]
    session_id: str


class ChatMessageOut(BaseModel):
    id: int
    question: str
    answer: str
    created_at: datetime


class ChatSessionOut(BaseModel):
    session_id: str
    title: str          # custom title if renamed, else the first question in the session
    message_count: int
    created_at: datetime   # timestamp of first message
    updated_at: datetime   # timestamp of most recent message
    is_pinned: bool


class SessionUpdateRequest(BaseModel):
    title: Optional[str] = None
    is_pinned: Optional[bool] = None

    @field_validator("title")
    @classmethod
    def validate_title(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return v
        v = v.strip()
        if not v:
            raise ValueError("Title cannot be empty.")
        if len(v) > 100:
            raise ValueError("Title must be 100 characters or fewer.")
        return v
