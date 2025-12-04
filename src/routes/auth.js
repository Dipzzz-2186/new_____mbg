// src/routes/auth.js
const express = require('express');
const router = express.Router();
const auth = require('../controllers/authController'); // pastikan path benar

router.get('/login', auth.loginForm);
router.post('/login', auth.login);
router.post('/logout', auth.logout);

module.exports = router;
