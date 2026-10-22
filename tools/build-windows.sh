#!/usr/bin/env bash
# 윈도우 노트북용 압축 파일 만들기: 윈도우용 Node.js + 게임 + 부품을 한 폴더에 담는다.
# 사용법: bash tools/build-windows.sh   ->  dist/classroom-battle-windows.zip
set -euo pipefail
NODE_VERSION="${NODE_VERSION:-22.22.0}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/dist"
WORK="$OUT/classroom-battle"
CACHE="$OUT/cache"
mkdir -p "$CACHE"
rm -rf "$WORK" "$OUT/classroom-battle-windows.zip"
mkdir -p "$WORK/app" "$WORK/node"

# 1) 윈도우용 Node.js (node.exe만 쓴다), 체크섬 확인
ZIP="node-v$NODE_VERSION-win-x64.zip"
if [ ! -f "$CACHE/$ZIP" ]; then
  curl -fsSL -o "$CACHE/$ZIP" "https://nodejs.org/dist/v$NODE_VERSION/$ZIP"
  curl -fsSL -o "$CACHE/SHASUMS256-$NODE_VERSION.txt" "https://nodejs.org/dist/v$NODE_VERSION/SHASUMS256.txt"
fi
(cd "$CACHE" && grep " $ZIP\$" "SHASUMS256-$NODE_VERSION.txt" | sha256sum -c -)
unzip -q -j -o "$CACHE/$ZIP" "node-v$NODE_VERSION-win-x64/node.exe" -d "$WORK/node"

# 2) 게임 파일과 실행에 필요한 부품만 (개발용 부품 제외)
cp -r "$ROOT/server.js" "$ROOT/game.js" "$ROOT/ghost.js" "$ROOT/package.json" "$ROOT/package-lock.json" "$ROOT/public" "$WORK/app/"
(cd "$WORK/app" && npm ci --omit=dev --no-audit --no-fund --ignore-scripts > /dev/null)

# 3) 실행 파일과 안내문
cp "$ROOT/windows/Start-Game.bat" "$ROOT/windows/읽어주세요.txt" "$WORK/"

# 4) 압축 (한글 파일 이름이 윈도우에서 깨지지 않게 UTF-8 표시를 넣는 파이썬 zipfile 사용)
python3 - "$WORK" "$OUT/classroom-battle-windows.zip" <<'PY'
import os, sys, zipfile
src, dst = sys.argv[1], sys.argv[2]
base = os.path.dirname(src)
with zipfile.ZipFile(dst, 'w', zipfile.ZIP_DEFLATED, compresslevel=9) as z:
    for d, _, files in os.walk(src):
        for f in files:
            p = os.path.join(d, f)
            z.write(p, os.path.relpath(p, base))
PY
echo "완성: $OUT/classroom-battle-windows.zip ($(du -h "$OUT/classroom-battle-windows.zip" | cut -f1))"
