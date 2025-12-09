const express = require('express');
const router = express.Router();
const { ensureAuthenticated } = require('../middleware/auth');
const { ensureDriver } = require('../middleware/auth');
const driverController = require('../controllers/driverController');

router.use(ensureAuthenticated);
router.use(ensureDriver);

router.get('/orders', driverController.getDriverOrders);

router.post(
    '/orders/:orderId/ship',
    driverController.uploadShipment,
    driverController.createDriverShipment
);

// 🔹 FORM tanda tangan dapur (driver pakai view vendor/order_signature.pug)
router.get(
    '/orders/:orderId/sign',
    driverController.getSignatureForm
);

// 🔹 SUBMIT tanda tangan dapur oleh driver
router.post(
    '/orders/:orderId/sign',
    driverController.uploadProof,          // upload foto bukti
    driverController.submitDapurSignature // simpan TTD + generate delivery note
);

module.exports = router;
