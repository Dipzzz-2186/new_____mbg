// app.js
require('dotenv').config();
const express = require('express');
const session = require('express-session');
const path = require('path');
const flash = require('connect-flash');
const methodOverride = require('method-override');

const app = express();

app.set('view engine', 'pug');
app.set('views', path.join(__dirname, 'src', 'views'));
app.use(express.static(path.join(__dirname, 'src', 'public')));

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(methodOverride('_method'));

app.use(session({
    secret: process.env.SESSION_SECRET || 'secret',
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 1000 * 60 * 60 * 8 }
}));
app.use(flash());

// make user + flash available in views
app.use((req, res, next) => {
    res.locals.currentUser = req.session.user || null;
    res.locals.success = req.flash('success');
    res.locals.error = req.flash('error');
    next();
});

// routes
const authRoutes = require('./src/routes/auth');
const yayasanRoutes = require('./src/routes/yayasan');
const vendorRoutes = require('./src/routes/vendor');
const dapurRoutes = require('./src/routes/dapur');
const marketRoutes = require('./src/routes/marketplace');

app.use('/', authRoutes);
app.use('/yayasan', yayasanRoutes);
app.use('/vendor', vendorRoutes);
app.use('/dapur', dapurRoutes);
app.use('/market', marketRoutes);


app.get('/', (req, res) => res.redirect('/market'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on ${PORT}`));
