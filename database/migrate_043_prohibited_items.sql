-- SNG Logistics migration 043: what SNG will and will not carry.
--
-- The only statement of this anywhere was one line in the printed order guide —
-- "illegal goods, explosives, flammable liquids not accepted, ask SNG first" —
-- which is too vague to act on and appears nowhere a customer sees before
-- ordering. A purchase-agent customer can now pay a deposit for something that
-- is then seized at the border, which is the worst possible way to learn this.
--
-- Two lists rather than one, because the honest answer has two shapes:
--   BANNED    never carried, do not ask
--   ASK_FIRST carried under conditions — quantity limits, permits, packaging —
--             so the answer depends on the specific item
-- Collapsing these into one list would either scare off business SNG can take
-- or promise carriage SNG cannot guarantee.
--
-- Stored rather than hardcoded because customs rules change and the owner must
-- be able to correct the list the day they learn something, not the day a
-- developer is free. The seed below covers what essentially every courier
-- refuses plus the categories that routinely need checking on this route; it is
-- a starting point the owner is expected to review against current Thai and Lao
-- customs practice, not a legal determination.

CREATE TABLE IF NOT EXISTS prohibited_items (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  category    ENUM('BANNED','ASK_FIRST') NOT NULL,
  label_th    VARCHAR(120) NOT NULL,
  label_lo    VARCHAR(120) NOT NULL,
  note_th     VARCHAR(255) NULL COMMENT 'why, or under what condition',
  note_lo     VARCHAR(255) NULL,
  sort_order  INT NOT NULL DEFAULT 0,
  active      TINYINT(1) NOT NULL DEFAULT 1,
  created_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  TIMESTAMP NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_prohibited_category (category, active, sort_order)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Seed only when empty, so re-running never resurrects rows the owner deleted
-- or overwrites wording they corrected.
INSERT INTO prohibited_items (category, label_th, label_lo, note_th, note_lo, sort_order)
SELECT * FROM (
  SELECT 'BANNED' AS c, 'ยาเสพติด และของผิดกฎหมาย' AS lt, 'ຢາເສບຕິດ ແລະ ຂອງຜິດກົດໝາຍ' AS ll,
         NULL AS nt, NULL AS nl, 10 AS s
  UNION ALL SELECT 'BANNED', 'วัตถุระเบิด ดอกไม้ไฟ', 'ວັດຖຸລະເບີດ ດອກໄມ້ໄຟ', NULL, NULL, 20
  UNION ALL SELECT 'BANNED', 'อาวุธ และกระสุน', 'ອາວຸດ ແລະ ລູກປືນ', NULL, NULL, 30
  UNION ALL SELECT 'BANNED', 'ของเหลวไวไฟ แก๊ส', 'ນ້ຳໄວໄຟ ອາຍແກັສ', NULL, NULL, 40
  UNION ALL SELECT 'BANNED', 'สัตว์มีชีวิต', 'ສັດມີຊີວິດ', NULL, NULL, 50
  UNION ALL SELECT 'BANNED', 'เงินสด ทองคำ ของมีค่าสูง', 'ເງິນສົດ ຄຳ ຂອງມີຄ່າສູງ',
         'ประกันความเสียหายไม่ครอบคลุม', 'ປະກັນຄວາມເສຍຫາຍບໍ່ຄຸ້ມຄອງ', 60

  UNION ALL SELECT 'ASK_FIRST', 'แบตเตอรี่ ลิเธียม พาวเวอร์แบงค์', 'ຖ່ານລິທຽມ ພາວເວີແບັງ',
         'มีข้อจำกัดเรื่องขนาดและการแพ็ค', 'ມີຂໍ້ຈຳກັດເລື່ອງຂະໜາດ ແລະ ການແພັກ', 10
  UNION ALL SELECT 'ASK_FIRST', 'ยา และอาหารเสริม', 'ຢາ ແລະ ອາຫານເສີມ',
         'บางชนิดต้องมีใบอนุญาต', 'ບາງຊະນິດຕ້ອງມີໃບອະນຸຍາດ', 20
  UNION ALL SELECT 'ASK_FIRST', 'ของเหลว เครื่องสำอาง น้ำหอม', 'ຂອງແຫຼວ ເຄື່ອງສຳອາງ ນ້ຳຫອມ',
         'จำกัดปริมาณ ต้องแพ็คกันรั่ว', 'ຈຳກັດປະລິມານ ຕ້ອງແພັກກັນຮົ່ວ', 30
  UNION ALL SELECT 'ASK_FIRST', 'อาหาร ของสด', 'ອາຫານ ຂອງສົດ',
         'ขึ้นกับชนิดและระยะเวลาขนส่ง', 'ຂຶ້ນກັບຊະນິດ ແລະ ໄລຍະເວລາຂົນສົ່ງ', 40
  UNION ALL SELECT 'ASK_FIRST', 'สินค้าแบรนด์เนม จำนวนมาก', 'ສິນຄ້າແບຣນເນມ ຈຳນວນຫຼາຍ',
         'อาจถูกเก็บภาษีนำเข้า', 'ອາດຖືກເກັບພາສີນຳເຂົ້າ', 50
  UNION ALL SELECT 'ASK_FIRST', 'ของแตกง่าย เช่น แก้ว เซรามิก', 'ຂອງແຕກງ່າຍ ເຊັ່ນ ແກ້ວ ເຊລາມິກ',
         'ต้องแพ็คพิเศษ อาจมีค่าใช้จ่ายเพิ่ม', 'ຕ້ອງແພັກພິເສດ ອາດມີຄ່າໃຊ້ຈ່າຍເພີ່ມ', 60
) AS seed
WHERE NOT EXISTS (SELECT 1 FROM prohibited_items LIMIT 1);
