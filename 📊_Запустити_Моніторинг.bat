@echo off
chcp 65001 > nul
echo ============================================================
echo   📊 Фаза Моніторингу Google Classroom
echo ============================================================
echo.
npx tsx src/index.ts --monitor
echo.
pause
