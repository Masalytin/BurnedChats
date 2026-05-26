@echo off
setlocal
set "ROOT=%~dp0.."
cd /d "%ROOT%"
node --import "%ROOT%\scripts\cli\node_modules\tsx\dist\loader.mjs" "%ROOT%\scripts\cli\src\index.ts" %*
