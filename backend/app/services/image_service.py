import uuid
from datetime import datetime
from io import BytesIO
from pathlib import Path

import imagehash
from PIL import Image

from app.config import get_settings

settings = get_settings()

# Image size configurations
# Thumbnail: Used in cards/grids. 400px supports ~200px display on retina
# Medium: Used in detail views and outfit displays
# Original: Full resolution for zoom/download
SIZES = {
    "thumbnail": (400, 400),
    "medium": (800, 800),
    "original": (2400, 2400),
}

ALLOWED_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp", ".heic", ".heif"}
ALLOWED_MIME_TYPES = {
    "image/jpeg",
    "image/png",
    "image/webp",
    "image/heic",
    "image/heif",
}


class ImageService:
    def __init__(self, storage_path: str | None = None):
        self.storage_path = Path(storage_path or settings.storage_path)
        self.storage_path.mkdir(parents=True, exist_ok=True)

    def _get_user_path(self, user_id: uuid.UUID) -> Path:
        user_path = self.storage_path / str(user_id)
        user_path.mkdir(parents=True, exist_ok=True)
        return user_path

    def _generate_filename(self, extension: str = ".jpg") -> str:
        """Generate a unique filename."""
        timestamp = datetime.utcnow().strftime("%Y%m%d_%H%M%S")
        unique_id = uuid.uuid4().hex[:8]
        return f"{timestamp}_{unique_id}{extension}"

    def _convert_heic(self, image_data: bytes) -> Image.Image:
        """Convert HEIC/HEIF to PIL Image."""
        try:
            from pillow_heif import register_heif_opener

            register_heif_opener()
        except ImportError:
            pass

        return Image.open(BytesIO(image_data))

    def _resize_image(
        self,
        image: Image.Image,
        max_size: tuple[int, int],
        quality: int = 92,
    ) -> bytes:
        """Resize image maintaining aspect ratio."""
        if image.mode in ("RGBA", "P", "LA"):
            background = Image.new("RGB", image.size, (255, 255, 255))
            if image.mode == "P":
                image = image.convert("RGBA")
            background.paste(image, mask=image.split()[-1] if image.mode == "RGBA" else None)
            image = background
        elif image.mode != "RGB":
            image = image.convert("RGB")

        image.thumbnail(max_size, Image.Resampling.LANCZOS)

        output = BytesIO()
        image.save(output, format="JPEG", quality=quality, optimize=True)
        return output.getvalue()

    async def process_and_store(
        self,
        user_id: uuid.UUID,
        image_data: bytes,
        original_filename: str,
    ) -> dict[str, str]:
        """Process an uploaded image and store all sizes."""
        ext = Path(original_filename).suffix.lower()
        if ext not in ALLOWED_EXTENSIONS:
            raise ValueError(f"Unsupported file type: {ext}")

        if ext in (".heic", ".heif"):
            image = self._convert_heic(image_data)
        else:
            image = Image.open(BytesIO(image_data))

        base_filename = self._generate_filename(".jpg")
        base_name = base_filename.rsplit(".", 1)[0]

        user_path = self._get_user_path(user_id)
        paths = {}

        for size_name, max_size in SIZES.items():
            if size_name == "original":
                suffix = ""
                quality = 95
            elif size_name == "medium":
                suffix = "_medium"
                quality = 90
            else:
                suffix = "_thumb"
                quality = 88

            filename = f"{base_name}{suffix}.jpg"
            file_path = user_path / filename

            resized_data = self._resize_image(image.copy(), max_size, quality=quality)
            file_path.write_bytes(resized_data)
            paths[size_name] = f"{user_id}/{filename}"

        image_hash = self.compute_phash(image_data, original_filename)

        result = {
            "image_path": paths["original"],
            "medium_path": paths["medium"],
            "thumbnail_path": paths["thumbnail"],
            "image_hash": image_hash,
        }

        # Upload to OSS if configured
        oss_urls = self.upload_to_oss(paths, str(user_id))
        result.update(oss_urls)

        return result

    def get_image_path(self, relative_path: str) -> Path:
        """Full path for an image."""
        return self.storage_path / relative_path

    def delete_images(self, paths: dict[str, str | None]) -> None:
        """Delete all image files for an item."""
        for path in paths.values():
            if path:
                full_path = self.storage_path / path
                if full_path.exists():
                    full_path.unlink()

    def validate_image(self, image_data: bytes, content_type: str) -> bool:
        """Validate that the uploaded file is a supported image."""
        if content_type not in ALLOWED_MIME_TYPES:
            return False
        if len(image_data) > settings.max_upload_size_mb * 1024 * 1024:
            return False
        try:
            Image.open(BytesIO(image_data)).verify()
            return True
        except Exception:
            return False

    def upload_to_oss(self, paths: dict[str, str], user_id: str | None = None) -> dict[str, str]:
        """Upload stored images to Alibaba Cloud OSS and return public URLs.

        If OSS is not configured or upload fails, returns an empty dict gracefully.
        """
        from app.services.oss_service import get_oss_service

        oss = get_oss_service()
        if not oss:
            return {}

        uid = user_id or paths.get("image_path", "").split("/")[0]
        return oss.upload_image_sizes(
            user_id=uid,
            local_paths=paths,
            storage_path=str(self.storage_path),
        )

    def compute_phash(self, image_data: bytes, original_filename: str) -> str:
        """Compute perceptual hash for duplicate detection."""
        try:
            image = Image.open(BytesIO(image_data))
            if image.mode != "RGB":
                image = image.convert("RGB")
            phash = imagehash.phash(image)
            return str(phash)
        except Exception:
            return ""

    def compute_phash_from_path(self, image_path: Path) -> str:
        """Compute perceptual hash from a file path."""
        try:
            image = Image.open(image_path)
            if image.mode != "RGB":
                image = image.convert("RGB")
            return str(imagehash.phash(image))
        except Exception:
            return ""

    @staticmethod
    def hash_distance(hash1: str, hash2: str) -> int:
        """Compute Hamming distance between two pHash hex strings."""
        h1 = imagehash.hex_to_hash(hash1)
        h2 = imagehash.hex_to_hash(hash2)
        return h1 - h2

    @staticmethod
    def is_duplicate(hash1: str, hash2: str, threshold: int = 8) -> bool:
        """Check if two images are duplicates based on hash distance."""
        return ImageService.hash_distance(hash1, hash2) <= threshold

    async def process_and_store_png(
        self,
        user_id: uuid.UUID,
        image_data: bytes,
        original_filename: str = "segmented.png",
    ) -> dict[str, str]:
        """Process a transparent PNG and store all sizes.

        Unlike ``process_and_store`` this method preserves the RGBA / alpha
        channel so that the images remain suitable for virtual try-on.
        """
        image = Image.open(BytesIO(image_data))

        if image.mode != "RGBA":
            image = image.convert("RGBA")

        base_filename = self._generate_filename(".png")
        base_name = base_filename.rsplit(".", 1)[0]

        user_path = self._get_user_path(user_id)
        paths: dict[str, str] = {}

        for size_name, max_size in SIZES.items():
            if size_name == "original":
                suffix = ""
            elif size_name == "medium":
                suffix = "_medium"
            else:
                suffix = "_thumb"

            filename = f"{base_name}{suffix}.png"
            file_path = user_path / filename

            img_copy = image.copy()
            img_copy.thumbnail(max_size, Image.Resampling.LANCZOS)

            output = BytesIO()
            img_copy.save(output, format="PNG", optimize=True)
            file_path.write_bytes(output.getvalue())

            paths[size_name] = f"{user_id}/{filename}"

        hash_image = image.convert("RGB") if image.mode != "RGB" else image
        phash = imagehash.phash(hash_image)

        result = {
            "image_path": paths["original"],
            "medium_path": paths["medium"],
            "thumbnail_path": paths["thumbnail"],
            "image_hash": str(phash),
        }

        # Upload to OSS if configured
        oss_urls = self.upload_to_oss(paths, str(user_id))
        result.update(oss_urls)

        return result

    def remove_background(
        self,
        image_path: str,
        bg_color: tuple[int, int, int] = (255, 255, 255),
    ) -> dict[str, str]:
        from app.services.background_removal import get_provider

        base_path = image_path.rsplit(".", 1)[0]

        original_full = self.storage_path / image_path
        medium_path = f"{base_path}_medium.jpg"
        medium_full = self.storage_path / medium_path
        thumb_path = f"{base_path}_thumb.jpg"
        thumb_full = self.storage_path / thumb_path

        if not original_full.exists():
            raise ValueError(f"Image not found: {image_path}")

        image = Image.open(original_full).convert("RGB")
        provider = get_provider()
        result = provider.remove(image)

        background = Image.new("RGBA", result.size, (*bg_color, 255))
        background.paste(result, mask=result.split()[3])
        final = background.convert("RGB")

        for size_name, max_size in SIZES.items():
            if size_name == "original":
                file_path = original_full
                quality = 95
            elif size_name == "medium":
                file_path = medium_full
                quality = 90
            else:
                file_path = thumb_full
                quality = 88

            img_copy = final.copy()
            img_copy.thumbnail(max_size, Image.Resampling.LANCZOS)

            output = BytesIO()
            img_copy.save(output, format="JPEG", quality=quality, optimize=True)
            file_path.write_bytes(output.getvalue())

        return {
            "image_path": image_path,
            "medium_path": medium_path,
            "thumbnail_path": thumb_path,
        }

    def rotate_image(self, image_path: str, direction: str = "cw") -> dict[str, str]:
        """Rotate an image and regenerate all sizes."""
        base_path = image_path.rsplit(".", 1)[0]

        original_full = self.storage_path / image_path
        medium_path = f"{base_path}_medium.jpg"
        medium_full = self.storage_path / medium_path
        thumb_path = f"{base_path}_thumb.jpg"
        thumb_full = self.storage_path / thumb_path

        if not original_full.exists():
            raise ValueError(f"Image not found: {image_path}")

        angle = -90 if direction == "cw" else 90

        image = Image.open(original_full)

        if image.mode in ("RGBA", "P", "LA"):
            background = Image.new("RGB", image.size, (255, 255, 255))
            if image.mode == "P":
                image = image.convert("RGBA")
            background.paste(image, mask=image.split()[-1] if image.mode == "RGBA" else None)
            image = background
        elif image.mode != "RGB":
            image = image.convert("RGB")

        rotated = image.rotate(angle, expand=True)

        for size_name, max_size in SIZES.items():
            if size_name == "original":
                file_path = original_full
                quality = 95
            elif size_name == "medium":
                file_path = medium_full
                quality = 90
            else:
                file_path = thumb_full
                quality = 88

            img_copy = rotated.copy()
            img_copy.thumbnail(max_size, Image.Resampling.LANCZOS)

            output = BytesIO()
            img_copy.save(output, format="JPEG", quality=quality, optimize=True)
            file_path.write_bytes(output.getvalue())

        return {
            "image_path": image_path,
            "medium_path": medium_path,
            "thumbnail_path": thumb_path,
        }
