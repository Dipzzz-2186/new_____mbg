// src/controllers/vendorController.js
const pool = require('../models/db');
const multer = require('multer');
const bcrypt = require('bcrypt');
const path = require('path');
const fs = require('fs');
const { generateDeliveryNote } = require('../lib/deliveryNotePuppeteer');

// ====== FOLDER UNTUK FOTO BUKTI PENERIMAAN ======
const proofDir = path.join(__dirname, '../../src/public/uploads/proofs');
if (!fs.existsSync(proofDir)) {
  fs.mkdirSync(proofDir, { recursive: true });
}
const proofUpload = multer({ dest: proofDir });
exports.uploadProof = proofUpload.single('proof_file');

// ========== KONFIG UPLOAD UMUM ==========
const upload = multer({
  dest: path.join(__dirname, '../../src/public/uploads/')
});
exports.upload = upload.single('image');

const uploadShipment = multer({
  dest: path.join(__dirname, '../../src/public/uploads/shipments/')
});
exports.uploadShipment = uploadShipment.single('delivery_attachment');

// ====== FOLDER UNTUK TANDA TANGAN DAPUR (diupload OLEH VENDOR) ======
const signatureDir = path.join(__dirname, '../../src/public/uploads/signatures');
if (!fs.existsSync(signatureDir)) {
  fs.mkdirSync(signatureDir, { recursive: true });
}
const signatureUpload = multer({ dest: signatureDir });
exports.uploadSignature = signatureUpload.single('signature');

// ========== DASHBOARD ==========
exports.getDashboard = async (req, res) => {
  try {
    const vendorId = req.session.user.id;

    const [products] = await pool.query(
      'SELECT * FROM products WHERE vendor_id = ?',
      [vendorId]
    );

    // hitung pesanan vendor (vendor_order_status pending / preparing)
    const [cntRows] = await pool.query(
      'SELECT COUNT(*) AS cnt FROM vendor_order_status WHERE vendor_id = ? AND status IN (?, ?)',
      [vendorId, 'pending', 'preparing']
    );
    const pendingCount = cntRows && cntRows[0] ? cntRows[0].cnt : 0;

    // 🔹 ambil semua supir milik vendor ini
    const [driverRows] = await pool.query(
      'SELECT id, name, email FROM users WHERE role = "driver" AND vendor_id = ?',
      [vendorId]
    );

    return res.render('vendor/dashboard', {
      title: 'Dashboard Vendor',
      products,
      pendingCount,
      drivers: driverRows,   // 🔹 kirim ke view
    });
  } catch (err) {
    console.error('getDashboard error:', err);
    req.flash('error', 'Gagal memuat dashboard vendor');
    return res.redirect('/');
  }
};

// ========== PRODUK ==========
exports.createProductForm = (req, res) => {
  res.render('vendor/create');
};

exports.createProduct = async (req, res) => {
  try {
    const vendorId = req.session.user.id;
    const yayasanId = req.session.user.yayasan_id || req.session.user.id;
    const { name, category, price, unit, stock, description } = req.body;
    const image = req.file ? '/uploads/' + req.file.filename : null;

    await pool.query(
      `INSERT INTO products
       (vendor_id, yayasan_id, name, category, price, unit, stock, description, image)
       VALUES (?,?,?,?,?,?,?,?,?)`,
      [vendorId, yayasanId, name, category, price, unit, stock, description, image]
    );

    req.flash('success', 'Produk ditambahkan');
    res.redirect('/vendor/dashboard');
  } catch (err) {
    console.error('createProduct error:', err);
    req.flash('error', 'Gagal menambah produk');
    res.redirect('/vendor/dashboard');
  }
};

exports.deleteProduct = async (req, res) => {
  try {
    const vendorId = req.session.user.id;
    const { id } = req.params;
    await pool.query(
      'DELETE FROM products WHERE id = ? AND vendor_id = ?',
      [id, vendorId]
    );
    req.flash('success', 'Produk dihapus (jika milik Anda)');
    res.redirect('/vendor/dashboard');
  } catch (err) {
    console.error('deleteProduct error:', err);
    req.flash('error', 'Gagal menghapus produk');
    res.redirect('/vendor/dashboard');
  }
};

// ========== PESANAN YANG HARUS DI-SIAPKAN ==========
exports.getOrdersToPrepare = async (req, res) => {
  try {
    const vendorId = req.session.user.id;
    // Fokus ke vendor_order_status; order.status tidak dipakai filter ketat
    const [orders] = await pool.query(
      `SELECT DISTINCT o.*
       FROM orders o
       JOIN vendor_order_status vos ON vos.order_id = o.id
       WHERE vos.vendor_id = ?
         AND vos.status IN ('pending', 'preparing')
       ORDER BY o.created_at DESC`,
      [vendorId]
    );

    return res.render('vendor/orders_to_prepare', { orders });
  } catch (err) {
    console.error('getOrdersToPrepare error:', err);
    req.flash('error', 'Gagal mengambil pesanan untuk disiapkan');
    return res.redirect('/vendor/dashboard');
  }
};

// ========== LIST PESANAN VENDOR (HANYA ITEM MILIK VENDOR) ==========
exports.getOrders = async (req, res) => {
  try {
    const vendorId = req.session.user.id;

    const [rows] = await pool.query(
      `SELECT
         vos.order_id,
         vos.status AS vendor_status,
         o.total AS order_total,
         o.created_at AS order_created,
         o.user_id AS dapur_id,
         oi.id AS order_item_id,
         oi.product_id,
         oi.qty,
         oi.price,
         p.name AS product_name,
         vs.id AS shipment_id,
         vs.attachment_path,
         vs.sender_signature_path,
         dc.id AS delivery_confirmation_id,
         u.name AS dapur_name,
         u.phone AS dapur_phone,
         u.address AS dapur_address
       FROM vendor_order_status vos
       JOIN orders o ON o.id = vos.order_id
       JOIN users u ON u.id = o.user_id
       JOIN order_items oi ON oi.order_id = o.id
       JOIN products p ON p.id = oi.product_id
       LEFT JOIN vendor_shipments vs
         ON vs.order_id = vos.order_id AND vs.vendor_id = vos.vendor_id
       LEFT JOIN delivery_confirmations dc
         ON dc.order_id = o.id
       WHERE vos.vendor_id = ?
         AND p.vendor_id = ?
       ORDER BY o.created_at DESC, oi.id`,
      [vendorId, vendorId]
    );

    const ordersMap = new Map();
    for (const r of rows) {
      if (!ordersMap.has(r.order_id)) {
        ordersMap.set(r.order_id, {
          order_id: r.order_id,
          order_total: r.order_total,
          created_at: r.order_created,
          vendor_status: r.vendor_status,
          shipment_sent: !!(r.attachment_path || r.sender_signature_path),
          delivery_confirmed: !!r.delivery_confirmation_id,
          // NEW: dapur contact
          dapur_name: r.dapur_name || '',
          dapur_phone: r.dapur_phone || '',
          dapur_address: r.dapur_address || '',
          items: []
        });
      }
      const ord = ordersMap.get(r.order_id);
      ord.items.push({
        order_item_id: r.order_item_id,
        product_id: r.product_id,
        product_name: r.product_name,
        qty: r.qty,
        price: r.price
      });
    }
    const orders = Array.from(ordersMap.values());
    return res.render('vendor/orders', { title: 'Pesanan', orders, currentUser: req.session.user, flash: req.flash && req.flash() });
  } catch (err) {
    console.error('getOrders error:', err);
    req.flash('error', 'Gagal mengambil pesanan');
    return res.redirect('/vendor/dashboard');
  }
};

// ========== UPDATE STATUS PESANAN VENDOR (pending -> preparing / shipped) ==========
exports.updateVendorOrderStatus = async (req, res) => {
  const vendorId = req.session.user.id;
  const orderId = req.params.orderId;
  const status = req.body.status;

  const valid = new Set(['preparing']);
  if (!valid.has(status)) {
    req.flash('error', 'Status tidak valid (vendor hanya boleh: Siapkan)');
    return res.redirect('/vendor/orders');
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [rows] = await conn.query(
      'SELECT * FROM vendor_order_status WHERE order_id = ? AND vendor_id = ? FOR UPDATE',
      [orderId, vendorId]
    );
    if (!rows.length) throw new Error('Tidak ada pesanan ini untuk vendor Anda');

    await conn.query(
      'UPDATE vendor_order_status SET status = ?, updated_at = NOW() WHERE order_id = ? AND vendor_id = ?',
      [status, orderId, vendorId]
    );

    // Kirim notif ke YAYASAN (bukan ke dapur)
    const [ordRows] = await conn.query(
      'SELECT yayasan_id FROM orders WHERE id = ?',
      [orderId]
    );
    if (ordRows.length) {
      const yayasanId = ordRows[0].yayasan_id;
      const notifType = status === 'shipped' ? 'vendor_shipped' : 'vendor_preparing';
      await conn.query(
        'INSERT INTO notifications (user_id, order_id, type, payload, created_at) VALUES (?,?,?,?,NOW())',
        [yayasanId, orderId, notifType, JSON.stringify({ orderId, vendorId })]
      );
    }

    await conn.commit();
    conn.release();
    req.flash('success', 'Status pesanan vendor diperbarui');
    return res.redirect('/vendor/orders');
  } catch (err) {
    await conn.rollback();
    conn.release();
    console.error('updateVendorOrderStatus error:', err);
    req.flash('error', 'Gagal memperbarui status: ' + (err.sqlMessage || err.message));
    return res.redirect('/vendor/orders');
  }
};

// ========== KIRIM SURAT JALAN (PHASE 1 – VENDOR KIRIM BARANG) ==========
exports.createVendorShipment = async (req, res) => {
  const vendorId = req.session.user.id;
  const orderId = Number(req.params.orderId);

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [vos] = await conn.query(
      'SELECT * FROM vendor_order_status WHERE order_id = ? AND vendor_id = ? FOR UPDATE',
      [orderId, vendorId]
    );
    if (!vos.length) throw new Error('Order tidak terkait dengan vendor Anda');

    const vosRow = vos[0];
    if (vosRow.status === 'shipped') {
      throw new Error('Vendor sudah menandai dikirim untuk order ini');
    }

    const [ordRows] = await conn.query(
      'SELECT * FROM orders WHERE id = ? FOR UPDATE',
      [orderId]
    );
    if (!ordRows.length) throw new Error('Order tidak ditemukan');
    const order = ordRows[0];

    if (order.status === 'completed') {
      throw new Error('Order sudah completed; tidak bisa kirim lagi');
    }

    const shipped_at = req.body.shipped_at;
    const plate = req.body.plate_number;
    const driverName = driver.name;
    const sender_name = req.body.sender_name || driverName;  // ⬅ default: nama supir
    const sender_contact = req.body.sender_contact || null;
    const note = req.body.note || null;
    const signatureDataUrl = req.body.signature_data || null;

    if (!shipped_at || !plate_number || !sender_name) {
      throw new Error('Field shipped_at, plate_number, dan sender_name wajib diisi');
    }

    // FILE SEKARANG OPSIONAL
    const file = req.file;
    let attachmentPath = null;
    if (file) {
      attachmentPath = '/uploads/shipments/' + file.filename;
    }
    // === SIMPAN TTD PENGIRIM DARI MODAL (signature_data) ===
    let senderSignaturePath = null;
    if (signatureDataUrl) {
      try {
        const match = signatureDataUrl.match(/^data:image\/\w+;base64,(.+)$/);
        const base64 = match ? match[1] : signatureDataUrl;
        const shipSignName = `shipper-sign-order${orderId}-${Date.now()}.png`;
        const shipSignAbs = path.join(signatureDir, shipSignName); // pakai folder signatures
        fs.writeFileSync(shipSignAbs, Buffer.from(base64, 'base64'));
        senderSignaturePath = '/uploads/signatures/' + shipSignName;
      } catch (e) {
        console.error('Failed saving sender signature:', e && (e.message || e));
      }
    }
    
    await conn.query(
      `INSERT INTO vendor_shipments
       (order_id, vendor_id, shipped_at, plate_number, sender_name, sender_contact, note, attachment_path, sender_signature_path, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,NOW())
       ON DUPLICATE KEY UPDATE
         shipped_at = VALUES(shipped_at),
         plate_number = VALUES(plate_number),
         sender_name = VALUES(sender_name),
         sender_contact = VALUES(sender_contact),
         note = VALUES(note),
         attachment_path = VALUES(attachment_path),
         sender_signature_path = VALUES(sender_signature_path),
         created_at = NOW()`,
      [orderId, vendorId, shipped_at, plate_number, sender_name, sender_contact, note, attachmentPath, senderSignaturePath]
    );

    await conn.query(
      'UPDATE vendor_order_status SET status = ?, updated_at = NOW() WHERE order_id = ? AND vendor_id = ?',
      ['shipped', orderId, vendorId]
    );

    // Notif ke YAYASAN
    if (order.yayasan_id) {
      await conn.query(
        'INSERT INTO notifications (user_id, order_id, type, payload, created_at) VALUES (?,?,?,?,NOW())',
        [
          order.yayasan_id,
          orderId,
          'vendor_shipped_with_doc',
          JSON.stringify({ orderId, vendorId, attachmentPath })
        ]
      );
    }

    await conn.commit();
    conn.release();

    return res.json({
      success: true,
      message: 'Surat jalan dikirim dan status vendor diperbarui'
    });
  } catch (err) {
    await conn.rollback();
    conn.release();
    console.error('createVendorShipment error:', err);
    return res.status(400).json({
      success: false,
      error: err.message || 'Gagal submit surat jalan'
    });
  }
};


// ========== FORM TANDA TANGAN DAPUR (PHASE 2 – VENDOR MINTA TTD DAPUR) ==========
exports.getSignatureForm = async (req, res) => {
  try {
    const vendorId = req.session.user.id;
    const orderId = Number(req.params.orderId);
    if (!orderId) {
      req.flash('error', 'Order ID tidak valid');
      return res.redirect('/vendor/orders');
    }

    // Pastikan order ini memang ada item milik vendor ini
    const [rows] = await pool.query(
      `SELECT 
         o.id,
         o.total,
         o.status,
         o.created_at,
         u.name AS dapur_name
       FROM orders o
       JOIN users u ON u.id = o.user_id    -- dapur
       JOIN order_items oi ON oi.order_id = o.id
       JOIN products p ON p.id = oi.product_id
       WHERE o.id = ? AND p.vendor_id = ?
       LIMIT 1`,
      [orderId, vendorId]
    );

    if (!rows.length) {
      req.flash('error', 'Order tidak ditemukan atau bukan milik vendor Anda');
      return res.redirect('/vendor/orders');
    }

    const order = rows[0];

    return res.render('vendor/order_signature', {
      title: `Tanda Tangan Dapur — Order #${orderId}`,
      order,
      currentUser: req.session.user,
      flash: req.flash && req.flash()
    });

  } catch (err) {
    console.error('getSignatureForm error:', err);
    req.flash('error', 'Gagal membuka form tanda tangan dapur');
    return res.redirect('/vendor/orders');
  }
};

// ========== SUBMIT TANDA TANGAN DAPUR (VENDOR UPLOAD VIA SIGNATURE PAD) ==========
exports.submitDapurSignature = async (req, res) => {
  const vendorId = req.session.user.id;
  const orderId = Number(req.params.orderId);

  if (!orderId) {
    req.flash('error', 'Order ID tidak valid');
    return res.redirect('/vendor/orders');
  }

  try {
    // pastikan order & relation vendor
    const [ordRows] = await pool.query(
      `SELECT 
         o.id,
         o.user_id   AS dapur_id,
         o.yayasan_id
       FROM orders o
       JOIN order_items oi ON oi.order_id = o.id
       JOIN products p ON p.id = oi.product_id
       WHERE o.id = ? AND p.vendor_id = ?
       LIMIT 1`,
      [orderId, vendorId]
    );

    if (!ordRows.length) {
      req.flash('error', 'Order tidak ditemukan atau bukan milik vendor Anda');
      return res.redirect('/vendor/orders');
    }

    const order = ordRows[0];

    // ambil sedikit detail order (total, created_at, notes) untuk delivery note
    const [orderHeaderRows] = await pool.query(
      'SELECT total, created_at, notes FROM orders WHERE id = ?',
      [orderId]
    );
    const orderHeader = orderHeaderRows[0] || {};

    const arrived_at = req.body.arrived_at ? new Date(req.body.arrived_at) : null;
    const receiver_name = req.body.receiver_name || null;
    const notes = req.body.notes || orderHeader.notes || null;

    // update catatan surat jalan ke vendor_shipments (optional)
    await pool.query(
      `UPDATE vendor_shipments
       SET note = ?, updated_at = NOW()
       WHERE order_id = ? AND vendor_id = ?`,
      [notes, orderId, vendorId]
    );

    // ====== FOTO BUKTI (upload file) ======
    let proofDataUrl = null;
    if (req.file) {
      try {
        const proofAbs = req.file.path; // path absolute dari multer
        const buf = fs.readFileSync(proofAbs);
        const mime = req.file.mimetype || 'image/jpeg';
        proofDataUrl = 'data:' + mime + ';base64,' + buf.toString('base64');
      } catch (e) {
        console.warn('Failed reading proof file:', e && (e.message || e));
      }
    }
    // ====== SIGNATURE DARI CANVAS (BASE64) ======
    const signatureDataUrl = req.body.signature_data;
    if (!signatureDataUrl) {
      req.flash('error', 'Tanda tangan wajib diisi');
      return res.redirect(`/vendor/orders/${orderId}/sign`);
    }

    // expected format: "data:image/png;base64,AAAA..."
    const match = signatureDataUrl.match(/^data:image\/\w+;base64,(.+)$/);
    const base64Data = match ? match[1] : signatureDataUrl;

    // tulis file signature asli (penerima/dapur)
    const fileName = `sign-order${orderId}-${Date.now()}.png`;
    const filePathAbs = path.join(signatureDir, fileName);
    fs.writeFileSync(filePathAbs, Buffer.from(base64Data, 'base64'));
    const signaturePath = '/uploads/signatures/' + fileName;

    // ==== GENERATE DELIVERY NOTE (HTML -> PNG) VIA PUPPETEER ====
    let deliveryNotePath = null;
    try {
      const { generateDeliveryNote } = require('../lib/deliveryNotePuppeteer');

      // prepare output dir + filename
      const deliveryNotesDir = path.join(__dirname, '../../src/public/uploads/delivery_notes');
      if (!fs.existsSync(deliveryNotesDir)) fs.mkdirSync(deliveryNotesDir, { recursive: true });
      const deliveryFileName = `delivery-note-order${orderId}-${Date.now()}.png`;
      const deliveryOutAbs = path.join(deliveryNotesDir, deliveryFileName);

      // GANTI DENGAN INI
      const [orderItemsRows] = await pool.query(
        `SELECT oi.qty, oi.price, oi.name AS oi_name, p.name AS p_name
        FROM order_items oi
        LEFT JOIN products p ON p.id = oi.product_id
        WHERE oi.order_id = ?
          AND p.vendor_id = ?
        ORDER BY oi.id`,
        [orderId, vendorId]
      );

      const items = orderItemsRows.map(r => ({
        product_name: r.oi_name || r.p_name || '-',
        qty: r.qty,
        price: r.price
      }));

      // ambil info dapur
      const [dRows] = await pool.query(
        'SELECT id, name, phone, address FROM users WHERE id = ?',
        [order.dapur_id]
      );
      const dapur = dRows[0] || {};

      // ambil info pengiriman vendor (plat, pengirim, kontak, tanggal kirim)
      const [shipRows] = await pool.query(
        `SELECT shipped_at, plate_number, sender_name, sender_contact, sender_signature_path
         FROM vendor_shipments
         WHERE order_id = ? AND vendor_id = ?
         LIMIT 1`,
        [orderId, vendorId]
      );
      const shipment = shipRows[0] || {};

      // ambil vendor info (buat header & "Mengetahui")
      const [vRows] = await pool.query(
        'SELECT id, name, phone, address FROM users WHERE id = ?',
        [vendorId]
      );
      const vendorRow = vRows[0] || {};

      let senderSignatureDataUrl = null;
      if (shipment.sender_signature_path) {
        try {
          const sigAbsPath = path.join(__dirname, '../../src/public', shipment.sender_signature_path);
          const buf = fs.readFileSync(sigAbsPath);
          senderSignatureDataUrl = 'data:image/png;base64,' + buf.toString('base64');
        } catch (e) {
          console.warn('Could not read sender signature file:', e && (e.message || e));
        }
      }
      const vendor = {
        name: vendorRow.name || 'Vendor',
        phone: vendorRow.phone || '',
        address: vendorRow.address || '',
        sender_name: shipment.sender_name || '',
        sender_contact: shipment.sender_contact || '',
        plate_number: shipment.plate_number || '',
        shipped_at: shipment.shipped_at || null,
        sender_signatureDataUrl: senderSignatureDataUrl
      };

      // call generator
      await generateDeliveryNote({
        outPath: deliveryOutAbs,
        order: {
          id: orderId,
          total: orderHeader.total || 0,
          dapur_name: dapur.name,
          dapur_phone: dapur.phone,
          dapur_address: dapur.address,
          notes: notes,
          created_at: arrived_at || orderHeader.created_at || new Date(),
          receiver_name // nama penerima (dapur) buat di bawah TTD
        },
        items,
        vendor,
        signatureDataUrl, // TTD Penerima (dapur)
        proofDataUrl      // ⬅️ FOTO BUKTI
      });

      deliveryNotePath = '/uploads/delivery_notes/' + deliveryFileName;

      // simpan path ke vendor_shipments (prefer delivery_note_path -> attachment_path)
      try {
        await pool.query(
          'UPDATE vendor_shipments SET delivery_note_path = ?, updated_at = NOW() WHERE order_id = ? AND vendor_id = ?',
          [deliveryNotePath, orderId, vendorId]
        );
      } catch (e) {
        try {
          await pool.query(
            'UPDATE vendor_shipments SET attachment_path = ?, updated_at = NOW() WHERE order_id = ? AND vendor_id = ?',
            [deliveryNotePath, orderId, vendorId]
          );
        } catch (e2) {
          try {
            await pool.query(
              `INSERT INTO vendor_shipments (order_id, vendor_id, attachment_path, created_at)
               VALUES (?,?,?,NOW())`,
              [orderId, vendorId, deliveryNotePath]
            );
          } catch (e3) {
            console.warn(
              'Could not persist delivery note path to vendor_shipments:',
              e3 && e3.message ? e3.message : e3
            );
          }
        }
      }
    } catch (genErr) {
      console.error(
        'generateDeliveryNote (puppeteer) failed:',
        genErr && (genErr.stack || genErr.message || genErr)
      );
    }

    // ==== SIMPAN DELIVERY CONFIRMATION ====
    await pool.query(
      'DELETE FROM delivery_confirmations WHERE order_id = ? AND yayasan_id = ?',
      [orderId, order.yayasan_id || null]
    );

    await pool.query(
      `INSERT INTO delivery_confirmations
       (order_id, user_id, yayasan_id, arrived_at, notes, receiver_name, signature_path, created_at)
       VALUES (?,?,?,?,?,?,?,NOW())`,
      [
        orderId,
        order.dapur_id,
        order.yayasan_id || null,
        arrived_at,
        notes,
        receiver_name,
        signaturePath
      ]
    );

    // Notif ke yayasan
    if (order.yayasan_id) {
      await pool.query(
        'INSERT INTO notifications (user_id, order_id, type, payload, created_at) VALUES (?,?,?,?,NOW())',
        [
          order.yayasan_id,
          orderId,
          'delivery_confirmed',
          JSON.stringify({ orderId, byVendor: vendorId, deliveryNotePath })
        ]
      );
    }

    req.flash('success', 'Tanda tangan dapur berhasil disimpan & dikirim ke yayasan');
    return res.redirect('/vendor/orders');
  } catch (err) {
    console.error('submitDapurSignature error:', err && (err.stack || err.message || err));
    req.flash('error', 'Gagal menyimpan tanda tangan dapur');
    return res.redirect('/vendor/orders');
  }
};

exports.editProductForm = async (req, res) => {
  const { id } = req.params;

  const currentUser =
    req.user ||
    res.locals.currentUser ||
    (req.session && (req.session.user || req.session.currentUser)) ||
    null;

  if (!currentUser) {
    return res.redirect('/login');
  }

  const vendorId = currentUser.id;

  try {
    const [rows] = await pool.query(
      'SELECT * FROM products WHERE id = ? AND vendor_id = ?',
      [id, vendorId]
    );

    if (!rows.length) {
      req.flash && req.flash('error', 'Produk tidak ditemukan');
      return res.redirect('/vendor/dashboard');
    }

    const product = rows[0];

    return res.render('vendor/edit_product', {
      title: 'Edit Produk',
      product,
      messages: {
        error: req.flash ? req.flash('error') : null,
        success: req.flash ? req.flash('success') : null,
      },
      csrfToken: req.csrfToken ? req.csrfToken() : null,
    });
  } catch (err) {
    console.error('Error editProductForm:', err);
    req.flash && req.flash('error', 'Gagal memuat data produk');
    return res.redirect('/vendor/dashboard');
  }
};

// UPDATE PRODUK
exports.updateProduct = async (req, res) => {
  const { id } = req.params;

  const currentUser =
    req.user ||
    res.locals.currentUser ||
    (req.session && (req.session.user || req.session.currentUser)) ||
    null;

  if (!currentUser) return res.redirect('/login');

  const vendorId = currentUser.id;
  const { name, price, stock, unit, category } = req.body;

  // ⬅ Tambahan untuk update gambar baru
  const newImage = req.file ? `/uploads/${req.file.filename}` : null;

  try {
    // default update tanpa gambar dulu
    let query = `
      UPDATE products SET name=?, price=?, stock=?, unit=?, category=?
    `;
    const params = [name, Number(price)||0, Number(stock)||0, unit||null, category||null];

    // kalau user upload gambar baru → update kolom image juga
    if (newImage) {
      query += `, image=?`;
      params.push(newImage);
    }

    query += ` WHERE id=? AND vendor_id=?`;
    params.push(id, vendorId);

    await pool.query(query, params);

    req.flash && req.flash('success', 'Produk berhasil diperbarui');
    return res.redirect('/vendor/dashboard');
  } catch (err) {
    console.error('Error updateProduct:', err);
    req.flash && req.flash('error', 'Gagal memperbarui produk');
    return res.redirect(`/vendor/products/${id}/edit`);
  }
};


// HAPUS PRODUK
exports.deleteProduct = async (req, res) => {
  const { id } = req.params;
  const vendorId = req.session.user.id;

  try {
    await pool.query(
      'DELETE FROM products WHERE id = ? AND vendor_id = ?',
      [id, vendorId]
    );
    req.flash('success', 'Produk berhasil dihapus');
  } catch (err) {
    console.error('deleteProduct error:', err);
    req.flash('error', 'Gagal menghapus produk');
  }

  return res.redirect('/vendor/dashboard');
};

exports.listDrivers = async (req, res) => {
  const vendorId = req.session.user.id;
  const [rows] = await pool.query(
    'SELECT id, name, email FROM users WHERE role = "driver" AND vendor_id = ?',
    [vendorId]
  );
  res.render('vendor/drivers', { drivers: rows });
};

exports.createDriver = async (req, res) => {
  try {
    const vendorId = req.session.user.id;
    const { name, email } = req.body;
    let { password } = req.body;

    if (!name || !email) {
      req.flash('error', 'Nama dan email supir wajib diisi');
      return res.redirect('/vendor/dashboard');
    }

    // kalau password kosong, pakai default
    if (!password || !password.trim()) {
      password = 'password123';
    }

    const hashed = await bcrypt.hash(password, 10);

    await pool.query(
      `INSERT INTO users (name, email, password, role, vendor_id)
       VALUES (?, ?, ?, 'driver', ?)`,
      [name, email, hashed, vendorId]
    );

    req.flash('success', 'Akun supir berhasil dibuat');
    return res.redirect('/vendor/dashboard');
  } catch (err) {
    console.error('createDriver error:', err);
    req.flash(
      'error',
      'Gagal membuat akun supir: ' + (err.sqlMessage || err.message)
    );
    return res.redirect('/vendor/dashboard');
  }
};
