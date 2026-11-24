@echo off
rem switchboard-launcher: start working on this project. Pulls the latest code, signs you in the first
rem time, starts the Switchboard board and dashboard, then opens Claude Code here.
cd /d "%~dp0"
where node >nul 2>nul || (echo Node.js 18 or newer is needed first: https://nodejs.org & pause & exit /b 1)
node .switchboard\switchboard.mjs dev %*
echo %cmdcmdline% | find /i "/c" >nul && pause
