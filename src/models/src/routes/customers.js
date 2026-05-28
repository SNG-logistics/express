import { Router } from 'express';
import * as customersController from '../controllers/customersController.js';

const router = Router();

router.get('/customers', customersController.list);
router.get('/customers/new', customersController.showCreate);
router.post('/customers', customersController.create);
router.get('/customers/:id/edit', customersController.showEdit);
router.post('/customers/:id', customersController.update);
router.post('/customers/:id/delete', customersController.remove);

export default router;
