@echo off
chcp 65001 > nul
echo ============================================================
echo   🎓 Фінальна Здача (Master Sheet + JPEG фотозвіти)
echo ============================================================
echo.
npx tsx src/index.ts --final
echo.
pause
