from datetime import datetime
from typing import Optional
from pydantic import BaseModel, EmailStr, Field


# ---------- Auth ----------
class UserCreate(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8)


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


# ---------- Documents ----------
class DocumentOut(BaseModel):
    id: str
    filename: str
    chunks: int
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
