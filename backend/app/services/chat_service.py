import logging
import re
from datetime import UTC, datetime, timedelta
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.chat import ChatMessage, ChatSession
from app.models.item import ClothingItem
from app.models.outfit import Outfit, OutfitItem, OutfitStatus
from app.models.user import User
from app.services.ai_service import AIService
from app.services.weather_service import WeatherService, WeatherServiceError
from app.utils.prompts import load_prompt

logger = logging.getLogger(__name__)

CHAT_PROMPT_TEMPLATE = load_prompt("chat_stylist")


class ChatService:
    def __init__(self, db: AsyncSession):
        self.db = db

    async def create_session(
        self, user: User, title: str | None = None, context: dict | None = None
    ) -> ChatSession:
        session = ChatSession(
            user_id=user.id,
            title=title or "新对话",
            context=context or {},
        )
        self.db.add(session)
        await self.db.flush()
        await self.db.refresh(session)
        return session

    async def get_sessions(self, user_id: UUID, limit: int = 20) -> tuple[list[ChatSession], int]:
        count_q = (
            select(func.count()).select_from(ChatSession).where(ChatSession.user_id == user_id)
        )
        total = (await self.db.execute(count_q)).scalar() or 0

        q = (
            select(ChatSession)
            .where(ChatSession.user_id == user_id)
            .order_by(ChatSession.updated_at.desc())
            .limit(limit)
        )
        result = await self.db.execute(q)
        return list(result.scalars().all()), total

    async def get_session(self, session_id: UUID, user_id: UUID) -> ChatSession | None:
        q = (
            select(ChatSession)
            .where(ChatSession.id == session_id, ChatSession.user_id == user_id)
            .options(selectinload(ChatSession.messages))
        )
        result = await self.db.execute(q)
        return result.scalar_one_or_none()

    async def get_messages(self, session_id: UUID, limit: int = 50) -> list[ChatMessage]:
        q = (
            select(ChatMessage)
            .where(ChatMessage.session_id == session_id)
            .order_by(ChatMessage.created_at.asc())
            .limit(limit)
        )
        result = await self.db.execute(q)
        return list(result.scalars().all())

    async def send_message(self, session: ChatSession, user: User, content: str) -> ChatMessage:
        """Send a user message and get AI response."""
        # Save user message
        user_msg = ChatMessage(session_id=session.id, role="user", content=content)
        self.db.add(user_msg)
        await self.db.flush()

        # Build context for AI
        system_prompt = await self._build_system_prompt(user)

        # Get recent conversation history
        history = await self.get_messages(session.id, limit=20)

        # Build full messages array with conversation history
        messages = [{"role": "system", "content": system_prompt}]
        for msg in history:
            messages.append({"role": msg.role, "content": msg.content})

        # Call AI with full conversation history
        ai_service = AIService()
        try:
            ai_content = await ai_service.chat_completion(messages)
        except Exception as e:
            logger.error(f"Chat AI error: {e}")
            ai_content = "抱歉，我暂时无法回复。请稍后再试。"

        # Parse outfit suggestions from response
        outfit_suggestions = self._parse_outfits(ai_content)
        # Clean the content (remove structured markers for display)
        clean_content = self._clean_outfit_markers(ai_content)

        # Check for confirmation
        confirmed_match = re.search(r"\[CONFIRMED:(\d+)\]", ai_content)

        # Save AI message
        ai_msg = ChatMessage(
            session_id=session.id,
            role="assistant",
            content=clean_content,
            extra_metadata={
                "outfit_suggestions": outfit_suggestions,
                "confirmed_index": int(confirmed_match.group(1)) if confirmed_match else None,
            },
        )
        self.db.add(ai_msg)

        # Update session timestamp
        session.updated_at = datetime.now(UTC)

        await self.db.flush()
        await self.db.refresh(ai_msg)
        return ai_msg

    async def _build_system_prompt(self, user: User) -> str:
        """Build the full system prompt with user context."""
        # User profile
        prefs = user.preferences
        profile_parts = []
        if prefs:
            if prefs.gender:
                profile_parts.append(f"- 性别：{prefs.gender}")
            if prefs.age_range:
                profile_parts.append(f"- 年龄段：{prefs.age_range}")
            if prefs.height_cm:
                profile_parts.append(f"- 身高：{prefs.height_cm}cm")
            if prefs.weight_kg:
                profile_parts.append(f"- 体重：{prefs.weight_kg}kg")
            if prefs.body_type:
                profile_parts.append(f"- 体型：{prefs.body_type}")
            if prefs.style_identity:
                profile_parts.append(f"- 风格偏好：{', '.join(prefs.style_identity)}")
            if prefs.body_concerns:
                profile_parts.append(f"- 身材关注：{', '.join(prefs.body_concerns)}")
            if prefs.profession_scene:
                profile_parts.append(f"- 职业场景：{prefs.profession_scene}")
            if prefs.color_favorites:
                profile_parts.append(f"- 喜欢的颜色：{', '.join(prefs.color_favorites)}")
            if prefs.temperature_sensitivity:
                profile_parts.append(f"- 温度敏感度：{prefs.temperature_sensitivity}")
        user_profile = "\n".join(profile_parts) if profile_parts else "暂无用户画像数据"

        # Weather - fetch real weather data for user's location
        environment = "暂无天气数据"
        if user.location_lat and user.location_lon:
            try:
                weather_service = WeatherService()
                weather = await weather_service.get_current_weather(
                    float(user.location_lat), float(user.location_lon)
                )
                environment = (
                    f"当前天气：{weather.condition}，"
                    f"温度 {weather.temperature}°C（体感 {weather.feels_like}°C），"
                    f"湿度 {weather.humidity}%，"
                    f"降水概率 {weather.precipitation_chance}%，"
                    f"风速 {weather.wind_speed}km/h"
                )
            except (WeatherServiceError, Exception) as e:
                logger.warning(f"Failed to fetch weather for chat: {e}")

        # Available items
        items_q = (
            select(ClothingItem)
            .where(ClothingItem.user_id == user.id, ClothingItem.status == "ready")
            .order_by(ClothingItem.type)
            .limit(50)
        )
        items_result = await self.db.execute(items_q)
        items = list(items_result.scalars().all())
        items_list = self._format_items(items)

        # Recent outfits (last 7 days)
        seven_days_ago = datetime.now(UTC) - timedelta(days=7)
        recent_q = (
            select(Outfit)
            .where(
                Outfit.user_id == user.id,
                Outfit.status == OutfitStatus.accepted,
                Outfit.created_at >= seven_days_ago,
            )
            .options(selectinload(Outfit.items).selectinload(OutfitItem.item))
            .order_by(Outfit.created_at.desc())
            .limit(7)
        )
        recent_result = await self.db.execute(recent_q)
        recent_outfits = list(recent_result.scalars().all())
        recent_text = self._format_recent_outfits(recent_outfits)

        prompt = CHAT_PROMPT_TEMPLATE.format(
            user_profile=user_profile,
            environment=environment,
            item_count=len(items),
            items_list=items_list,
            recent_outfits=recent_text,
        )
        return prompt

    def _format_items(self, items: list[ClothingItem]) -> str:
        if not items:
            return "暂无衣物"
        lines = []
        for i, item in enumerate(items, 1):
            name = item.name or item.type or "未知"
            color = item.primary_color or ""
            brand = f" ({item.brand})" if item.brand else ""
            lines.append(f"{i}. [{str(item.id)[:8]}] {name} - {color}{brand}")
        return "\n".join(lines)

    def _format_recent_outfits(self, outfits: list[Outfit]) -> str:
        if not outfits:
            return "暂无近期穿搭记录"
        lines = []
        for outfit in outfits:
            date = outfit.scheduled_for or outfit.created_at.strftime("%Y-%m-%d")
            item_names = []
            for oi in outfit.items:
                item_names.append(oi.item.name or oi.item.type or "未知")
            lines.append(f"- {date}: {', '.join(item_names)}")
        return "\n".join(lines)

    def _parse_outfits(self, content: str) -> list[dict]:
        """Parse <<<OUTFIT>>> blocks from AI response.

        Handles various formats the AI might output:
        - <<<OUTFIT>>>...<<<END>>>
        - <<<OUTFIT>>>...<<<>>>
        - ** <<<OUTFIT>>> **...** <<<END>>> **
        """
        outfits = []
        # More flexible pattern: match <<<OUTFIT>>> followed by any content until <<<END>>> or <<<>>>
        pattern = r"<<<\s*OUTFIT\s*>>>(.*?)(?:<<<\s*(?:END)?\s*>>>)"
        matches = re.findall(pattern, content, re.DOTALL)
        for match in matches:
            outfit = {}
            for line in match.strip().split("\n"):
                line = line.strip().lstrip("*").strip()
                if line.lower().startswith("headline:"):
                    outfit["headline"] = line.split(":", 1)[1].strip()
                elif line.lower().startswith("items:"):
                    item_str = line.split(":", 1)[1].strip()
                    outfit["items"] = [x.strip().rstrip("*").strip() for x in item_str.split(",")]
                elif line.lower().startswith("reasoning:"):
                    outfit["reasoning"] = line.split(":", 1)[1].strip()
            if outfit.get("items"):
                outfits.append(outfit)
        return outfits

    def _clean_outfit_markers(self, content: str) -> str:
        """Remove <<<OUTFIT>>>...<<<END>>> (or <<<>>>) blocks from display content."""
        # Remove the structured blocks
        cleaned = re.sub(r"<<<\s*OUTFIT\s*>>>.+?<<<\s*(?:END)?\s*>>>", "", content, flags=re.DOTALL)
        # Also remove any remaining standalone reasoning/items/headline lines that leaked
        cleaned = re.sub(r"^(?:items|reasoning|headline):.*$", "", cleaned, flags=re.MULTILINE)
        return cleaned.strip()
