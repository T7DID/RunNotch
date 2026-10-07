@echo off
setlocal
set "ELECTRON_RUN_AS_NODE=1"
"%~dp0RunNotch.exe" "%~dp0resources\app.asar\cli\runnotch.mjs" %*
exit /b %errorlevel%
