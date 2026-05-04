"""Media utilities for handling image uploads and thumbnail generation."""

from __future__ import annotations

import asyncio
import json
import logging
from pathlib import Path

from fastapi import UploadFile

log = logging.getLogger(__name__)

ALLOWED_EXTENSIONS = {".png", ".jpg", ".jpeg", ".webp", ".gif"}


async def save_uploaded_image(upload_file: UploadFile, maps_dir: Path) -> Path:
    """
    Save an uploaded image to the maps directory.

    Args:
        upload_file: The uploaded file from FastAPI
        maps_dir: The target directory to save the image

    Returns:
        Path to the saved image file

    Raises:
        ValueError: If the file extension is not allowed
    """
    if not upload_file.filename:
        raise ValueError("No filename provided")

    # Validate file extension
    file_ext = Path(upload_file.filename).suffix.lower()
    if file_ext not in ALLOWED_EXTENSIONS:
        raise ValueError(f"File extension {file_ext} not allowed. Allowed: {ALLOWED_EXTENSIONS}")

    # Create a safe filename (avoid overwriting existing files)
    base_name = Path(upload_file.filename).stem
    target_path = maps_dir / upload_file.filename
    counter = 1
    while target_path.exists():
        target_path = maps_dir / f"{base_name}_{counter}{file_ext}"
        counter += 1

    # Save the file
    content = await upload_file.read()
    target_path.write_bytes(content)

    log.info("Saved uploaded image to %s", target_path)
    return target_path


async def generate_thumbnail(image_path: Path, thumbnails_dir: Path) -> Path:
    """
    Generate a thumbnail for the given image using ImageMagick.

    Args:
        image_path: Path to the source image
        thumbnails_dir: Directory where thumbnails should be saved

    Returns:
        Path to the generated thumbnail

    Raises:
        RuntimeError: If ImageMagick is not available or thumbnail generation fails
    """
    thumbnails_dir.mkdir(exist_ok=True)

    thumbnail_path = thumbnails_dir / image_path.name
    thumbnail_height = 190

    # Use ImageMagick to create thumbnail
    # -thumbnail is faster than -resize for smaller images
    # x{height} sets fixed height, width adjusts to maintain aspect ratio
    # -quality 85 ensures good quality
    # -strip removes EXIF data to reduce file size
    cmd = [
        "convert",
        str(image_path),
        "-thumbnail",
        f"x{thumbnail_height}",
        "-quality",
        "85",
        "-strip",
        str(thumbnail_path),
    ]

    try:
        process = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, stderr = await process.communicate()

        if process.returncode != 0:
            error_msg = stderr.decode() if stderr else "Unknown error"
            raise RuntimeError(f"ImageMagick failed: {error_msg}")

        log.info("Generated thumbnail at %s", thumbnail_path)
        return thumbnail_path

    except FileNotFoundError as exc:
        raise RuntimeError(
            "ImageMagick (convert) not found. Please install it: "
            "Ubuntu/Debian: sudo apt-get install imagemagick"
        ) from exc


def update_media_json(race_key: str, media_entry: dict) -> None:
    """
    Update media.json with new or updated media entry for a race.

    Args:
        race_key: The race key to update
        media_entry: The media data to add/update (contains 'map' and/or 'links')
    """
    media_file = Path(__file__).parent.parent / "media.json"

    # Load existing media data
    if media_file.exists():
        with open(media_file) as f:
            media_data = json.load(f)
    else:
        media_data = {}

    # Update or create entry for this race
    if race_key in media_data:
        # Merge with existing entry
        existing = media_data[race_key]
        if "map" in media_entry:
            existing["map"] = media_entry["map"]
        if "links" in media_entry:
            # Append new links to existing links
            existing_links = existing.get("links", [])
            existing_links.extend(media_entry["links"])
            existing["links"] = existing_links
    else:
        media_data[race_key] = media_entry

    # Write back to file with pretty formatting
    with open(media_file, "w") as f:
        json.dump(media_data, f, indent=2, ensure_ascii=False)
        f.write("\n")  # Add newline at end of file

    log.info("Updated media.json for race %s", race_key)
