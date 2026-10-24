#!/usr/bin/env python3
"""
Regenerate thumbnails for all existing items.

Usage:
    docker compose exec backend python scripts/regenerate_thumbnails.py

Or in production:
    docker compose exec backend python scripts/regenerate_thumbnails.py
"""

import asyncio
import sys
from io import BytesIO
from pathlib import Path

# Add parent to path for imports
sys.path.insert(0, str(Path(__file__).parent.parent))

from PIL import Image
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine
from sqlalchemy.orm import sessionmaker

from app.config import get_settings
from app.models.item import ClothingItem

# New sizes (must match image_service.py)
SIZES = {
    "thumbnail": (400, 400),
    "medium": (800, 800),
}

QUALITY = {
    "thumbnail": 88,
    "medium": 90,
}


def resize_image(image: Image.Image, max_size: tuple[int, int], quality: int) -> bytes:
    """Resize image maintaining aspect ratio."""
    img = image.copy()

    # Convert to RGB if necessary
    if img.mode in ("RGBA", "P", "LA"):
        background = Image.new("RGB", img.size, (255, 255, 255))
        if img.mode == "P":
            img = img.convert("RGBA")
        background.paste(img, mask=img.split()[-1] if img.mode == "RGBA" else None)
        img = background
    elif img.mode != "RGB":
        img = img.convert("RGB")

    # Resize maintaining aspect ratio
    img.thumbnail(max_size, Image.Resampling.LANCZOS)

    # Save to bytes
    output = BytesIO()
    img.save(output, format="JPEG", quality=quality, optimize=True)
    return output.getvalue()


async def regenerate_all():
    """Regenerate thumbnails for all items."""
    settings = get_settings()
    storage_path = Path(settings.storage_path)

    # Create async engine
    engine = create_async_engine(str(settings.database_url))
    async_session = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

    async with async_session() as db:
        # Get all items with images
        result = await db.execute(select(ClothingItem).where(ClothingItem.image_path.isnot(None)))
        items = result.scalars().all()

        print(f"Found {len(items)} items to process")

        success = 0
        skipped = 0
        failed = 0

        for item in items:
            try:
                # Get original image path
                original_path = storage_path / item.image_path

                if not original_path.exists():
                    print(f"  [{item.id}] Original not found: {item.image_path}")
                    skipped += 1
                    continue

                # Load original image
                image = Image.open(original_path)

                # Get base path for derived images
                base_path = original_path.parent
                base_name = original_path.stem.replace("_medium", "").replace("_thumb", "")

                # Regenerate thumbnail
                thumb_path = base_path / f"{base_name}_thumb.jpg"
                thumb_data = resize_image(image, SIZES["thumbnail"], QUALITY["thumbnail"])
                thumb_path.write_bytes(thumb_data)

                # Regenerate medium
                medium_path = base_path / f"{base_name}_medium.jpg"
                medium_data = resize_image(image, SIZES["medium"], QUALITY["medium"])
                medium_path.write_bytes(medium_data)

                print(f"  [{item.id}] Regenerated: {item.name or 'unnamed'}")
                success += 1

            except Exception as e:
                print(f"  [{item.id}] Error: {e}")
                failed += 1

        print(f"\nDone! Success: {success}, Skipped: {skipped}, Failed: {failed}")

    await engine.dispose()


if __name__ == "__main__":
    print("Regenerating thumbnails with new sizes...")
    print(f"  Thumbnail: {SIZES['thumbnail']} @ q{QUALITY['thumbnail']}")
    print(f"  Medium: {SIZES['medium']} @ q{QUALITY['medium']}")
    print()

    asyncio.run(regenerate_all())
