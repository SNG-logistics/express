import { Router } from 'express';
import * as trips from '../controllers/tripsController.js';
import { requireLogin } from '../middleware/auth.js';

const router = Router();

router.get('/trips', requireLogin, trips.list);
router.get('/trips/new', requireLogin, trips.showCreate);
router.post('/trips', requireLogin, trips.create);
// Specific routes BEFORE generic :id route
router.post('/trips/:id/update-status', requireLogin, trips.updateStatus);
router.post('/trips/:id/orders', requireLogin, trips.attachOrders);
router.get('/trips/:id/manifest', requireLogin, trips.printManifest);
// Generic :id route LAST
router.get('/trips/:id', requireLogin, trips.detail);

export default router;
