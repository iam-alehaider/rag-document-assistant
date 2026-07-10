import uuid

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request, UploadFile, File
from sqlalchemy.orm import Session

from app.auth import get_current_user
from app.config import get_settings
from app.db import get_db, Document, User
from app.models import DocumentOut
from app.rag.ingest import process_document_background
from app.rag.vectorstore import delete_document as vs_delete
from app.rate_limit import limiter

settings = get_settings()
router = APIRouter(prefix="/documents", tags=["documents"])

ALLOWED_EXTENSIONS = {".pdf", ".txt", ".md"}
MAX_FILE_SIZE_MB = 20


@router.post("", response_model=DocumentOut, status_code=202)
@limiter.limit(settings.RATE_LIMIT_DEFAULT)
async def upload_document(
    request: Request,
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    ext = "." + file.filename.rsplit(".", 1)[-1].lower() if "." in file.filename else ""
    if ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(400, f"Unsupported file type. Allowed: {ALLOWED_EXTENSIONS}")

    file_bytes = await file.read()
    if len(file_bytes) > MAX_FILE_SIZE_MB * 1024 * 1024:
        raise HTTPException(400, f"File too large. Max {MAX_FILE_SIZE_MB}MB")

    document_id = str(uuid.uuid4())
    doc = Document(id=document_id, owner_id=user.id, filename=file.filename, chunks=0, status="processing")
    db.add(doc)
    db.commit()
    db.refresh(doc)

    # Embedding/indexing happens after the response is sent - upload feels
    # instant, the frontend polls GET /documents to see status flip to "ready".
    background_tasks.add_task(process_document_background, file_bytes, file.filename, user.id, document_id)

    return doc


@router.get("", response_model=list[DocumentOut])
def list_documents(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    return db.query(Document).filter(Document.owner_id == user.id).order_by(Document.uploaded_at.desc()).all()


@router.delete("/{document_id}", status_code=204)
def delete_document(document_id: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    doc = db.query(Document).filter(Document.id == document_id, Document.owner_id == user.id).first()
    if not doc:
        raise HTTPException(404, "Document not found")
    vs_delete(document_id, user.id)
    db.delete(doc)
    db.commit()
