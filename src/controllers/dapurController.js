// src/controllers/dapurController.js
const pool = require('../models/db');

// =================== DASHBOARD ===================
exports.dashboard = async (req, res) => {
  try {
    const userId = req.session.user.id;

    // 5 order terbaru saja
    const [orders] = await pool.query(
      'SELECT id, total, status, created_at FROM orders WHERE user_id=? ORDER BY created_at DESC LIMIT 5',
      [userId]
    );

    let recentOrders = orders;

    if (recentOrders.length) {
      const orderIds = recentOrders.map(o => o.id);

      const [itemRows] = await pool.query(
        `SELECT 
           oi.order_id,
           oi.qty,
           oi.price,
           p.name AS product_name
         FROM order_items oi
         JOIN products p ON p.id = oi.product_id
         WHERE oi.order_id IN (?)
         ORDER BY oi.order_id, oi.id`,
        [orderIds]
      );

      const byOrder = {};
      itemRows.forEach(r => {
        if (!byOrder[r.order_id]) byOrder[r.order_id] = [];
        byOrder[r.order_id].push({
          product_name: r.product_name,
          qty: r.qty,
          price: r.price,
          subtotal: Number(r.price) * Number(r.qty)
        });
      });

      recentOrders = recentOrders.map(o => ({
        ...o,
        items: byOrder[o.id] || []
      }));
    }

    res.render('dapur/dashboard', {
      title: 'Dashboard Dapur',
      recentOrders
    });
  } catch (err) {
    console.error(err);
    req.flash('error', 'Gagal membuka dashboard');
    res.redirect('/');
  }
};


// =================== CART ===================
exports.viewCart = async (req, res) => {
  try {
    const userId = req.session.user.id;
    const [carts] = await pool.query(
      'SELECT * FROM carts WHERE user_id=?',
      [userId]
    );

    if (!carts.length) {
      return res.render('dapur/cart', {
        title: 'Keranjang',
        cart: { items: [] }
      });
    }

    const cartId = carts[0].id;

    const [rows] = await pool.query(`
      SELECT
        ci.id,
        ci.qty,
        ci.price_at,
        p.name  AS product_name,
        p.image AS product_image
      FROM cart_items ci
      JOIN products p ON p.id = ci.product_id
      WHERE ci.cart_id = ?
      ORDER BY ci.id DESC
    `, [cartId]);

    // mapping boleh simpel gini, biar jelas
    const items = rows.map(r => ({
      id: r.id,
      qty: Number(r.qty || 0),
      price_at: r.price_at,
      product_name: r.product_name,
      product_image: r.product_image
    }));

    return res.render('dapur/cart', {
      title: 'Keranjang',
      cart: { items }
    });
  } catch (err) {
    console.error(err);
    req.flash('error', 'Gagal mengambil keranjang');
    res.redirect('/market');
  }
};


exports.addToCart = async (req, res) => {
  try {
    const user = req.session.user;
    if (!user || user.role !== 'dapur') {
      const msg = 'Hanya dapur yang bisa memesan';

      // Kalau request dari AJAX → balikin JSON saja
      if (req.xhr || req.headers['x-requested-with'] === 'XMLHttpRequest' ||
          (req.headers.accept && req.headers.accept.includes('application/json'))) {
        return res.status(401).json({ success: false, message: msg });
      }

      req.flash('error', msg);
      return res.redirect('/login');
    }

 const productId = req.body.product_id;

// qty Wajib integer minimal 1
let qty = parseInt(req.body.qty, 10);
if (isNaN(qty) || qty < 1) {
  qty = 1;
}

    const [prodRows] = await pool.query(
      'SELECT id, price FROM products WHERE id = ?',
      [productId]
    );
    if (!prodRows.length) {
      const msg = 'Produk tidak ditemukan';

      if (req.xhr || req.headers['x-requested-with'] === 'XMLHttpRequest' ||
          (req.headers.accept && req.headers.accept.includes('application/json'))) {
        return res.status(404).json({ success: false, message: msg });
      }

      req.flash('error', msg);
      return res.redirect('/market');
    }

    const priceAt = prodRows[0].price;

    // ----- cari / buat cart -----
    const [carts] = await pool.query(
      'SELECT id FROM carts WHERE user_id = ?',
      [user.id]
    );

    let cartId;
    if (carts.length) {
      cartId = carts[0].id;
    } else {
      const [r] = await pool.query(
        'INSERT INTO carts (user_id) VALUES (?)',
        [user.id]
      );
      cartId = r.insertId;
    }

    // ----- cek item sudah ada atau belum -----
    const [existing] = await pool.query(
      'SELECT id, qty FROM cart_items WHERE cart_id = ? AND product_id = ?',
      [cartId, productId]
    );

    if (existing.length) {
      const newQty = existing[0].qty + qty;
      await pool.query(
        'UPDATE cart_items SET qty = ?, price_at = ? WHERE id = ?',
        [newQty, priceAt, existing[0].id]
      );
    } else {
      await pool.query(
        'INSERT INTO cart_items (cart_id, product_id, qty, price_at) VALUES (?, ?, ?, ?)',
        [cartId, productId, qty, priceAt]
      );
    }

    // ----- hitung ulang total item di keranjang (buat badge) -----
    const [countRows] = await pool.query(
      `SELECT COALESCE(SUM(ci.qty), 0) AS total
       FROM cart_items ci
       JOIN carts c ON ci.cart_id = c.id
       WHERE c.user_id = ?`,
      [user.id]
    );

    const cartCount = countRows[0].total || 0;
    const successMsg = 'Produk ditambahkan ke keranjang';

    // Kalau dari AJAX → balikin JSON
    if (req.xhr || req.headers['x-requested-with'] === 'XMLHttpRequest' ||
        (req.headers.accept && req.headers.accept.includes('application/json'))) {
      return res.json({
        success: true,
        message: successMsg,
        cartCount
      });
    }

    // fallback normal (kalau submit biasa)
    req.flash('success', successMsg);
    res.redirect('/market');
  } catch (err) {
    console.error(err);
    const msg = 'Gagal menambahkan ke keranjang';

    if (req.xhr || req.headers['x-requested-with'] === 'XMLHttpRequest' ||
        (req.headers.accept && req.headers.accept.includes('application/json'))) {
      return res.status(500).json({ success: false, message: msg });
    }

    req.flash('error', msg);
    res.redirect('/market');
  }
};

exports.removeFromCart = async (req, res) => {
  try {
    const itemId = req.body.item_id;
    await pool.query(
      `DELETE ci FROM cart_items ci
       JOIN carts c ON ci.cart_id = c.id
       WHERE ci.id = ? AND c.user_id = ?`,
      [itemId, req.session.user.id]
    );
    req.flash('success', 'Item dihapus dari keranjang');
    res.redirect('/dapur/cart');
  } catch (err) {
    console.error(err);
    req.flash('error', 'Gagal menghapus item');
    res.redirect('/dapur/cart');
  }
};

// =================== CHECKOUT ===================
exports.checkout = async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const userId = req.session.user.id;

    const [carts] = await conn.query(
      'SELECT * FROM carts WHERE user_id=?',
      [userId]
    );
    if (!carts.length) {
      req.flash('error', 'Keranjang kosong');
      await conn.rollback();
      conn.release();
      return res.redirect('/dapur/cart');
    }
    const cartId = carts[0].id;

    const [items] = await conn.query(
      `SELECT ci.product_id, ci.qty, ci.price_at, p.yayasan_id
       FROM cart_items ci
       JOIN products p ON p.id = ci.product_id
       WHERE ci.cart_id = ?`,
      [cartId]
    );
    if (!items.length) {
      req.flash('error', 'Keranjang kosong');
      await conn.rollback();
      conn.release();
      return res.redirect('/dapur/cart');
    }

    const yayasanIds = [...new Set(items.map(x => x.yayasan_id))];
    if (yayasanIds.length > 1) {
      req.flash('error', 'Semua item harus dari yayasan yang sama');
      await conn.rollback();
      conn.release();
      return res.redirect('/dapur/cart');
    }
    const yayasanId = yayasanIds[0] || null;

    let total = 0;
    items.forEach(it => {
      total += Number(it.price_at) * Number(it.qty);
    });

    // INSERT ORDER:
    // status awal tetap yang lama: 'awaiting_yayasan'
    // (kalau mau ganti ke 'pending_yayasan', ubah di sini & di bagian yayasanController + enum DB)
    const [r] = await conn.query(
      'INSERT INTO orders (user_id, yayasan_id, total, status, created_at) VALUES (?,?,?,?,NOW())',
      [userId, yayasanId, total, 'awaiting_yayasan']
    );
    const orderId = r.insertId;

    const insertPromises = items.map(it =>
      conn.query(
        'INSERT INTO order_items (order_id, product_id, qty, price) VALUES (?,?,?,?)',
        [orderId, it.product_id, it.qty, it.price_at]
      )
    );
    await Promise.all(insertPromises);

    if (yayasanId) {
      await conn.query(
        'INSERT INTO notifications (user_id, order_id, type, payload, created_at) VALUES (?,?,?,?,NOW())',
        [
          yayasanId,
          orderId,
          'yayasan_pending',
          JSON.stringify({ orderId, from: userId })
        ]
      );
    }

    await conn.query('DELETE FROM cart_items WHERE cart_id = ?', [cartId]);
    await conn.query('DELETE FROM carts WHERE id = ?', [cartId]);

    await conn.commit();
    conn.release();

    req.flash(
      'success',
      'Checkout berhasil — order dikirim ke yayasan untuk approval'
    );
    return res.redirect('/dapur/dashboard');
  } catch (err) {
    try {
      await conn.rollback();
    } catch (e) {
      /* ignore */
    }
    conn.release();
    console.error('checkout error:', err);
    req.flash('error', 'Gagal checkout');
    return res.redirect('/dapur/cart');
  }
};

// =================== DETAIL ORDER (DAPUR) ===================
exports.orderDetailForDapur = async (req, res) => {
  try {
    const userId = req.session.user.id;
    const orderId = Number(req.params.orderId);
    if (!orderId) {
      req.flash('error', 'Order ID tidak valid');
      return res.redirect('/dapur/dashboard');
    }

    // pastikan order milik user
    const [ordRows] = await pool.query(
      'SELECT id, total, status, created_at FROM orders WHERE id = ? AND user_id = ? LIMIT 1',
      [orderId, userId]
    );
    if (!ordRows.length) {
      req.flash('error', 'Order tidak ditemukan');
      return res.redirect('/dapur/dashboard');
    }
    const order = ordRows[0];

    // AMBIL ITEM TANPA STATUS VENDOR (dapur tidak lihat proses vendor)
    const [items] = await pool.query(
      `SELECT
         oi.id AS order_item_id,
         oi.product_id,
         oi.qty,
         oi.price,
         p.name AS product_name
       FROM order_items oi
       JOIN products p ON p.id = oi.product_id
       WHERE oi.order_id = ?
       ORDER BY oi.id`,
      [orderId]
    );

    // render view yang hanya menampilkan produk + qty + price
    return res.render('dapur/order_detail', { order, items });
  } catch (err) {
    console.error('orderDetailForDapur error:', err);
    req.flash('error', 'Gagal mengambil detail order');
    return res.redirect('/dapur/dashboard');
  }
};

// GET form
exports.showCompleteProfileForm = async (req, res) => {
  try {
    const user = req.session.user || null;
    if (!user) {
      req.flash('error', 'Silakan login dulu.');
      return res.redirect('/login');
    }
    // ambil user fresh dari DB (opsional)
    const [rows] = await pool.query('SELECT id, name, email, phone, address FROM users WHERE id = ?', [user.id]);
    const dbUser = rows[0] || user;

    res.render('dapur/complete_profile', {
      title: 'Lengkapi Data Dapur',
      user: dbUser
    });
  } catch (err) {
    console.error('showCompleteProfileForm error:', err);
    req.flash('error', 'Gagal membuka form.');
    return res.redirect('/market');
  }
};

// POST submit
exports.completeProfilePost = async (req, res) => {
  try {
    const user = req.session.user;
    if (!user || user.role !== 'dapur') {
      req.flash('error', 'Akses ditolak.');
      return res.redirect('/login');
    }

    const phone = (req.body.phone || '').trim();
    const address = (req.body.address || '').trim();

    if (!phone || !address) {
      req.flash('error', 'Nomor telepon dan alamat wajib diisi.');
      return res.redirect('/dapur/profile/complete');
    }

    // simple phone validation (boleh ganti)
    if (phone.length < 6) {
      req.flash('error', 'Nomor telepon tidak valid.');
      return res.redirect('/dapur/profile/complete');
    }

    await pool.query('UPDATE users SET phone = ?, address = ?, updated_at = NOW() WHERE id = ?', [phone, address, user.id]);

    // update session user supaya view lain melihat data terbaru
    req.session.user.phone = phone;
    req.session.user.address = address;

    req.flash('success', 'Data berhasil disimpan.');
    return res.redirect('/market');
  } catch (err) {
    console.error('completeProfilePost error:', err);
    req.flash('error', 'Gagal menyimpan data.');
    return res.redirect('/dapur/profile/complete');
  }
};

// =================== LIST SEMUA ORDER (DAPUR) ===================
exports.listOrdersForDapur = async (req, res) => {
  try {
    const userId = req.session.user.id;

    const [orders] = await pool.query(
      'SELECT id, total, status, created_at FROM orders WHERE user_id=? ORDER BY created_at DESC',
      [userId]
    );

    let fullOrders = [];

    if (orders.length) {
      const orderIds = orders.map(o => o.id);

      const [itemRows] = await pool.query(
        `SELECT 
           oi.order_id,
           oi.qty,
           oi.price,
           p.name AS product_name
         FROM order_items oi
         JOIN products p ON p.id = oi.product_id
         WHERE oi.order_id IN (?)
         ORDER BY oi.order_id, oi.id`,
        [orderIds]
      );

      const byOrder = {};
      itemRows.forEach(r => {
        if (!byOrder[r.order_id]) byOrder[r.order_id] = [];
        byOrder[r.order_id].push({
          product_name: r.product_name,
          qty: r.qty,
          price: r.price,
          subtotal: Number(r.price) * Number(r.qty)
        });
      });

      fullOrders = orders.map(o => ({
        ...o,
        items: byOrder[o.id] || []
      }));
    }

    return res.render('dapur/orders', {
      title: 'Semua Pesanan',
      orders: fullOrders
    });
  } catch (err) {
    console.error('listOrdersForDapur error:', err);
    req.flash('error', 'Gagal mengambil daftar pesanan');
    return res.redirect('/dapur/dashboard');
  }
};

// =================== VIEW PROFILE (DAPUR) ===================
exports.viewProfile = async (req, res) => {
  try {
    const sessionUser = req.session.user;
    if (!sessionUser || sessionUser.role !== 'dapur') {
      req.flash('error', 'Silakan login sebagai dapur.');
      return res.redirect('/login');
    }

    // ambil data terbaru dari DB
    const [rows] = await pool.query(
      'SELECT id, name, email, phone, address, role, created_at FROM users WHERE id = ? LIMIT 1',
      [sessionUser.id]
    );

    const user = rows[0] || sessionUser;

    return res.render('dapur/profile', {
      title: 'Profil Dapur',
      user
    });
  } catch (err) {
    console.error('viewProfile error:', err);
    req.flash('error', 'Gagal membuka profil.');
    return res.redirect('/dapur/dashboard');
  }
};