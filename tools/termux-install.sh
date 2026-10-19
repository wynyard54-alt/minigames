#!/data/data/com.termux/files/usr/bin/bash
# 갤럭시(안드로이드) Termux에서 교실 배틀 게임 서버 설치하기
# 사용법 (Termux에 붙여넣기):
#   curl -fsSL https://raw.githubusercontent.com/wynyard54-alt/minigames/HEAD/tools/termux-install.sh | bash
# 설치가 끝나면 앞으로는 battle 만 입력하면 서버가 켜진다. 최신 버전으로 바꾸려면 battle update
set -e

REPO="wynyard54-alt/minigames"
APP="$HOME/classroom-battle"
PREFIX="${PREFIX:-/data/data/com.termux/files/usr}"
SRC="${BATTLE_SRC:-https://github.com/$REPO/archive/HEAD.tar.gz}"
INSTALLER="https://raw.githubusercontent.com/$REPO/HEAD/tools/termux-install.sh"

say() { printf '\n\033[1;33m%s\033[0m\n' "$1"; }

say "1/4 필요한 프로그램을 설치해요 (처음에는 몇 분 걸릴 수 있어요)"
if [ -z "$SKIP_PKG" ]; then
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -y || true
  need=""
  command -v node > /dev/null || need="$need nodejs-lts"
  command -v ifconfig > /dev/null || need="$need net-tools"
  if [ -n "$need" ]; then
    # 처음 설치한 Termux는 기본 부품이 오래돼서 설치가 실패할 수 있다 -> 전체 업데이트 후 다시 시도
    apt-get install -y -o Dpkg::Options::=--force-confnew $need ||
      { yes | pkg upgrade -y -o Dpkg::Options::=--force-confnew && apt-get install -y -o Dpkg::Options::=--force-confnew $need; }
  fi
fi
node -v > /dev/null || { echo "Node.js 설치에 실패했어요. 인터넷 연결을 확인하고 다시 실행해 주세요."; exit 1; }

say "2/4 게임을 내려받아요"
tmp="$(mktemp -d)"
curl -fsSL "$SRC" | tar -xz -C "$tmp"
rm -rf "$APP"
mv "$tmp"/*/ "$APP"
rm -rf "$tmp"

say "3/4 게임에 필요한 부품을 설치해요"
cd "$APP"
# 중국 등에서 기본 저장소가 막히면 중국 미러로 다시 시도
npm ci --omit=dev --no-audit --no-fund ||
  npm ci --omit=dev --no-audit --no-fund --registry=https://registry.npmmirror.com

say "4/4 실행 명령(battle)을 만들어요"
mkdir -p "$PREFIX/bin"
cat > "$PREFIX/bin/battle" << EOF
#!/data/data/com.termux/files/usr/bin/bash
if [ "\$1" = "update" ]; then
  curl -fsSL "$INSTALLER" | bash
  exit
fi
# 화면이 꺼지거나 다른 앱으로 넘어가도 서버가 멈추지 않게 한다
termux-wake-lock 2> /dev/null || true
cd "$APP"
echo ""
echo " 교실 배틀 게임 서버를 켜요. 잠시 후 선생님 화면이 브라우저로 열려요."
echo " - 학생 폰은 이 폰의 핫스팟에 연결한 뒤 QR을 찍으면 돼요."
echo " - Termux로 돌아와서 이 창에서 Ctrl+C(볼륨 아래 + C)를 누르면 서버가 꺼져요."
echo ""
OPEN_BROWSER=1 PORT=3000 node server.js
termux-wake-unlock 2> /dev/null || true
EOF
chmod +x "$PREFIX/bin/battle"

say "설치 완료! 이제 battle 이라고 입력하면 게임 서버가 켜져요."
echo "  - 최신 버전으로 바꾸기: battle update"
echo "  - 설정 > 애플리케이션 > Termux > 배터리 > '제한 없음'으로 바꿔 두면 서버가 갑자기 꺼지지 않아요."
