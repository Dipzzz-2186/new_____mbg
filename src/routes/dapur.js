// src/routes/dapur.js
const express = require('express');
const router = express.Router();
const { ensureAuthenticated, ensureRole } = require('../middleware/auth');
const dapurCtrl = require('../controllers/dapurController');

router.use(ensureAuthenticated, ensureRole('dapur'));

router.get('/dashboard', dapurCtrl.dashboard);
router.get('/orders', dapurCtrl.listOrdersForDapur);
router.get('/profile', dapurCtrl.viewProfile);

router.get('/cart', dapurCtrl.viewCart);
router.post('/cart/add', dapurCtrl.addToCart);
router.post('/cart/remove', dapurCtrl.removeFromCart);
router.post('/checkout', dapurCtrl.checkout);

router.get('/profile/complete', dapurCtrl.showCompleteProfileForm);
router.post('/profile/complete', dapurCtrl.completeProfilePost);

router.get('/profile/password', dapurCtrl.passwordPage);
router.post('/profile/password', dapurCtrl.updatePassword);

module.exports = router;
