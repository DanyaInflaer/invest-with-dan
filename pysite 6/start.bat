@echo off
chcp 65001 >nul
cd /d "%~dp0"
python --version >nul 2>&1 || (echo Python не найден. Установите его с python.org и отметьте "Add Python to PATH" & pause & exit /b)
python -m pip install -r requirements.txt
python app.py
pause
