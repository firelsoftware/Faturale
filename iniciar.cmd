@echo off
rem Sobe o Faturale e abre o navegador. Feche esta janela para desligar.
cd /d "%~dp0"
if not exist .venv (
  echo Preparando o ambiente pela primeira vez...
  python -m venv .venv
  .venv\Scripts\python.exe -m pip install -q -r requirements.txt
)
.venv\Scripts\python.exe manage.py migrate --noinput
.venv\Scripts\python.exe manage.py semear
start "" http://localhost:8000
.venv\Scripts\python.exe manage.py runserver 8000
