@echo off
chcp 65001 > nul
title Classroom Battle - game server
cd /d "%~dp0"
set OPEN_BROWSER=1
set PORT=3000
echo.
echo  ==============================================
echo    교실 배틀 게임 서버를 켜는 중이에요...
echo    잠시 후 선생님 화면이 브라우저로 열려요.
echo  ==============================================
echo.
if exist "%~dp0node\node.exe" (
  "%~dp0node\node.exe" "%~dp0app\server.js"
) else (
  node "%~dp0app\server.js"
)
echo.
echo  서버가 꺼졌어요. 아무 키나 누르면 이 창이 닫혀요.
pause > nul
