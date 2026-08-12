# SNG Scanner for iT78

แอป Android ภายในสำหรับเปิดหน้า `/scanner/pda` ของ SNG ผ่าน Wi-Fi หรือ Net SIM และรับข้อมูลจากหัวสแกนแบบ Keyboard Wedge + Enter

## การตั้งค่า

1. ติดตั้ง APK แล้วเปิด `SNG Scanner`
2. ทดสอบในสำนักงานด้วย `http://192.168.100.88:3500`
3. ใช้นอกสถานที่ผ่าน Net SIM ด้วย `https://sng-logistics.co` ซึ่งตั้งเป็นค่าเริ่มต้นไว้แล้ว
4. ล็อกอินด้วยบัญชี role ที่มีสิทธิ์ scanner
5. ตั้งค่าเครื่องสแกนให้ส่ง suffix เป็น Enter

แอปไม่ฝัง username/password และไม่ข้ามขั้นตอน login ของระบบ Session จะถูกเก็บใน Android WebView และถูกล้างเมื่อเปลี่ยน Server URL

## พฤติกรรมเมื่อสัญญาณหาย

แอปจะแสดง Offline และไม่เก็บคำสั่งเปลี่ยนสถานะไว้ส่งย้อนหลัง เพื่อป้องกันสถานะข้ามลำดับหรือยิงซ้ำ เมื่ออินเทอร์เน็ตกลับมาให้กด `ลองเชื่อมต่ออีกครั้ง` แล้วสแกนใหม่

## Build

รองรับ Android 7.0 (API 24) ขึ้นไป และต้องใช้ JDK 17+, Android SDK Platform 34, Build Tools 34 และ Gradle 8.2.1 สำหรับการ build

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\build-apk.ps1
```

สคริปต์จะ map drive ชั่วคราวระหว่าง build เพื่อหลีกเลี่ยงปัญหา Java/Gradle กับ path ภาษาไทย แล้วถอด drive ออกให้อัตโนมัติ

APK debug จะอยู่ที่ `app/build/outputs/apk/debug/app-debug.apk` ส่วน release ต้องกำหนด signing key ของบริษัทก่อน จึงไม่ควรเผยแพร่ไฟล์ unsigned
