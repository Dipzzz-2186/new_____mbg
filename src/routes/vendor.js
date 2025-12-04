// src/routes/vendor.js
const express = require('express');
const router = express.Router();
const { ensureAuthenticated, ensureRole } = require('../middleware/auth');
const vendorCtrl = require('../controllers/vendorController');
const vendorController = require('../controllers/vendorController');

// Middleware global: semua route vendor harus login & role vendor
router.use(ensureAuthenticated);
router.use(ensureRole('vendor'));

// DASHBOARD & PRODUK
router.get('/dashboard', vendorCtrl.getDashboard);
router.get('/products/new', vendorCtrl.createProductForm);
router.post('/products/new', vendorCtrl.upload, vendorCtrl.createProduct);
router.post('/products/:id/delete', vendorCtrl.deleteProduct);

// PESANAN VENDOR
router.get('/orders', vendorCtrl.getOrders);
router.get('/orders-to-prepare', vendorCtrl.getOrdersToPrepare);
router.post('/orders/:orderId/status', vendorCtrl.updateVendorOrderStatus);

// ✅ FORM minta tanda tangan dapur
router.get('/orders/:orderId/sign', vendorCtrl.getSignatureForm);

// ✅ SUBMIT tanda tangan dapur (file upload)
router.post(
  '/orders/:orderId/sign',
  vendorCtrl.uploadProof,
  vendorCtrl.submitDapurSignature
);

// SURAT JALAN
router.post(
  '/orders/:orderId/ship',
  vendorCtrl.uploadShipment,
  vendorCtrl.createVendorShipment
);

module.exports = router;
