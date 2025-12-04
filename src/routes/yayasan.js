// src/routes/yayasan.js
const express = require('express');
const router = express.Router();

const { ensureAuthenticated, ensureRole } = require('../middleware/auth');
const ctrl = require('../controllers/yayasanController');

// pasang middleware auth + role
router.use(ensureAuthenticated);
router.use(ensureRole('yayasan'));

// routes
router.get('/dashboard', ctrl.dashboard);
router.post('/create-user', ctrl.createUser);

router.get('/pending', ctrl.pendingOrders);
router.get('/orders/:id', ctrl.orderDetail);
router.post('/orders/:id/approve', ctrl.approveOrder);
router.post('/orders/:id/reject', ctrl.rejectOrder);
router.post('/orders/:id/complete', ctrl.completeOrder);
router.post('/orders/:id/complete', ctrl.markAsCompleted);



router.get('/delivery-confirmations', ctrl.deliveryConfirmations);
router.get('/dapur/:dapurId/orders', ctrl.getDapurOrders);

router.get('/delivery-confirmations/:orderId', ctrl.deliveryConfirmationDetail);

module.exports = router;
