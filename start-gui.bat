@echo off
setlocal EnableExtensions
chcp 65001 >nul
cd /d "%~dp0"

echo ====================================================================
echo   AI-Provider-Suite Workbench - Grafische Oberflaeche (Windows 11)
echo ====================================================================
echo.

if exist "package.json" if exist "server.ts" goto :mode_node_workbench
if exist "gui\index.html" goto :mode_standalone_gui
if exist "start-all.ps1" goto :mode_legacy_docker

echo [FEHLER] Weder package.json/server.ts noch gui\index.html gefunden.
echo Bitte start-gui.bat im Projekt- oder entpackten Suite-Ordner ausfuehren.
pause
exit /b 1

:mode_node_workbench
REM Modus A: Vollstaendiger Quellcode-Ordner (package.json + server.ts)
powershell -NoProfile -Command "try { $r=Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:3000/api/workspace' -TimeoutSec 2; if($r.StatusCode -eq 200){ exit 0 } } catch {}; exit 1" >nul 2>&1
if not errorlevel 1 (
    echo [INFO] Workbench-Server laeuft bereits auf http://127.0.0.1:3000 - oeffne Browser...
    start "" "http://127.0.0.1:3000"
    exit /b 0
)

where node >nul 2>&1
if errorlevel 1 (
    echo [FEHLER] Node.js ^>= 20 wurde nicht gefunden.
    echo Bitte Node.js LTS installieren: https://nodejs.org/
    echo.
    pause
    exit /b 1
)

node -e "process.exit(Number(process.versions.node.split('.')[0]) >= 20 ? 0 : 1)" >nul 2>&1
if errorlevel 1 (
    echo [FEHLER] Installierte Node.js-Version ist zu alt ^(benoetigt Node.js ^>= 20 LTS fuer Vite 8^).
    node -v
    echo Bitte Node.js 22 LTS installieren: https://nodejs.org/
    echo.
    pause
    exit /b 1
)

if not exist "node_modules\.bin\tsx.cmd" (
    echo [1/3] Installiere Abhaengigkeiten ^(npm install^)...
    call npm install
    if errorlevel 1 (
        echo [WARNUNG] Standard npm install meldete Peer-Konflikt - wiederhole mit --legacy-peer-deps...
        call npm install --legacy-peer-deps
        if errorlevel 1 (
            echo [FEHLER] npm install fehlgeschlagen.
            pause
            exit /b 1
        )
    )
)

if not exist "node_modules\.bin\tsx.cmd" (
    echo [FEHLER] node_modules\.bin\tsx.cmd fehlt nach npm install.
    echo Bitte node_modules loeschen und start-gui.bat erneut ausfuehren.
    pause
    exit /b 1
)

REM Striktes Loopback-Binding ohne Leerzeichen (wird an Kindprozess vererbt)
set "HOST=127.0.0.1"
set "PORT=3000"
echo [2/3] Starte AI-Provider-Suite Workbench Server strikt auf http://127.0.0.1:3000 ...
start "AI-Provider-Suite-Server" /D "%~dp0" cmd /k npm run dev

echo [3/3] Warte auf lokale GUI ^(max. 25 Sekunden^)...
powershell -NoProfile -Command "$ok=$false; for($i=0;$i -lt 50;$i++){ try { $r=Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:3000/api/workspace' -TimeoutSec 2; if($r.StatusCode -eq 200){ $ok=$true; break } } catch {}; Start-Sleep -Milliseconds 500 }; if($ok){ Start-Process 'http://127.0.0.1:3000' } else { Write-Warning 'Server antwortet noch nicht auf Port 3000 - pruefe das Server-Fenster.' }"
echo.
echo GUI-URL: http://127.0.0.1:3000
echo Zum Beenden einfach das geoeffnete Server-Fenster schliessen.
exit /b 0

:mode_standalone_gui
REM Modus B: Entpacktes Suite-ZIP -> Lokale Windows-11-GUI OHNE Docker Desktop!
powershell -NoProfile -Command "try { $r=Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:8787/api/health' -TimeoutSec 2; if($r.StatusCode -eq 200){ exit 0 } } catch {}; exit 1" >nul 2>&1
if not errorlevel 1 (
    echo [INFO] Lokale GUI laeuft bereits auf http://127.0.0.1:8787 - oeffne Browser...
    start "" "http://127.0.0.1:8787"
    exit /b 0
)

echo [MODUS] Lokale Windows-11-GUI ^(kein Docker Desktop erforderlich^).
echo Bindung strikt auf http://127.0.0.1:8787 ^(Harte Regel 4^).
echo.

where node >nul 2>&1
if not errorlevel 1 (
    node -e "process.exit(Number(process.versions.node.split('.')[0]) >= 18 ? 0 : 1)" >nul 2>&1
    if not errorlevel 1 goto :launch_gui_node
)

REM Echte Python-Pruefung verhindert Windows-11 Microsoft-Store-Alias-Falle
python -c "import sys; sys.exit(0 if sys.version_info >= (3, 9) else 1)" >nul 2>&1
if not errorlevel 1 goto :launch_gui_python

py -3 -c "import sys; sys.exit(0 if sys.version_info >= (3, 9) else 1)" >nul 2>&1
if not errorlevel 1 goto :launch_gui_py

goto :launch_gui_ps

:launch_gui_node
echo [1/2] Starte lokalen GUI-Server via Node.js ^(ohne npm install^)...
start "AI-Provider-Suite-GUI" /D "%~dp0" cmd /k node "gui\local_gui_server.mjs"
goto :wait_standalone_gui

:launch_gui_python
echo [1/2] Starte lokalen GUI-Server via Python ^(ohne pip install^)...
start "AI-Provider-Suite-GUI" /D "%~dp0" cmd /k python "gui\local_gui_server.py"
goto :wait_standalone_gui

:launch_gui_py
echo [1/2] Starte lokalen GUI-Server via Python Launcher ^(py -3^)...
start "AI-Provider-Suite-GUI" /D "%~dp0" cmd /k py -3 "gui\local_gui_server.py"
goto :wait_standalone_gui

:launch_gui_ps
echo [1/2] Starte lokalen GUI-Server via Windows PowerShell ^(Zero-Install^)...
start "AI-Provider-Suite-GUI" /D "%~dp0" powershell -NoExit -NoProfile -ExecutionPolicy Bypass -File "gui\local_gui_server.ps1"
goto :wait_standalone_gui

:wait_standalone_gui
echo [2/2] Warte auf lokale GUI auf http://127.0.0.1:8787 ...
powershell -NoProfile -Command "$ok=$false; for($i=0;$i -lt 30;$i++){ try { $r=Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:8787/api/health' -TimeoutSec 2; if($r.StatusCode -eq 200){ $ok=$true; break } } catch {}; Start-Sleep -Milliseconds 500 }; if($ok){ Start-Process 'http://127.0.0.1:8787' } else { Write-Warning 'Server antwortet noch nicht auf Port 8787 - pruefe das Server-Fenster.' }"
echo.
echo Lokale GUI-URL : http://127.0.0.1:8787
echo Optional Docker: Fuer den LiteLLM-Router ^(Port 4000^) spaeter Docker Desktop + start-all.ps1 nutzen.
echo Zum Beenden einfach das Server-Fenster schliessen.
exit /b 0

:mode_legacy_docker
REM Modus C: Legacy-Fallback (nur start-all.ps1 vorhanden)
powershell -NoProfile -ExecutionPolicy Bypass -File "start-all.ps1"
if errorlevel 1 (
    pause
    exit /b 1
)
start "" "http://127.0.0.1:4000"
pause
exit /b 0
