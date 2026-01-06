#!/bin/bash
# SVGからPNGアイコンを生成（要: ImageMagick or rsvg-convert）

if command -v rsvg-convert &> /dev/null; then
    # rsvg-convertを使用
    rsvg-convert -w 180 -h 180 favicon.svg -o apple-touch-icon.png
    echo "apple-touch-icon.png created with rsvg-convert"
elif command -v convert &> /dev/null; then
    # ImageMagickを使用
    convert -background none -resize 180x180 favicon.svg apple-touch-icon.png
    echo "apple-touch-icon.png created with ImageMagick"
else
    echo "Error: rsvg-convert or ImageMagick is required"
    echo "Install with: brew install librsvg"
    echo "Or: brew install imagemagick"
    exit 1
fi
