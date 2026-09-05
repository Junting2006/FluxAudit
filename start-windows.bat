@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"

where py >nul 2>&1
if not errorlevel 1 goto run_with_py

where python >nul 2>&1
if errorlevel 1 goto no_python
python launch_fluxaudit.py
goto finished

:run_with_py
py -3 launch_fluxaudit.py
goto finished

:no_python
echo [FluxAudit] Python 3 not found. Install Python 3.10 or newer and retry.
pause
exit /b 1

:finished
set EXIT_CODE=%ERRORLEVEL%
if %EXIT_CODE% NEQ 0 pause
exit /b %EXIT_CODE%
