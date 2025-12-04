// src/middleware/auth.js
exports.ensureAuthenticated = (req, res, next) => {
    if (req.session && req.session.user) return next();
    req.flash('error', 'Silakan login dulu');
    return res.redirect('/login');
};

exports.ensureRole = (role) => (req, res, next) => {
    if (req.session && req.session.user && req.session.user.role === role) return next();
    req.flash('error', 'Unauthorized');
    return res.redirect('/login');
};
