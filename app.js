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
  res.locals.cartCount = 0;
  res.locals.miniCartItems = [];
  res.locals.miniCartTotal = 0;
  res.locals.miniCartTotalFormatted = '0';

  try {
    if (!req.session.user || req.session.user.role !== 'dapur') return next();

    const userId = req.session.user.id;

    const [cartRows] = await pool.query(
      'SELECT id FROM carts WHERE user_id = ? LIMIT 1',
      [userId]
    );
    if (!cartRows.length) return next();

    const cartId = cartRows[0].id;

    const [items] = await pool.query(`
      SELECT 
        ci.qty,
        p.price AS product_price,
        p.name AS product_name,
        p.image AS product_image
      FROM cart_items ci
      JOIN products p ON p.id = ci.product_id
      WHERE ci.cart_id = ?
      ORDER BY ci.id DESC
    `, [cartId]);

    if (!items.length) return next();

    const miniItems = items.map(row => {
    const price = row.product_price || 0;
    const subtotal = row.qty * price;
    return {
        name: row.product_name,
        qty: row.qty,
        subtotal,
        subtotalFormatted: subtotal.toLocaleString('id-ID'),
        // pakai path persis seperti di card produk
        image_url: row.product_image || null
    };
    });


    const total = miniItems.reduce((s, x) => s + x.subtotal, 0);
    const count = miniItems.reduce((s, x) => s + x.qty, 0);

    res.locals.miniCartItems = miniItems;
    res.locals.miniCartTotal = total;
    res.locals.miniCartTotalFormatted = total.toLocaleString('id-ID');
    res.locals.cartCount = count;

    next();
  } catch (e) {
    console.log("miniCart middleware error:", e.message);
    next();
  }
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
