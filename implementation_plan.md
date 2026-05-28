# Adding Shipping Payment Methods and Updating Bills

The goal is to allow selecting "Pay at Origin" (จ่ายต้นทาง) vs "Pay at Destination" (จ่ายปลายทาง) during order creation, and update the printed bills/stickers to display the payment status, price, date, and a specific remark.

## Proposed Changes

### Database Updates
We need to add a `payment_method` column to the `orders` table to track how the shipping fee will be paid.
- `payment_method` ENUM('ORIGIN', 'DESTINATION') DEFAULT 'ORIGIN'

### Backend Changes

#### [MODIFY] `src/controllers/ordersController.js`
- Update the `create` method to read `payment_method` from `req.body` and insert it into the database.
- Update the `update` method to handle editing the `payment_method`.

### Frontend Changes (Order Form)

#### [MODIFY] `views/orders/new.ejs`
- Add radio buttons or a select dropdown in the "ค่าขนส่ง" (Shipping fee) section to select between "จ่ายต้นทาง" and "จ่ายปลายทาง".

#### [MODIFY] `views/orders/edit.ejs`
- Add the same payment method selector to allow editing it later.

### Print Templates Updates

#### [MODIFY] `views/orders/sticker.ejs`
- Add the price to the main view if it wasn't prominent enough.
- Add text to indicate "จ่ายแล้ว จากต้นทาง" or "ค่าขนส่งปลายทาง" based on `payment_method`.
- Add the 1-month pickup remark: "หมายเหตุ: รับสินค้าภายใน 1 เดือน หากไม่มารับภายในกำหนดทางเราจะไม่รับผิดชอบ"

#### [MODIFY] `views/orders/waybill.ejs`
- Ensure the creation date, price, and payment status are clearly displayed.
- Add the 1-month pickup remark.

#### [MODIFY] `views/orders/print.ejs`
- Similar to `sticker.ejs`, update the layout to reflect the payment method, price, and remark.

## Open Questions
- Do you want the default payment method to be "จ่ายต้นทาง" (Pay at Origin)?
- Should "จ่ายต้นทาง" mean the price_amount is fully paid when creating the order, and "จ่ายปลายทาง" means it works like a COD for the shipping fee?

## Verification Plan
1. Apply the database schema change using the MySQL CLI.
2. Verify order creation works and saves the `payment_method`.
3. Preview the `sticker`, `waybill`, and `print` layouts to ensure the price, date, payment status, and remarks are rendered correctly in both Thai and Lao.
