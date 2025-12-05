// app.js
require('dotenv').config();
const express = require('express');
const session = require('express-session');
const path = require('path');
const flash = require('connect-flash');
const methodOverride = require('method-override');

// ⬅️ tambahin ini
const pool = require('./src/models/db');

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


// ==== MINI CART MIDDLEWARE ====
app.use(async (req, res, next) => {
  try {
    // kalau belum login atau bukan dapur → jangan paksa baca cart
    if (!req.session.user || req.session.user.role !== 'dapur') {
      res.locals.cartCount = 0;
      res.locals.miniCartItems = [];
      res.locals.miniCartTotal = 0;
      return next();
    }

    const userId = req.session.user.id;

    const [rows] = await pool.query(`
      SELECT
        ci.qty,
        ci.price_at,
        p.name  AS product_name,
        p.image AS product_image
      FROM cart_items ci
      JOIN carts c   ON c.id = ci.cart_id
      JOIN products p ON p.id = ci.product_id
      WHERE c.user_id = ?
      ORDER BY ci.id DESC
      LIMIT 5
    `, [userId]);

    const items = rows.map(r => {
      const qtyInt   = Number(r.qty || 0);       // <== buang .000 di sini
      const priceNum = Number(r.price_at || 0);
      const subtotal = qtyInt * priceNum;

      return {
        name: r.product_name,
        qty: qtyInt,
        subtotal,
        subtotalFormatted: subtotal.toLocaleString('id-ID'),
        image_url: r.product_image
      };
    });

    const cartCount = items.reduce((sum, it) => sum + it.qty, 0);
    const miniCartTotal = items.reduce((sum, it) => sum + it.subtotal, 0);

    res.locals.miniCartItems = items;
    res.locals.miniCartTotal = miniCartTotal;
    res.locals.miniCartTotalFormatted = miniCartTotal.toLocaleString('id-ID');
    res.locals.cartCount = cartCount; // <== sekarang integer (misal 6)
  } catch (err) {
    console.error('miniCart middleware error:', err);
    res.locals.cartCount = 0;
    res.locals.miniCartItems = [];
    res.locals.miniCartTotal = 0;
  }
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
