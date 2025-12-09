// src/controllers/driverController.js
const pool = require('../models/db');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const { generateDeliveryNote } = require('../lib/deliveryNotePuppeteer');

// folder shipments (sudah ada)
const shipmentDir = path.join(__dirname, '../../src/public/uploads/shipments');
if (!fs.existsSync(shipmentDir)) fs.mkdirSync(shipmentDir, { recursive: true });
const uploadShipment = multer({ dest: shipmentDir });
exports.uploadShipment = uploadShipment.single('delivery_attachment');

// folder untuk foto bukti penerimaan (proof)
const proofDir = path.join(__dirname, '../../src/public/uploads/proofs');
if (!fs.existsSync(proofDir)) fs.mkdirSync(proofDir, { recursive: true });
const proofUpload = multer({ dest: proofDir });
exports.uploadProof = proofUpload.single('proof_file');

// folder untuk tanda tangan (dapur & pengirim)
const signatureDir = path.join(__dirname, '../../src/public/uploads/signatures');
if (!fs.existsSync(signatureDir)) fs.mkdirSync(signatureDir, { recursive: true });

// =======================
// SUPIR – LIST ORDER
// =======================
exports.getDriverOrders = async (req, res) => {
    try {
        const driver = req.session.user;
        if (!driver) {
            req.flash && req.flash('error', 'Silakan login terlebih dahulu');
            return res.redirect('/login');
        }
        const vendorId = driver.vendor_id;

        // ambil orders + apakah ada vendor_shipments + apakah ada delivery_confirmations + info dapur (user)
        const [rows] = await pool.query(
            `SELECT
         vos.id AS vos_id,
         vos.order_id,
         vos.status AS vendor_status,
         o.total AS order_total,
         o.status AS order_status,
         o.user_id AS dapur_id,
         o.created_at AS order_created,
         oi.id AS order_item_id,
         oi.product_id,
         oi.qty,
         oi.price,
         p.name AS product_name,
         vs.id AS shipment_id,
         vs.attachment_path,
         vs.sender_signature_path,
         vs.delivery_note_path,
         vs.tracking_number,
         (CASE WHEN dc.id IS NOT NULL THEN 1 ELSE 0 END) AS delivery_confirmed,
         u.name AS dapur_name,
         u.phone AS dapur_phone,
         u.address AS dapur_address
       FROM vendor_order_status vos
       JOIN orders o ON o.id = vos.order_id
       JOIN users u ON u.id = o.user_id
       JOIN order_items oi ON oi.order_id = o.id
       JOIN products p ON p.id = oi.product_id
       LEFT JOIN vendor_shipments vs
         ON vs.order_id = vos.order_id
         AND vs.vendor_id = vos.vendor_id
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
                    order_status: r.order_status,
                    dapur_id: r.dapur_id,
                    created_at: r.order_created,
                    vendor_status: r.vendor_status,
                    has_delivery_note: !!r.delivery_note_path,
                    shipment_id: r.shipment_id || null,
                    tracking_number: r.tracking_number || null,
                    can_edit_by_driver: !(r.tracking_number), // true kalau tracking_number null/empty
                    shipment_final: !!r.sender_signature_path || !!r.delivery_note_path,
                    shipment_sent: !!r.sender_signature_path || !!r.attachment_path || !!r.delivery_note_path,
                    delivery_confirmed: !!r.delivery_confirmed,
                    // dapur contact
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
        return res.render('vendor/orders', {
            title: 'Pesanan Untuk Dikirim',
            orders,
            currentUser: req.session.user
        });
    } catch (err) {
        console.error('getDriverOrders error:', err);
        req.flash && req.flash('error', 'Gagal mengambil pesanan untuk supir');
        return res.redirect('/login');
    }
};

// =======================
// SUPIR – BUAT SURAT JALAN
// =======================
// POST /driver/orders/:orderId/ship
exports.createDriverShipment = async (req, res) => {
    const driver = req.session.user;
    if (!driver) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    const vendorId = driver.vendor_id;
    const orderId = Number(req.params.orderId);

    const conn = await pool.getConnection();
    try {
        await conn.beginTransaction();

        // pastikan relation vendor -> order (lock)
        const [vos] = await conn.query(
            'SELECT * FROM vendor_order_status WHERE order_id = ? AND vendor_id = ? FOR UPDATE',
            [orderId, vendorId]
        );
        if (!vos.length) throw new Error('Order tidak untuk vendor ini');

        // ambil shipment existing (lock)
        const [existingShipmentRows] = await conn.query(
            'SELECT id, attachment_path, sender_signature_path, tracking_number FROM vendor_shipments WHERE order_id = ? AND vendor_id = ? LIMIT 1 FOR UPDATE',
            [orderId, vendorId]
        );

        // if exists -> check tracking_number (tracking_number used as "edit used" flag)
        let isEdit = false;
        if (existingShipmentRows.length) {
            const exist = existingShipmentRows[0];
            if (exist.tracking_number) {
                // edit sudah dipakai -> tolak
                throw new Error('Surat jalan tidak bisa diubah lagi (batas edit telah dipakai)');
            }
            isEdit = true;
        }

        // ambil order header untuk validasi
        const [ordRows] = await conn.query('SELECT * FROM orders WHERE id = ? FOR UPDATE', [orderId]);
        if (!ordRows.length) throw new Error('Order tidak ditemukan');
        const order = ordRows[0];
        if (order.status === 'completed') throw new Error('Order sudah completed; tidak bisa kirim lagi');

        // read input
        const shipped_at = req.body.shipped_at;
        const plate_number = req.body.plate_number || req.body.plate || null;
        const sender_name = (req.body.sender_name || (driver && driver.name) || '').trim();
        const sender_contact = req.body.sender_contact || null;
        const note = req.body.note || null;

        if (!shipped_at || !plate_number || !sender_name) {
            throw new Error('Field shipped_at, plate_number, dan sender_name wajib diisi');
        }

        // file opsional
        let attachmentPath = existingShipmentRows.length ? existingShipmentRows[0].attachment_path : null;
        if (req.file) {
            attachmentPath = '/uploads/shipments/' + req.file.filename;
        }

        // signature dataURL opsional
        let senderSignaturePath = existingShipmentRows.length ? existingShipmentRows[0].sender_signature_path : null;
        const signatureDataUrl = req.body.signature_data;
        if (signatureDataUrl) {
            try {
                const match = signatureDataUrl.match(/^data:image\/\w+;base64,(.+)$/);
                const base64 = match ? match[1] : signatureDataUrl;
                const fname = `driver-sign-${orderId}-${Date.now()}.png`;
                const abs = path.join(shipmentDir, fname);
                fs.writeFileSync(abs, Buffer.from(base64, 'base64'));
                // save into shipments folder (same folder as attachments)
                senderSignaturePath = '/uploads/shipments/' + fname;
            } catch (e) {
                console.warn('Failed saving driver signature:', e && e.message);
            }
        }

        // Simpan: jika isEdit -> UPDATE dan tandai tracking_number (edit dipakai)
        if (isEdit) {
            const token = `edited-by-driver:${Date.now()}`;
            await conn.query(
                `UPDATE vendor_shipments
         SET shipped_at = ?, plate_number = ?, sender_name = ?, sender_contact = ?, note = ?, attachment_path = ?, sender_signature_path = ?, tracking_number = ?, updated_at = NOW()
         WHERE order_id = ? AND vendor_id = ?`,
                [shipped_at, plate_number, sender_name, sender_contact, note, attachmentPath, senderSignaturePath, token, orderId, vendorId]
            );
        } else {
            // INSERT new shipment (leave tracking_number NULL so driver can still edit once later)
            await conn.query(
                `INSERT INTO vendor_shipments
         (order_id, vendor_id, shipped_at, plate_number, sender_name, sender_contact, note, attachment_path, sender_signature_path, created_at)
         VALUES (?,?,?,?,?,?,?,?,?,NOW())`,
                [orderId, vendorId, shipped_at, plate_number, sender_name, sender_contact, note, attachmentPath, senderSignaturePath]
            );
        }

        // set vendor_order_status -> shipped (idempotent)
        await conn.query(
            `UPDATE vendor_order_status
       SET status = 'shipped', updated_at = NOW()
       WHERE order_id = ? AND vendor_id = ?`,
            [orderId, vendorId]
        );

        // notif ke yayasan jika ada
        if (order.yayasan_id) {
            await conn.query(
                'INSERT INTO notifications (user_id, order_id, type, payload, created_at) VALUES (?,?,?,?,NOW())',
                [order.yayasan_id, orderId, 'vendor_shipped_with_doc', JSON.stringify({ orderId, vendorId, attachmentPath })]
            );
        }

        await conn.commit();
        conn.release();

        return res.json({
            success: true,
            message: 'Surat jalan dikirim dan status vendor diperbarui'
        });
    } catch (err) {
        try { await conn.rollback(); } catch (_) { }
        try { conn.release(); } catch (_) { }
        console.error('createDriverShipment error:', err && (err.stack || err.message || err));
        return res.status(400).json({
            success: false,
            error: err.message || 'Gagal submit surat jalan'
        });
    }
};

// =======================
// SUPIR – FORM TTD DAPUR
// =======================
exports.getSignatureForm = async (req, res) => {
    try {
        const driver = req.session.user;
        if (!driver) {
            req.flash && req.flash('error', 'Silakan login sebagai supir');
            return res.redirect('/login');
        }
        const vendorId = driver.vendor_id;
        const orderId = Number(req.params.orderId);

        if (!orderId) {
            req.flash && req.flash('error', 'Order ID tidak valid');
            return res.redirect('/driver/orders');
        }

        const [rows] = await pool.query(
            `SELECT 
         o.id,
         o.total,
         o.status,
         o.created_at,
         u.name AS dapur_name
       FROM orders o
       JOIN users u ON u.id = o.user_id
       JOIN order_items oi ON oi.order_id = o.id
       JOIN products p ON p.id = oi.product_id
       WHERE o.id = ? AND p.vendor_id = ?
       LIMIT 1`,
            [orderId, vendorId]
        );

        if (!rows.length) {
            req.flash && req.flash('error', 'Order tidak ditemukan atau bukan milik vendor Anda');
            return res.redirect('/driver/orders');
        }

        const order = rows[0];
        return res.render('vendor/order_signature', {
            title: `Tanda Tangan Dapur — Order #${orderId}`,
            order,
            currentUser: req.session.user,
            flash: req.flash && req.flash()
        });
    } catch (err) {
        console.error('driver.getSignatureForm error:', err);
        req.flash && req.flash('error', 'Gagal membuka form tanda tangan dapur');
        return res.redirect('/driver/orders');
    }
};

// =======================
// SUPIR – SUBMIT TTD DAPUR
// =======================
exports.submitDapurSignature = async (req, res) => {
    const driver = req.session.user;
    if (!driver) {
        req.flash && req.flash('error', 'Unauthorized');
        return res.redirect('/login');
    }
    const vendorId = driver.vendor_id;
    const orderId = Number(req.params.orderId);

    if (!orderId) {
        req.flash && req.flash('error', 'Order ID tidak valid');
        return res.redirect('/driver/orders');
    }

    const conn = await pool.getConnection();
    try {
        await conn.beginTransaction();

        // pastikan order & relation vendor
        const [ordRows] = await conn.query(
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
            throw new Error('Order tidak ditemukan atau bukan milik vendor Anda');
        }
        const order = ordRows[0];

        const [orderHeaderRows] = await conn.query('SELECT total, created_at, notes FROM orders WHERE id = ?', [orderId]);
        const orderHeader = orderHeaderRows[0] || {};

        const arrived_at = req.body.arrived_at ? new Date(req.body.arrived_at) : null;
        const receiver_name = req.body.receiver_name || null;
        const notes = req.body.notes || orderHeader.notes || null;

        // update catatan surat jalan ke vendor_shipments (optional)
        await conn.query(
            `UPDATE vendor_shipments
       SET note = ?, updated_at = NOW()
       WHERE order_id = ? AND vendor_id = ?`,
            [notes, orderId, vendorId]
        );

        // FOTO BUKTI (upload file) -> buat dataURL untuk generateDeliveryNote
        let proofDataUrl = null;
        if (req.file) {
            try {
                const proofAbs = req.file.path;
                const buf = fs.readFileSync(proofAbs);
                const mime = req.file.mimetype || 'image/jpeg';
                proofDataUrl = 'data:' + mime + ';base64,' + buf.toString('base64');
            } catch (e) {
                console.warn('Failed reading proof file:', e && e.message);
            }
        }

        // SIGNATURE DARI CANVAS (BASE64)
        const signatureDataUrl = req.body.signature_data;
        if (!signatureDataUrl) {
            req.flash && req.flash('error', 'Tanda tangan wajib diisi');
            return res.redirect(`/driver/orders/${orderId}/sign`);
        }

        const match = signatureDataUrl.match(/^data:image\/\w+;base64,(.+)$/);
        const base64Data = match ? match[1] : signatureDataUrl;

        const fileName = `sign-order${orderId}-${Date.now()}.png`;
        const filePathAbs = path.join(signatureDir, fileName);
        fs.writeFileSync(filePathAbs, Buffer.from(base64Data, 'base64'));
        const signaturePath = '/uploads/signatures/' + fileName;

        // GENERATE DELIVERY NOTE VIA PUPPETEER (opsional, jangan fatal kalau gagal)
        let deliveryNotePath = null;
        try {
            const deliveryNotesDir = path.join(__dirname, '../../src/public/uploads/delivery_notes');
            if (!fs.existsSync(deliveryNotesDir)) fs.mkdirSync(deliveryNotesDir, { recursive: true });
            const deliveryFileName = `delivery-note-order${orderId}-${Date.now()}.png`;
            const deliveryOutAbs = path.join(deliveryNotesDir, deliveryFileName);

            const [orderItemsRows] = await conn.query(
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

            const [dRows] = await conn.query('SELECT id, name, phone, address FROM users WHERE id = ?', [order.dapur_id]);
            const dapur = dRows[0] || {};

            const [shipRows] = await conn.query(
                `SELECT shipped_at, plate_number, sender_name, sender_contact, sender_signature_path
         FROM vendor_shipments
         WHERE order_id = ? AND vendor_id = ?
         LIMIT 1`,
                [orderId, vendorId]
            );
            const shipment = shipRows[0] || {};

            const [vRows] = await conn.query('SELECT id, name, phone, address FROM users WHERE id = ?', [vendorId]);
            const vendorRow = vRows[0] || {};

            let senderSignatureDataUrl = null;
            if (shipment.sender_signature_path) {
                try {
                    const sigAbsPath = path.join(__dirname, '../../src/public', shipment.sender_signature_path);
                    const buf = fs.readFileSync(sigAbsPath);
                    senderSignatureDataUrl = 'data:image/png;base64,' + buf.toString('base64');
                } catch (e) {
                    console.warn('Could not read sender signature file:', e && e.message);
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
                    receiver_name
                },
                items,
                vendor,
                signatureDataUrl, // TTD dapur
                proofDataUrl      // foto bukti
            });

            deliveryNotePath = '/uploads/delivery_notes/' + deliveryFileName;

            // simpan path ke vendor_shipments (prefer delivery_note_path)
            try {
                await conn.query(
                    'UPDATE vendor_shipments SET delivery_note_path = ?, updated_at = NOW() WHERE order_id = ? AND vendor_id = ?',
                    [deliveryNotePath, orderId, vendorId]
                );
            } catch (e) {
                try {
                    await conn.query(
                        'UPDATE vendor_shipments SET attachment_path = ?, updated_at = NOW() WHERE order_id = ? AND vendor_id = ?',
                        [deliveryNotePath, orderId, vendorId]
                    );
                } catch (e2) {
                    await conn.query(
                        `INSERT INTO vendor_shipments (order_id, vendor_id, attachment_path, created_at)
             VALUES (?,?,?,NOW())`,
                        [orderId, vendorId, deliveryNotePath]
                    );
                }
            }
        } catch (genErr) {
            console.error('driver.generateDeliveryNote failed:', genErr && (genErr.stack || genErr.message || genErr));
        }

        const [existingDc] = await conn.query(
            'SELECT id FROM delivery_confirmations WHERE order_id = ? LIMIT 1 FOR UPDATE',
            [orderId]
        );
        if (existingDc.length) {
            throw new Error('Konfirmasi pengiriman (tanda tangan dapur) sudah dicatat sebelumnya — tidak bisa diubah lagi');
        }

        // SIMPAN DELIVERY CONFIRMATION
        await conn.query('DELETE FROM delivery_confirmations WHERE order_id = ? AND yayasan_id = ?', [orderId, order.yayasan_id || null]);

        await conn.query(
            `INSERT INTO delivery_confirmations
       (order_id, user_id, yayasan_id, arrived_at, notes, receiver_name, signature_path, created_at)
       VALUES (?,?,?,?,?,?,?,NOW())`,
            [orderId, order.dapur_id, order.yayasan_id || null, arrived_at, notes, receiver_name, signaturePath]
        );

        // lock edits on vendor_shipments (set tracking_number to finalized)
        try {
            await conn.query(
                'UPDATE vendor_shipments SET tracking_number = ? WHERE order_id = ? AND vendor_id = ?',
                [`finalized:${Date.now()}`, orderId, vendorId]
            );
        } catch (e) {
            console.warn('Could not set tracking_number on finalize:', e && e.message);
        }

        // notif ke yayasan
        if (order.yayasan_id) {
            await conn.query(
                'INSERT INTO notifications (user_id, order_id, type, payload, created_at) VALUES (?,?,?,?,NOW())',
                [order.yayasan_id, orderId, 'delivery_confirmed', JSON.stringify({ orderId, byVendor: vendorId, deliveryNotePath })]
            );
        }

        await conn.commit();
        req.flash && req.flash('success', 'Tanda tangan dapur berhasil disimpan & dikirim ke yayasan');
        return res.redirect('/driver/orders');
    } catch (err) {
        try { await conn.rollback(); } catch (_) { }
        console.error('driver.submitDapurSignature error:', err && (err.stack || err.message || err));
        req.flash && req.flash('error', 'Gagal menyimpan tanda tangan dapur: ' + (err.message || 'unknown'));
        return res.redirect('/driver/orders');
    } finally {
        try { conn.release(); } catch (_) { }
    }
};
