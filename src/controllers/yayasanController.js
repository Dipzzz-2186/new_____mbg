// src/controllers/yayasanController.js
const pool = require('../models/db');
const bcrypt = require('bcryptjs');

exports.dashboard = async (req, res) => {
  const yayasanId = req.session.user.id;

  // HANYA hitung order yang sudah lolos approval
  // (bukan 'awaiting_yayasan' dan bukan 'rejected_yayasan')
  const [dapurRows] = await pool.query(
    `SELECT 
       u.id,
       u.name,
       u.email,
       COALESCE(
         SUM(
           CASE 
             WHEN o.status IS NOT NULL 
              AND o.status NOT IN ('awaiting_yayasan','rejected_yayasan')
             THEN 1 ELSE 0 
           END
         ), 0
       ) AS orders_count
     FROM users u
     LEFT JOIN orders o 
       ON o.user_id = u.id
      AND o.yayasan_id = ?
     WHERE u.yayasan_id = ?
       AND u.role = 'dapur'
     GROUP BY u.id, u.name, u.email`,
    [yayasanId, yayasanId]
  );
  const [vendorRows] = await pool.query(
    'SELECT id, name, email FROM users WHERE role = "vendor" ORDER BY name'
  );

  const [pendingRows] = await pool.query(
    'SELECT COUNT(*) AS pendingCount FROM orders WHERE yayasan_id = ? AND status = ?',
    [yayasanId, 'awaiting_yayasan']
  );
  const pendingCount = pendingRows[0]?.pendingCount || 0;

  res.render('yayasan/dashboard', { dapurRows, vendorRows, pendingCount });
};

exports.createUser = async (req, res) => {
    const { name, email, role, password } = req.body; // role: vendor | dapur
    const yayasanId = req.session.user.id;
    const hashed = await bcrypt.hash(password || 'password123', 10);
    try {
        await pool.query('INSERT INTO users (yayasan_id,name,email,password,role) VALUES (?,?,?,?,?)',
            [yayasanId, name, email, hashed, role]);
        req.flash('success', `${role} berhasil dibuat`);
        res.redirect('/yayasan/dashboard');
    } catch (err) {
        req.flash('error', 'Gagal membuat user: ' + (err.code || err.message));
        res.redirect('/yayasan/dashboard');
    }
};

exports.pendingOrders = async (req, res) => {
  const yayasanId = req.session.user.id;
  try {
    // ambil orders awaiting_yayasan milik yayasan + join ke users (dapur)
    const [orders] = await pool.query(
      `SELECT 
         o.id,
         o.user_id,
         o.total,
         o.status,
         o.created_at,
         u.name AS dapur_name
       FROM orders o
       JOIN users u ON u.id = o.user_id
       WHERE o.yayasan_id = ? AND o.status = ?
       ORDER BY o.created_at DESC`,
      [yayasanId, 'awaiting_yayasan']
    );

    if (!orders.length) {
      return res.render('yayasan/pending_orders', { orders: [] });
    }

    const orderIds = orders.map(o => o.id);

    const [items] = await pool.query(
      `SELECT
         oi.order_id,
         oi.product_id,
         oi.qty,
         oi.price,
         p.name AS product_name,
         p.vendor_id,
         v.name AS vendor_name
       FROM order_items oi
       JOIN products p ON p.id = oi.product_id
       LEFT JOIN users v ON v.id = p.vendor_id
       WHERE oi.order_id IN (?)
       ORDER BY oi.order_id, oi.id`,
      [orderIds]
    );

    const itemsMap = new Map();
    for (const it of items) {
      if (!itemsMap.has(it.order_id)) itemsMap.set(it.order_id, []);
      itemsMap.get(it.order_id).push(it);
    }

    const ordersWithItems = orders.map(o => {
      return {
        ...o,
        items: itemsMap.get(o.id) || []
      };
    });

    return res.render('yayasan/pending_orders', { orders: ordersWithItems });
  } catch (err) {
    console.error('pendingOrders error:', err);
    req.flash('error', 'Gagal mengambil order menunggu');
    return res.redirect('/yayasan/dashboard');
  }
};


exports.approveOrder = async (req, res) => {
  const yayasanId = req.session.user.id;
  const orderId = req.params.id;
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    // pastikan order milik yayasan
    const [orders] = await conn.query(
      'SELECT * FROM orders WHERE id = ? AND yayasan_id = ? FOR UPDATE',
      [orderId, yayasanId]
    );
    if (!orders.length) {
      throw new Error('Order tidak ditemukan atau bukan milik yayasan Anda');
    }
    const order = orders[0];

    // status high-level: yayasan sudah approve
    await conn.query(
      'UPDATE orders SET status = ? WHERE id = ?',
      ['approved_yayasan', orderId]
    );

    // ambil vendor yang terlibat
    const [vendors] = await conn.query(
      `SELECT DISTINCT p.vendor_id
       FROM order_items oi
       JOIN products p ON p.id = oi.product_id
       WHERE oi.order_id = ? AND p.vendor_id IS NOT NULL`,
      [orderId]
    );

    // buat vendor_order_status & notifikasi ke masing-masing vendor
    for (const v of vendors) {
      const vendorId = v.vendor_id;

      await conn.query(
        `INSERT INTO vendor_order_status (order_id, vendor_id, status, created_at)
         VALUES (?,?,?,NOW())
         ON DUPLICATE KEY UPDATE status = VALUES(status), updated_at = NOW()`,
        [orderId, vendorId, 'pending']
      );

      // 👇 perbaikan di sini: pakai user_id, bukan vendor_id
      await conn.query(
        'INSERT INTO notifications (user_id, order_id, type, payload, created_at) VALUES (?,?,?,?,NOW())',
        [vendorId, orderId, 'vendor_new_order', JSON.stringify({ orderId, yayasanId })]
      );
    }

    // notif ke dapur
    await conn.query(
      'INSERT INTO notifications (user_id, order_id, type, payload, created_at) VALUES (?,?,?,?,NOW())',
      [order.user_id, orderId, 'yayasan_approved', JSON.stringify({ orderId })]
    );

    await conn.commit();
    conn.release();
    req.flash('success', 'Order disetujui — vendor terkait telah diberitahu.');
    return res.redirect('/yayasan/pending');
  } catch (err) {
    await conn.rollback();
    conn.release();
    console.error('approveOrder error:', err);
    req.flash('error', 'Gagal approve order: ' + (err.message || err));
    return res.redirect('/yayasan/pending');
  }
};


exports.rejectOrder = async (req, res) => {
    const yayasanId = req.session.user.id;
    const orderId = req.params.id;
    try {
        const [rows] = await pool.query('SELECT * FROM orders WHERE id=? AND yayasan_id=?', [orderId, yayasanId]);
        if (!rows.length) {
            req.flash('error', 'Order tidak ditemukan');
            return res.redirect('/yayasan/pending');
        }
        await pool.query('UPDATE orders SET status=? WHERE id=?', ['rejected_yayasan', orderId]);

        // notify dapur
        await pool.query('INSERT INTO notifications (user_id, order_id, type, payload) VALUES (?,?,?,?)',
            [rows[0].user_id, orderId, 'yayasan_rejected', JSON.stringify({ orderId })]
        );

        req.flash('success', 'Order ditolak');
        res.redirect('/yayasan/pending');
    } catch (err) {
        console.error(err);
        req.flash('error', 'Gagal menolak order');
        res.redirect('/yayasan/pending');
    }
};

exports.deliveryConfirmations = async (req, res) => {
  try {
    const yayasanId = req.session.user.id;
    const [rows] = await pool.query(
      `SELECT
         dc.id,
         dc.order_id,
         dc.user_id,
         dc.yayasan_id,
         dc.arrived_at,
         dc.notes,
         dc.receiver_name,
         dc.signature_path,
         dc.created_at,
         u.name AS dapur_name,
         o.total AS order_total,
         MAX(vs.delivery_note_path) AS delivery_note_path
       FROM delivery_confirmations dc
       JOIN users u ON u.id = dc.user_id
       JOIN orders o ON o.id = dc.order_id
       LEFT JOIN vendor_shipments vs
         ON vs.order_id = dc.order_id
       WHERE dc.yayasan_id = ?
       GROUP BY
         dc.id,
         dc.order_id,
         dc.user_id,
         dc.yayasan_id,
         dc.arrived_at,
         dc.notes,
         dc.receiver_name,
         dc.signature_path,
         dc.created_at,
         u.name,
         o.total
       ORDER BY dc.created_at DESC`,
      [yayasanId]
    );

    res.render('yayasan/delivery_confirmations', { confirmations: rows });
  } catch (err) {
    console.error(err);
    req.flash('error', 'Gagal mengambil konfirmasi');
    res.redirect('/yayasan/dashboard');
  }
};

exports.getDapurOrders = async (req, res) => {
  try {
    const yayasanId = req.session.user.id;
    const dapurId = Number(req.params.dapurId);

    // security: cek dapur memang milik yayasan
    const [uRows] = await pool.query(
      'SELECT id, name, email FROM users WHERE id = ? AND yayasan_id = ? AND role = ?',
      [dapurId, yayasanId, 'dapur']
    );
    if (!uRows.length) {
      req.flash('error', 'Dapur tidak ditemukan atau bukan bagian dari yayasan Anda');
      return res.redirect('/yayasan/dashboard');
    }
    const dapur = uRows[0];

    // hanya order yang SUDAH disetujui (bukan awaiting & bukan rejected)
    const [orders] = await pool.query(
      `SELECT o.id, o.total, o.status, o.created_at
       FROM orders o
       WHERE o.user_id = ?
         AND o.yayasan_id = ?
         AND o.status IS NOT NULL
         AND o.status NOT IN ('awaiting_yayasan','rejected_yayasan')
       ORDER BY o.created_at DESC`,
      [dapurId, yayasanId]
    );

    const orderIds = orders.map(o => o.id);
    let itemsMap = new Map();
    if (orderIds.length) {
      const [items] = await pool.query(
        `SELECT 
           oi.order_id, 
           p.id AS product_id, 
           p.name AS product_name, 
           oi.qty, 
           oi.price, 
           p.vendor_id, 
           v.name AS vendor_name
         FROM order_items oi
         JOIN products p ON p.id = oi.product_id
         LEFT JOIN users v ON v.id = p.vendor_id
         WHERE oi.order_id IN (?)
         ORDER BY oi.order_id, oi.id`,
        [orderIds]
      );
      for (const it of items) {
        if (!itemsMap.has(it.order_id)) itemsMap.set(it.order_id, []);
        itemsMap.get(it.order_id).push(it);
      }
    }

    const ordersWithItems = orders.map(o => ({
      ...o,
      items: itemsMap.get(o.id) || []
    }));

    return res.render('yayasan/dapur_orders', { dapur, orders: ordersWithItems });
  } catch (err) {
    console.error('getDapurOrders error:', err);
    req.flash('error', 'Gagal mengambil pesanan dapur');
    return res.redirect('/yayasan/dashboard');
  }
};

exports.deliveryConfirmationDetail = async (req, res) => {
    const yayasanId = req.session.user.id;
    const orderId = Number(req.params.orderId);

    if (!orderId) {
        req.flash('error', 'Order ID tidak valid');
        return res.redirect('/yayasan/delivery-confirmations');
    }

    try {
        // ambil konfirmasi pengiriman + total order (pilih kolom tanpa sender_signature_path)
      const [confRows] = await pool.query(
        `SELECT
          dc.id,
          dc.order_id,
          dc.user_id,
          dc.yayasan_id,
          dc.arrived_at,
          dc.notes,
          dc.receiver_name,
          dc.signature_path,
          dc.created_at,
          u.name AS dapur_name,
          o.total AS order_total,
          MAX(vs.delivery_note_path) AS delivery_note_path
        FROM delivery_confirmations dc
        JOIN users u ON u.id = dc.user_id
        JOIN orders o ON o.id = dc.order_id
        LEFT JOIN vendor_shipments vs ON vs.order_id = dc.order_id
        WHERE dc.order_id = ? AND dc.yayasan_id = ?
        LIMIT 1`,
        [orderId, yayasanId]
      );

        if (!confRows.length) {
            req.flash('error', 'Konfirmasi pengiriman tidak ditemukan atau bukan milik yayasan Anda');
            return res.redirect('/yayasan/delivery-confirmations');
        }

        const confirmation = confRows[0];

        // ambil item order (hanya item untuk order ini)
        const [items] = await pool.query(
            `SELECT
               oi.id AS order_item_id,
               oi.product_id,
               oi.qty,
               oi.price,
               p.name AS product_name,
               p.vendor_id,
               v.name AS vendor_name,
               vos.status AS vendor_status
             FROM order_items oi
             JOIN products p ON p.id = oi.product_id
             LEFT JOIN users v ON v.id = p.vendor_id
             LEFT JOIN vendor_order_status vos ON vos.order_id = oi.order_id AND vos.vendor_id = p.vendor_id
             WHERE oi.order_id = ?
             ORDER BY oi.id`,
            [orderId]
        );

        return res.render('yayasan/delivery_detail', { confirmation, items });
    } catch (err) {
        console.error('deliveryConfirmationDetail error:', err);
        req.flash('error', 'Gagal mengambil detail konfirmasi');
        return res.redirect('/yayasan/delivery-confirmations');
    }
};

    // src/controllers/yayasanController.js

exports.completeOrder = async (req, res) => {
  const yayasanId = req.session.user.id;
  const orderId = Number(req.params.id);

  if (!orderId) {
    req.flash('error', 'Order ID tidak valid');
    return res.redirect('/yayasan/dashboard');
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    // pastikan order milik yayasan & belum completed
    const [ordRows] = await conn.query(
      'SELECT * FROM orders WHERE id = ? AND yayasan_id = ? FOR UPDATE',
      [orderId, yayasanId]
    );
    if (!ordRows.length) {
      throw new Error('Order tidak ditemukan atau bukan milik yayasan Anda');
    }
    const order = ordRows[0];
    if (order.status === 'completed') {
      throw new Error('Order sudah completed');
    }

    // OPSIONAL: cek minimal sudah ada pengiriman vendor
    const [shipments] = await conn.query(
      'SELECT * FROM vendor_shipments WHERE order_id = ?',
      [orderId]
    );
    if (!shipments.length) {
      // kalau mau strict: jangan izinkan complete tanpa bukti
      // throw new Error('Belum ada bukti pengiriman dari vendor');
      console.warn('completeOrder: tidak ada shipment, tapi tetap di-complete');
    }

    // set status final
    await conn.query(
      'UPDATE orders SET status = ?, updated_at = NOW() WHERE id = ?',
      ['completed', orderId]
    );

    // notif ke dapur bahwa pesanan selesai
    await conn.query(
      'INSERT INTO notifications (user_id, order_id, type, payload, created_at) VALUES (?,?,?,?,NOW())',
      [order.user_id, orderId, 'order_completed', JSON.stringify({ orderId })]
    );

    await conn.commit();
    conn.release();

    req.flash('success', 'Order telah ditandai selesai');
    return res.redirect(`/yayasan/orders/${orderId}`);
  } catch (err) {
    await conn.rollback();
    conn.release();
    console.error('completeOrder error:', err);
    req.flash('error', 'Gagal menyelesaikan order: ' + (err.message || err));
    return res.redirect('/yayasan/dashboard');
  }
};

exports.markAsCompleted = async (req, res) => {
  const yayasanId = req.session.user.id;
  const orderId = req.params.id;

  try {
    // cek order milik yayasan
    const [rows] = await pool.query(
      'SELECT * FROM orders WHERE id=? AND yayasan_id=?',
      [orderId, yayasanId]
    );
    if (!rows.length) {
      req.flash('error', 'Order tidak ditemukan');
      return res.redirect('/yayasan/dashboard');
    }

    await pool.query(
      'UPDATE orders SET status=? WHERE id=?',
      ['completed', orderId]
    );

    req.flash('success', 'Order berhasil ditandai sebagai selesai');
    res.redirect(`/yayasan/orders/${orderId}`);
  } catch (e) {
    req.flash('error', 'Gagal menyelesaikan order');
    res.redirect('/yayasan/dashboard');
  }
};

exports.orderDetail = async (req, res) => {
    const yayasanId = req.session.user.id;
    const orderId = Number(req.params.id);
    if (!orderId) {
        req.flash('error', 'Order ID tidak valid');
        return res.redirect('/yayasan/dashboard');
    }

    try {
        // pastikan order milik yayasan
        const [ordRows] = await pool.query(
            `SELECT o.*, u.name AS dapur_name
             FROM orders o
             JOIN users u ON u.id = o.user_id
             WHERE o.id = ? AND o.yayasan_id = ? LIMIT 1`,
            [orderId, yayasanId]
        );
        if (!ordRows.length) {
            req.flash('error', 'Order tidak ditemukan atau bukan milik yayasan Anda');
            return res.redirect('/yayasan/dashboard');
        }
        const order = ordRows[0];

        // ambil items (produk + vendor + qty + price)
        const [items] = await pool.query(
            `SELECT oi.id AS order_item_id, oi.product_id, oi.qty, oi.price,
              p.name AS product_name, p.vendor_id, v.name AS vendor_name,
              vos.status AS vendor_status
             FROM order_items oi
             JOIN products p ON p.id = oi.product_id
             LEFT JOIN users v ON v.id = p.vendor_id
             LEFT JOIN vendor_order_status vos ON vos.order_id = oi.order_id AND vos.vendor_id = p.vendor_id
             WHERE oi.order_id = ?
             ORDER BY oi.id`,
            [orderId]
        );

        // ambil delivery confirmation (jika ada) — pilih kolom tanpa sender_signature_path
        const [dcRows] = await pool.query(
            `SELECT
               id,
               order_id,
               user_id,
               yayasan_id,
               arrived_at,
               notes,
               receiver_name,
               signature_path,
               created_at
             FROM delivery_confirmations
             WHERE order_id = ? AND yayasan_id = ? LIMIT 1`,
            [orderId, yayasanId]
        );
        const deliveryConfirmation = dcRows.length ? dcRows[0] : null;
        const [shipments] = await pool.query(
            `SELECT vs.*, u.name AS vendor_name
            FROM vendor_shipments vs
            LEFT JOIN users u ON u.id = vs.vendor_id
            WHERE vs.order_id = ?`,
            [orderId]
        );

      // setelah const [shipments] = await pool.query(...)
      const shipmentsByVendor = {};
      for (const s of shipments) shipmentsByVendor[String(s.vendor_id)] = s;

      // ambil list vendor yang terlibat pada order ini (unique)
      const vendorIdsSet = new Set(items.map(it => it.vendor_id).filter(v => v != null));
      const vendorIds = Array.from(vendorIdsSet);

      // hitung apakah semua vendor sudah punya delivery_note_path
      let allVendorsDone = false;
      if (vendorIds.length === 0) {
        allVendorsDone = true; // edge case: nggak ada vendor
      } else {
        allVendorsDone = vendorIds.every(vid => {
          const s = shipmentsByVendor[String(vid)];
          return s && s.delivery_note_path; // vendor dianggap DONE hanya kalau ada delivery_note_path
        });
      }

      // render view: kirim shipmentsByVendor + flag allVendorsDone
      return res.render('yayasan/order_detail', { order, items, deliveryConfirmation, shipmentsByVendor, allVendorsDone });

    } catch (err) {
        console.error('orderDetail error:', err);
        req.flash('error', 'Gagal mengambil detail order');
        return res.redirect('/yayasan/dashboard');
    }
};
