const express = require('express');
const router = express.Router();
const marketplaceController = require('../controllers/marketplaceController');
const ctrl = require('../controllers/marketplaceController');
router.get('/', marketplaceController.list);
router.get('/live-search', marketplaceController.liveSearch);
router.get('/product/:id', marketplaceController.detail);
module.exports = router;
