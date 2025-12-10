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
        // remove password before storing in session
        delete user.password;

        // build session user object
        const sessionUser = {
            id: user.id,
            name: user.name,
            role: user.role,
            vendor_id: user.vendor_id
        };

        if (sessionUser.role === 'driver' && sessionUser.vendor_id) {
            try {
                // first try vendors table (in case you later add it)
                let vrows = [];
                try {
                    [vrows] = await pool.query('SELECT name FROM vendors WHERE id = ? LIMIT 1', [sessionUser.vendor_id]);
                } catch (e) {
                    // vendors table might not exist -> fallback ke users
                    // console.warn('vendors table not found, fallback to users table');
                    [vrows] = await pool.query('SELECT name FROM users WHERE id = ? AND role = ? LIMIT 1', [sessionUser.vendor_id, 'vendor']);
                }

                sessionUser.vendor_name = (vrows && vrows.length) ? vrows[0].name : null;
                sessionUser.role_display = sessionUser.vendor_name ? `driver ${sessionUser.vendor_name}` : 'driver';
            } catch (e) {
                // jika apapun gagal, jangan crash login - pakai default role label
                console.error('failed to resolve vendor name for driver:', e && (e.message || e));
                sessionUser.vendor_name = null;
                sessionUser.role_display = 'driver';
            }
        } else {
            sessionUser.role_display = sessionUser.role;
        }

        req.session.user = sessionUser;

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
