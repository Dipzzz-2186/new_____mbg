// src/middleware/auth.js

// Harus login
exports.ensureAuthenticated = (req, res, next) => {
    if (req.session && req.session.user) return next();
    if (req.flash) req.flash('error', 'Silakan login dulu');
    return res.redirect('/login');
};

// Cek role (bisa 1 atau banyak role)
exports.ensureRole = (...roles) => (req, res, next) => {
    const user =
        (req.session && req.session.user) ||
        req.user ||
        res.locals.currentUser ||
        null;

    if (!user) {
        if (req.flash) req.flash('error', 'Silakan login dulu');
        return res.redirect('/login');
    }

    // roles = ['vendor'] atau ['driver'], dll
    if (!roles.includes(user.role)) {
        // kalau mau hard 403:
        // return res.status(403).send('Forbidden');
        if (req.flash) req.flash('error', 'Unauthorized');
        return res.redirect('/login');
    }

    // lolos
    return next();
};

// Kalau masih mau helper khusus driver (opsional)
exports.ensureDriver = (req, res, next) => {
    const user =
        (req.session && req.session.user) ||
        req.user ||
        res.locals.currentUser ||
        null;

    if (!user) {
        if (req.flash) req.flash('error', 'Silakan login dulu');
        return res.redirect('/login');
    }

    if (user.role !== 'driver') {
        return res.status(403).send('Akses ditolak');
    }

    next();
};
