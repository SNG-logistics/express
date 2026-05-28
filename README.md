# SNG Logistics Express

ระบบจัดการขนส่งสินค้าไทย-ลาว (SNG Logistics)

## เกี่ยวกับโปรเจกต์
ระบบเว็บแอปพลิเคชันสำหรับจัดการการขนส่งสินค้า, ติดตามสถานะพัสดุ, และจัดการคลังสินค้า รองรับการทำงานทั้งฝั่งไทยและลาว

## เทคโนโลยีที่ใช้
- **Backend:** Node.js, Express.js
- **Frontend:** EJS (Templating Engine), Tailwind CSS
- **Database:** MySQL
- **Authentication:** Express Session, BCrypt
- **Other:** WhatsApp Integration (planned)

## การติดตั้งและเริ่มใช้งาน (Installation)

1. **Clone repository**
   ```bash
   git clone https://github.com/SNG-logistics/express.git
   cd express
   ```

2. **ติดตั้ง dependencies**
   ```bash
   npm install
   ```

3. **ตั้งค่า Environment Variables**
   สร้างไฟล์ `.env` โดยคัดลอกตัวอย่างจาก `.env.example` (ถ้ามี) หรือกำหนดค่าดังนี้:
   ```env
   DB_HOST=localhost
   DB_USER=root
   DB_PASSWORD=your_password
   DB_NAME=sng_logistics
   SESSION_SECRET=your_secret_key
   PORT=3000
   ```

4. **Import Database**
   นำเข้าไฟล์ `sng_logistics.sql` ลงใน MySQL Database

5. **รันโปรแกรม**
   - สำหรับ Development:
     ```bash
     npm run dev
     ```
   - สำหรับ Production:
     ```bash
     npm start
     ```

## ฟีเจอร์หลัก
- จัดการออเดอร์ (Orders Management)
- จัดการรอบรถ (Trips & Manifests)
- ระบบคลังสินค้า (Warehouse)
- ออกบิลและใบเสร็จ (Invoicing)
- ติดตามพัสดุ (Tracking)

## License
Private / Proprietary
