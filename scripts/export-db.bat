@echo off
chcp 65001 >nul
echo กำลังดึงข้อมูลฐานข้อมูล 'sng_logistics'...

:: ใช้ Node.js แทน mysqldump (แก้ปัญหา plugin error)
cd ..
node scripts/dump-db.js

if %ERRORLEVEL% EQU 0 goto success

echo.
echo ===================================================
echo ERROR: ไม่สามารถดึงฐานข้อมูลได้!
echo กรุณาเช็คว่ารัน npm run dev ได้ปกติไหม
echo ===================================================
pause
exit /b 1

:success
echo.
echo ===================================================
echo  สำเร็จ! ได้ไฟล์ฐานข้อมูลแล้วที่:
echo  %CD%\sng_logistics.sql
echo ===================================================
echo.
echo ตอนนี้เอาไฟล์นี้ไปอัพโหลดขึ้น VPS ได้เลยครับ
pause

