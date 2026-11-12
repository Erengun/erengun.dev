#!/bin/sh
# Subset OffBit-DotBold (source TTF kept here, outside public/) to Latin + Turkish + the punctuation the site uses,
# and write the served WOFF2. Needs fonttools + brotli (pip install fonttools brotli, e.g. in a scratch venv):
#   PY=/path/to/venv/bin/python sh tools/fonts/subset.sh
set -e
cd "$(dirname "$0")/../.."
PY="${PY:-python3}"
# Basic Latin, Latin-1 Supplement (incl. © × Ö ü § …), Turkish Ğğ İı Şş, dashes/quotes/bullet/ellipsis,
# ‹› ‰ €, ™ №, arrows
UNICODES="U+0020-007E,U+00A0-00FF,U+011E-011F,U+0130-0131,U+015E-015F,U+2010-2027,U+2030,U+2039-203A,U+20AC,U+2116,U+2122,U+2190-2193"
"$PY" -I -m fontTools.subset tools/fonts/OffBit-DotBold.ttf \
  --unicodes="$UNICODES" --layout-features='*' --flavor=woff2 \
  --output-file=public/fonts/OffBit-DotBold.subset.woff2
ls -la public/fonts/OffBit-DotBold.subset.woff2
