"""Community help request endpoints."""

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.database import get_db
from app.models.community import HelpReply, HelpRequest
from app.models.user import User
from app.schemas.community import (
    HelpReplyCreate,
    HelpReplyResponse,
    HelpRequestCreate,
    HelpRequestListResponse,
    HelpRequestResponse,
    HelpRequestUpdate,
)
from app.utils.auth import get_current_user

router = APIRouter(prefix="/community", tags=["Community"])


def _request_response(req: HelpRequest) -> HelpRequestResponse:
    return HelpRequestResponse(
        id=req.id,
        user_id=req.user_id,
        title=req.title,
        description=req.description,
        occasion=req.occasion,
        budget_range=req.budget_range,
        style_preference=req.style_preference,
        reference_image_urls=req.reference_image_urls,
        status=req.status,
        reply_count=req.reply_count,
        created_at=req.created_at,
        updated_at=req.updated_at,
        user_name=req.user.display_name if req.user else None,
        user_avatar=req.user.avatar_url if req.user else None,
    )


def _reply_response(reply: HelpReply) -> HelpReplyResponse:
    return HelpReplyResponse(
        id=reply.id,
        request_id=reply.request_id,
        user_id=reply.user_id,
        content=reply.content,
        suggested_items=reply.suggested_items,
        image_urls=reply.image_urls,
        is_accepted=reply.is_accepted,
        created_at=reply.created_at,
        user_name=reply.user.display_name if reply.user else None,
        user_avatar=reply.user.avatar_url if reply.user else None,
    )


# ===== Help Requests =====

@router.get("/help-requests", response_model=HelpRequestListResponse)
async def list_help_requests(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
    page: int = Query(1, ge=1),
    page_size: int = Query(10, ge=1, le=50),
    status_filter: str | None = Query(None, alias="status"),
) -> HelpRequestListResponse:
    """List help requests with pagination."""
    query = select(HelpRequest).options(selectinload(HelpRequest.user))

    if status_filter:
        query = query.where(HelpRequest.status == status_filter)

    # Count total
    count_query = select(func.count()).select_from(HelpRequest)
    if status_filter:
        count_query = count_query.where(HelpRequest.status == status_filter)
    total = (await db.execute(count_query)).scalar_one()

    # Fetch page
    query = (
        query
        .order_by(HelpRequest.created_at.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    )
    result = await db.execute(query)
    requests = list(result.scalars().all())

    return HelpRequestListResponse(
        items=[_request_response(r) for r in requests],
        total=total,
        page=page,
        page_size=page_size,
        has_more=(page * page_size) < total,
    )


@router.post("/help-requests", response_model=HelpRequestResponse, status_code=status.HTTP_201_CREATED)
async def create_help_request(
    data: HelpRequestCreate,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> HelpRequestResponse:
    """Create a new help request."""
    req = HelpRequest(
        user_id=current_user.id,
        title=data.title,
        description=data.description,
        occasion=data.occasion,
        budget_range=data.budget_range,
        style_preference=data.style_preference,
        reference_image_urls=data.reference_image_urls,
    )
    db.add(req)
    await db.flush()
    await db.refresh(req, ["user"])

    return _request_response(req)


@router.get("/help-requests/{request_id}", response_model=HelpRequestResponse)
async def get_help_request(
    request_id: str,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> HelpRequestResponse:
    """Get a single help request by ID."""
    result = await db.execute(
        select(HelpRequest)
        .options(selectinload(HelpRequest.user))
        .where(HelpRequest.id == request_id)
    )
    req = result.scalar_one_or_none()
    if not req:
        raise HTTPException(status_code=404, detail="Help request not found")

    return _request_response(req)


@router.patch("/help-requests/{request_id}", response_model=HelpRequestResponse)
async def update_help_request(
    request_id: str,
    data: HelpRequestUpdate,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> HelpRequestResponse:
    """Update a help request (owner only)."""
    result = await db.execute(
        select(HelpRequest)
        .options(selectinload(HelpRequest.user))
        .where(HelpRequest.id == request_id)
    )
    req = result.scalar_one_or_none()
    if not req:
        raise HTTPException(status_code=404, detail="Help request not found")
    if req.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="Not authorized to update this request")

    update_data = data.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(req, field, value)

    await db.flush()
    await db.refresh(req)

    return _request_response(req)


@router.delete("/help-requests/{request_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_help_request(
    request_id: str,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> None:
    """Delete a help request (owner only)."""
    result = await db.execute(
        select(HelpRequest).where(HelpRequest.id == request_id)
    )
    req = result.scalar_one_or_none()
    if not req:
        raise HTTPException(status_code=404, detail="Help request not found")
    if req.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="Not authorized to delete this request")

    await db.delete(req)


# ===== Replies =====

@router.get("/help-requests/{request_id}/replies", response_model=list[HelpReplyResponse])
async def list_replies(
    request_id: str,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> list[HelpReplyResponse]:
    """List all replies for a help request."""
    # Verify request exists
    req_result = await db.execute(
        select(HelpRequest.id).where(HelpRequest.id == request_id)
    )
    if not req_result.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Help request not found")

    result = await db.execute(
        select(HelpReply)
        .options(selectinload(HelpReply.user))
        .where(HelpReply.request_id == request_id)
        .order_by(HelpReply.created_at.asc())
    )
    replies = list(result.scalars().all())

    return [_reply_response(r) for r in replies]


@router.post("/help-requests/{request_id}/replies", response_model=HelpReplyResponse, status_code=status.HTTP_201_CREATED)
async def create_reply(
    request_id: str,
    data: HelpReplyCreate,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> HelpReplyResponse:
    """Create a reply to a help request."""
    # Verify request exists and is open
    req_result = await db.execute(
        select(HelpRequest).where(HelpRequest.id == request_id)
    )
    req = req_result.scalar_one_or_none()
    if not req:
        raise HTTPException(status_code=404, detail="Help request not found")
    if req.status == "closed":
        raise HTTPException(status_code=400, detail="This request is closed for replies")

    reply = HelpReply(
        request_id=req.id,
        user_id=current_user.id,
        content=data.content,
        suggested_items=data.suggested_items,
        image_urls=data.image_urls,
    )
    db.add(reply)

    # Increment reply count
    req.reply_count = (req.reply_count or 0) + 1
    if req.status == "open":
        req.status = "in_progress"

    await db.flush()
    await db.refresh(reply, ["user"])

    return _reply_response(reply)


@router.post("/help-replies/{reply_id}/accept", response_model=HelpReplyResponse)
async def accept_reply(
    reply_id: str,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> HelpReplyResponse:
    """Accept a reply as the best answer (request owner only)."""
    result = await db.execute(
        select(HelpReply)
        .options(selectinload(HelpReply.user), selectinload(HelpReply.request))
        .where(HelpReply.id == reply_id)
    )
    reply = result.scalar_one_or_none()
    if not reply:
        raise HTTPException(status_code=404, detail="Reply not found")
    if reply.request.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="Only the request owner can accept a reply")

    reply.is_accepted = True
    reply.request.status = "resolved"

    await db.flush()
    await db.refresh(reply)

    return _reply_response(reply)


# ===== Community Posts (stub — returns empty until full implementation) =====

class PostResponse(BaseModel):
    id: str
    user_id: str
    content: str
    image_urls: list[str] = []
    like_count: int = 0
    is_liked_by_me: bool = False
    created_at: str
    user_name: str | None = None
    user_avatar: str | None = None


class PostListResponse(BaseModel):
    items: list[PostResponse]
    total: int
    page: int
    page_size: int
    has_more: bool


@router.get("/posts", response_model=PostListResponse)
async def list_posts(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=50),
) -> PostListResponse:
    """List community posts (stub — returns empty for now)."""
    return PostListResponse(items=[], total=0, page=page, page_size=page_size, has_more=False)


@router.post("/posts/{post_id}/like", status_code=status.HTTP_200_OK)
async def like_post(
    post_id: str,
    current_user: Annotated[User, Depends(get_current_user)],
) -> dict:
    """Like a community post (stub)."""
    return {"status": "ok"}


@router.delete("/posts/{post_id}/like", status_code=status.HTTP_200_OK)
async def unlike_post(
    post_id: str,
    current_user: Annotated[User, Depends(get_current_user)],
) -> dict:
    """Unlike a community post (stub)."""
    return {"status": "ok"}
