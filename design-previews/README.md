# SNG UI design previews

โฟลเดอร์นี้เก็บภาพสำหรับตรวจงาน UI เท่านั้น ไม่ใช่ asset ที่หน้าเว็บ production เรียกใช้ และไม่ใช่หลักฐานจากฐานข้อมูลจริง

> ข้อมูลชื่อสมาชิก เบอร์โทร เลขพัสดุ เครดิต ที่อยู่ เบอร์บริษัท และอีเมลในภาพทั้งหมดเป็นข้อมูลสังเคราะห์ (synthetic) สำหรับ QA ห้ามนำภาพจาก production ที่ยังไม่ได้ปกปิดข้อมูลมาแทนไฟล์เหล่านี้

## ภาพจาก template ปัจจุบัน

ภาพชุดหลัก render จาก EJS, i18n, navbar และ `portal.css` ใน worktree ปัจจุบันผ่าน fixture สังเคราะห์ แล้วเปิดด้วย Microsoft Edge ที่ viewport `500 × 1100` พิกเซล แต่ละภาพมี watermark ระบุ route/theme/language

| ไฟล์ | Route | Theme | ภาษา | Auth / state |
| --- | --- | --- | --- | --- |
| [`member-profile-light-th.png`](member-profile-light-th.png) | `/member/profile` | Light | TH | สมาชิกจำลอง / มีพัสดุล่าสุด |
| [`member-profile-dark-th.png`](member-profile-dark-th.png) | `/member/profile` | Dark | TH | สมาชิกจำลอง / มีพัสดุล่าสุด |
| [`home-light-th.png`](home-light-th.png) | `/home` | Light | TH | Guest / ไม่มี recent search |
| [`home-dark-th.png`](home-dark-th.png) | `/home` | Dark | TH | Guest / ไม่มี recent search |

รายละเอียดวันที่สร้าง, commit ต้นทาง, viewport และ state อยู่ใน [`manifest.json`](manifest.json)

ภาพเหล่านี้เป็น “rendered runtime-template capture” ไม่ใช่ end-to-end capture จาก server และฐานข้อมูลจริง จึงใช้ยืนยัน layout/theme/content contract ได้ แต่ไม่ใช้แทน UAT ของ session, route, database หรือ browser interaction

## Concepts และประวัติการตัดสินใจ

ไฟล์ก่อนเลือกแนวทางถูกแยกไว้ใน [`concepts/`](concepts/) และติดป้าย `CONCEPT ONLY · SYNTHETIC DATA` แล้ว

- `member-ui-concepts.*` เปรียบเทียบ A/B/C; แนว A (Utility First) เป็นฐานของ implementation ปัจจุบัน ส่วน B/C ไม่ได้ถูก implement
- `home-ui-preview.*` เป็น static concept รุ่นก่อน มีข้อมูลและลิงก์ hardcode จึงไม่ถือเป็น runtime evidence

## Source of truth

- `views/customer/member/profile.ejs`
- `views/customer/home.ejs`
- `views/customer/layout.ejs`
- `views/customer/navbar.ejs`
- `public/css/portal.css`
- `src/i18n/th.json` และ `src/i18n/lo.json`

หากภาพไม่ตรงกับไฟล์ข้างต้น ให้ถือ runtime source เป็นคำตอบที่ถูกต้องและสร้าง preview ใหม่

## สร้างภาพใหม่

ต้องมี dependencies จาก `npm install` และ Microsoft Edge บน Windows:

```powershell
node design-previews/render-previews.mjs
```

หาก Edge อยู่ตำแหน่งอื่น ให้กำหนด `SNG_PREVIEW_EDGE` ก่อนรัน:

```powershell
$env:SNG_PREVIEW_EDGE = 'D:\Apps\Edge\msedge.exe'
node design-previews/render-previews.mjs
```

สคริปต์จะสร้างภาพ runtime-template ทั้ง 4 ภาพ, refresh screenshot ของ archived concepts และเขียน `manifest.json` ใหม่ โดยไม่เชื่อมต่อฐานข้อมูล

ถ้าต้องการ refresh เพียงบางชุด ใช้ `--runtime-only` หรือ `--concepts-only`; โหมด concepts-only จะไม่เปลี่ยน provenance ใน `manifest.json`

## Coverage ที่ยังไม่ใช่ภาพหลัก

- ภาษา Lao
- Home แบบ login แล้ว
- Member แบบไม่มีพัสดุ, query error และสถานะ terminal/error
- Desktop/wide viewport และ interaction เช่น copy/search

กรณีเหล่านี้มีบางส่วนครอบคลุมด้วย unit tests แต่ถ้าจะเปลี่ยน layout หรือ copy ของ state นั้นอย่างมีนัยสำคัญ ควรเพิ่มภาพชื่อที่ระบุ route/theme/lang/state ให้ชัดเจนแทนการแก้ภาพหลักแบบคลุมเครือ
