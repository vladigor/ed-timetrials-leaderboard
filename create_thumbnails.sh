#!/bin/bash

# Script to create thumbnail versions of race maps
# Thumbnails are created in maps/thumbnails/ directory

# Configuration
MAPS_DIR="maps"
THUMBNAILS_DIR="maps/thumbnails"
THUMBNAIL_HEIGHT=190  # Height in pixels for thumbnails

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Ensure thumbnails directory exists
mkdir -p "$THUMBNAILS_DIR"

# Check if ImageMagick is installed
if ! command -v convert &> /dev/null; then
    echo "Error: ImageMagick is not installed. Please install it first:"
    echo "  Ubuntu/Debian: sudo apt-get install imagemagick"
    echo "  RHEL/CentOS: sudo yum install imagemagick"
    exit 1
fi

echo "Creating thumbnails for race maps..."
echo "Thumbnail height: ${THUMBNAIL_HEIGHT}px"
echo ""

# Counter for statistics
created=0
skipped=0

# Process all image files in maps directory
# Loop through each extension to avoid shell expansion issues
for ext in png jpg jpeg webp gif; do
    for image in "$MAPS_DIR"/*."$ext"; do
        # Skip if no files match (literal glob pattern)
        [ -e "$image" ] || continue

    # Skip if it's the maps.json file or a directory
    [ -f "$image" ] || continue

    # Get the filename without path
    filename=$(basename "$image")

    # Skip if already a thumbnail path (shouldn't happen but just in case)
    if [[ "$filename" == "thumbnails" ]]; then
        continue
    fi

    # Define thumbnail path
    thumbnail="$THUMBNAILS_DIR/$filename"

    # Check if thumbnail already exists
    if [ -f "$thumbnail" ]; then
        echo -e "${YELLOW}⊘${NC} Skipping $filename (thumbnail already exists)"
        ((skipped++))
        continue
    fi

    # Create thumbnail
    echo -e "${GREEN}✓${NC} Creating thumbnail for $filename"

    # Use ImageMagick to resize image
    # -thumbnail is faster than -resize for creating smaller images
    # x${THUMBNAIL_HEIGHT} sets fixed height, width adjusts to maintain aspect ratio
    # -quality 85 ensures good quality for JPEG/WebP output
    # -strip removes EXIF data to reduce file size
    convert "$image" -thumbnail "x${THUMBNAIL_HEIGHT}" -quality 85 -strip "$thumbnail"

    if [ $? -eq 0 ]; then
        ((created++))
    else
        echo "  Error creating thumbnail for $filename"
    fi
    done
done

echo ""
echo "======================================"
echo "Thumbnail generation complete!"
echo "Created: $created"
echo "Skipped: $skipped"
echo "======================================"
