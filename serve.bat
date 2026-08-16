@echo off
cd /d "%~dp0"
echo Aquila — open http://localhost:8765
py -3 -m http.server 8765
