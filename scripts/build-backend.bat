@echo off
echo === JARVIS Backend Build ===
cd /d "%~dp0\.."
if exist ".venv\Scripts\activate.bat" (
    call .venv\Scripts\activate.bat
) else (
    echo WARNING: .venv not found, using system Python
)
pip install pyinstaller --quiet
pyinstaller jarvis-backend.spec --noconfirm
echo.
echo Output: dist\jarvis-backend\
echo Run "npm run build" next to create the Electron installer.
pause
