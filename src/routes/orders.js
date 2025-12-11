import { Router } from 'express';
import * as orders from '../controllers/ordersController.js';
import * as payments from '../controllers/paymentsController.js';
import { requireLogin } from '../middleware/auth.js';

const router = Router();

router.get('/orders', requireLogin, orders.list);
router.get('/orders/new', requireLogin, orders.showCreate);
router.post('/orders', requireLogin, orders.create);
router.get('/orders/scan', requireLogin, orders.showScan);
router.post('/orders/scan', requireLogin, orders.processScan);

router.get('/orders/:id', requireLogin, orders.detail);
router.get('/orders/:id/edit', requireLogin, orders.showEdit);
router.post('/orders/:id/edit', requireLogin, orders.update);
router.get('/orders/:id/waybill', requireLogin, orders.printWaybill);

// Status updates
router.post('/orders/:id/receive', requireLogin, orders.receiveOrder);
router.post('/orders/:id/crossing', requireLogin, orders.startCrossing);
router.post('/orders/:id/arrived-border', requireLogin, orders.arriveBorder);
router.post('/orders/:id/arrived-dest', requireLogin, orders.arriveDestinationWh);
router.post('/orders/:id/delivery', requireLogin, orders.startDelivery);
router.post('/orders/:id/delivered', requireLogin, orders.markDelivered);
router.post('/orders/:id/close', requireLogin, orders.closeOrder);

// Payments / Expenses
router.post('/orders/:id/payments', requireLogin, payments.addPayment);
router.post('/orders/:id/payments/:paymentId/delete', requireLogin, payments.deletePayment);

export default router;
