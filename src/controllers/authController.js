// src/controllers/authController.js
const pool = require('../models/db');
const bcrypt = require('bcryptjs');

exports.loginForm = (req, res) => {
    res.render('auth/login', { title: 'Login' });
};

exports.login = async (req, res) => {
    try {
        const { email, password } = req.body;
        const [rows] = await pool.query('SELECT * FROM users WHERE email = ?', [email]);
        if (!rows.length) {
            req.flash('error', 'Email tidak ditemukan');
            return res.redirect('/login');
        }
        const user = rows[0];
        const ok = await bcrypt.compare(password, user.password);
        if (!ok) {
            req.flash('error', 'Password salah');
            return res.redirect('/login');
        }
        // remove password before storing in session
        delete user.password;
        req.session.user = user;
        req.flash('success', 'Login berhasil');
        if (user.role === 'yayasan') return res.redirect('/yayasan/dashboard');
        if (user.role === 'vendor') return res.redirect('/vendor/dashboard');
        if (user.role === 'dapur') return res.redirect('/dapur/dashboard');
        if (user.role === 'driver') return res.redirect('/driver/orders');
        res.redirect('/');
    } catch (err) {
        console.error(err);
        req.flash('error', 'Terjadi kesalahan saat login');
        res.redirect('/login');
    }
};

exports.logout = (req, res) => {
    req.session.destroy(() => res.redirect('/login'));
};
