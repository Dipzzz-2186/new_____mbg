// src/routes/vendor.js
const express = require('express');
const router = express.Router();

const { ensureAuthenticated, ensureRole } = require('../middleware/auth');
const vendorController = require('../controllers/vendorController');

// Middleware global: semua route vendor harus login & role vendor
router.use(ensureAuthenticated);
router.use(ensureRole('vendor'));

// ===== DASHBOARD & PRODUK =====
router.get('/dashboard', vendorController.getDashboard);

router.get('/products/new', vendorController.createProductForm);
router.post('/products/new', vendorController.upload, vendorController.createProduct);

// FORM EDIT PRODUK (GET)
router.get('/products/:id/edit', vendorController.editProductForm);

// SUBMIT EDIT PRODUK (POST)
router.post(
  '/products/:id/edit',
  vendorController.upload,          // supaya multipart/form-data (gambar + body) KE-BACA
  vendorController.updateProduct
);

// HAPUS PRODUK
router.post('/products/:id/delete', vendorController.deleteProduct);

// ===== PESANAN VENDOR =====
router.get('/orders', vendorController.getOrders);
router.get('/orders-to-prepare', vendorController.getOrdersToPrepare);
router.post('/orders/:orderId/status', vendorController.updateVendorOrderStatus);

// FORM minta tanda tangan dapur
router.get('/orders/:orderId/sign', vendorController.getSignatureForm);

// SUBMIT tanda tangan dapur (file upload)
router.post(
  '/orders/:orderId/sign',
  vendorController.uploadProof,
  vendorController.submitDapurSignature
);

// SURAT JALAN
router.post(
  '/orders/:orderId/ship',
  vendorController.uploadShipment,
  vendorController.createVendorShipment
);

// router global di atas sudah: router.use(ensureRole('vendor'))
router.get('/drivers', vendorController.listDrivers);
router.post('/drivers', vendorController.createDriver);

module.exports = router;
