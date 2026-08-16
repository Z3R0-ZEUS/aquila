@echo off
setlocal
cd /d "%~dp0"
set PORT=8765
set URL=http://127.0.0.1:%PORT%/

powershell -NoProfile -Command "try { $c = New-Object Net.Sockets.TcpClient; $c.Connect('127.0.0.1', %PORT%); $c.Close(); exit 0 } catch { exit 1 }"
if errorlevel 1 (
  start "Aquila server" /min py -3 -m http.server %PORT%
  timeout /t 1 /nobreak >nul
)

start "" "%URL%"
endlocal
