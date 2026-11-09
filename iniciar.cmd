@echo off
rem Sobe o Faturale e abre o navegador. Feche esta janela para desligar.
cd /d "%~dp0"
if not exist node_modules call npm install
start "" http://localhost:3000
node --disable-warning=ExperimentalWarning server.js
