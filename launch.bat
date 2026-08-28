@echo off
setlocal
cd /d "%~dp0"
set PORT=8765
set URL=http://127.0.0.1:%PORT%/

powershell -NoProfile -Command "$conns = Get-NetTCPConnection -LocalPort %PORT% -State Listen -ErrorAction SilentlyContinue; foreach ($c in $conns) { $p = Get-Process -Id $c.OwningProcess -ErrorAction SilentlyContinue; if ($p -and ($p.ProcessName -match '^(python|py)$')) { Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue } }"
start "Aquila server" /min py -3 -m http.server %PORT%
timeout /t 1 /nobreak >nul

start "" "%URL%"
endlocal
