#!/usr/bin/env bash
# Adds synthetic capture time + GPS to the trip set (stock media has none),
# and creates deliberate blurry and near-duplicate shots for filtering tests.
set -euo pipefail
cd "$(dirname "$0")/../samples/trip"

gps() { case "$1" in
  tokyo) echo "35.6595 139.7005" ;;   # Shibuya
  kyoto) echo "34.9671 135.7727" ;;   # Fushimi Inari
  osaka) echo "34.6687 135.5013" ;;   # Dotonbori
esac; }

make_variants() {
  local src src2
  src=$(ls d03-*photo-*.jpg | grep -v -e -blurry -e -burst | head -1)
  src2=$(ls d06-*photo-*.jpg | grep -v -e -blurry -e -burst | head -1)
  [ -f "${src%.jpg}-blurry.jpg" ] || ffmpeg -loglevel error -y -i "$src" -vf "gblur=sigma=12" -q:v 3 "${src%.jpg}-blurry.jpg"
  [ -f "${src2%.jpg}-burst2.jpg" ] || ffmpeg -loglevel error -y -i "$src2" -vf "crop=iw*0.97:ih*0.97,scale=iw/0.97:ih/0.97" -q:v 3 "${src2%.jpg}-burst2.jpg"
  [ -f "${src2%.jpg}-burst3.jpg" ] || ffmpeg -loglevel error -y -i "$src2" -vf "eq=brightness=0.04" -q:v 3 "${src2%.jpg}-burst3.jpg"
}
make_variants

i=0
for f in $(ls d*-*.{jpg,mp4} | sort); do
  day=$((10#${f:1:2})); place=$(echo "$f" | cut -d- -f2)
  read -r lat lon <<<"$(gps "$place")"
  # jitter position ~ up to 1km and time 09:00-20:59 so shots in a day are ordered but distinct
  jlat=$(awk -v a="$lat" -v s="$i" 'BEGIN{srand(s); printf "%.5f", a+(rand()-0.5)*0.02}')
  jlon=$(awk -v a="$lon" -v s="$((i+99))" 'BEGIN{srand(s); printf "%.5f", a+(rand()-0.5)*0.02}')
  hour=$((9 + (i * 7) % 12)); minute=$(( (i * 13) % 60 ))
  ts=$(printf "2026:04:%02d %02d:%02d:00" "$day" "$hour" "$minute")
  case "$f" in *-burst?.jpg) continue ;; esac
  if [[ "$f" == *.jpg ]]; then
    exiftool -q -overwrite_original -DateTimeOriginal="$ts" -OffsetTimeOriginal="+09:00" \
      -GPSLatitude="$jlat" -GPSLatitudeRef=N -GPSLongitude="$jlon" -GPSLongitudeRef=E \
      -Make=Apple -Model="iPhone 16 Pro" "$f"
  else
    # Pexels serves fragmented MP4s, which exiftool cannot write; remux to a regular MP4 first.
    ffmpeg -loglevel error -y -i "$f" -c copy -movflags +faststart "$f.tmp.mp4" && mv "$f.tmp.mp4" "$f"
    exiftool -q -overwrite_original -api QuickTimeUTC -CreateDate="$ts+09:00" -MediaCreateDate="$ts+09:00" \
      -Keys:GPSCoordinates="$jlat, $jlon" -Keys:Make=Apple -Keys:Model="iPhone 16 Pro" "$f"
  fi
  i=$((i+1))
done
# Burst frames share the original's place and are taken 1-2 seconds after it.
for b in *-burst?.jpg; do
  orig="${b%-burst?.jpg}.jpg"; n="${b: -5:1}"
  exiftool -q -overwrite_original -tagsFromFile "$orig" -all:all "$b"
  exiftool -q -overwrite_original "-DateTimeOriginal+=0:0:0 0:0:$((n-1))" "$b"
done
echo "stamped $i files"
