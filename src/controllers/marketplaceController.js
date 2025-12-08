const pool = require('../models/db');

// ===============================
// NORMALIZER KATEGORI
// ===============================
function normalizeCategory(cat) {
  if (!cat) return "other";

  const c = String(cat).trim().toLowerCase();

  if (c.includes("sayur")) return "Sayuran";
  if (c.includes("daging")) return "Daging";
  if (c.includes("sembako")) return "Sembako";

  return "other";
}

// ===============================
// DETAIL PRODUK
// ===============================
exports.detail = async (req, res) => {
  try {
    const productId = req.params.id;

    const sql = `
      SELECT p.*, u.name AS vendor_name, u.email AS vendor_email
      FROM products p
      JOIN users u ON u.id = p.vendor_id
      WHERE p.id = ?
    `;

    const [rows] = await pool.query(sql, [productId]);

    if (rows.length === 0) {
      req.flash('error', 'Produk tidak ditemukan');
      return res.redirect('/market');
    }

    const product = rows[0];

    const relatedSql = `
      SELECT p.*, u.name AS vendor_name
      FROM products p
      JOIN users u ON u.id = p.vendor_id
      WHERE p.category = ? AND p.id != ?
      ORDER BY p.created_at DESC
      LIMIT 4
    `;

    const [relatedProducts] = await pool.query(relatedSql, [
      product.category,
      product.id
    ]);

    res.render('marketplace/product_detail', {
      title: `${product.name} - Detail Produk`,
      product,
      relatedProducts,
      currentPage: 'market'
    });

  } catch (err) {
    console.error(err);
    req.flash('error', 'Gagal memuat detail produk');
    res.redirect('/market');
  }
};



// ===============================
// LIST PRODUK
// ===============================
exports.list = async (req, res) => {
  try {
    const search = (req.query.q || '').trim();

    let sql = `
      SELECT p.*, u.name AS vendor_name
      FROM products p
      JOIN users u ON u.id = p.vendor_id
      WHERE 1 = 1
    `;
    const params = [];

    if (search) {
      sql += ' AND (p.name LIKE ? OR p.category LIKE ? OR u.name LIKE ?)';
      const like = `%${search}%`;
      params.push(like, like, like);
    }

    sql += ' ORDER BY p.created_at DESC';

    const [rows] = await pool.query(sql, params);

    // =======================
    // FIX PALING KRITIKAL
    // =======================
    const products = rows.map(p => ({
      ...p,
      price: Number(p.price || 0),
      stock: Number(p.stock || 0),
      category: normalizeCategory(p.category)
    }));

    res.render('marketplace/list', {
      title: 'Marketplace Bahan Makanan',
      products,
      currentPage: 'market',
      searchQuery: search
    });

  } catch (err) {
    console.error(err);
    req.flash('error', 'Gagal memuat produk');
    res.redirect('/market');
  }
};

// ===============================
// LIVE SEARCH
// ===============================
exports.liveSearch = async (req, res) => {
  try {
    const search = (req.query.q || '').trim();

    let sql = `
      SELECT p.*, u.name AS vendor_name
      FROM products p
      JOIN users u ON u.id = p.vendor_id
      WHERE p.name LIKE ? OR p.category LIKE ? OR u.name LIKE ?
      ORDER BY p.created_at DESC
    `;

    const like = `%${search}%`;
    const [rows] = await pool.query(sql, [like, like, like]);

    const products = rows.map(p => ({
      ...p,
      price: Number(p.price || 0),
      stock: Number(p.stock || 0),
      category: normalizeCategory(p.category)   // ⬅️ pakai normalizer yang sama
    }));

    res.render('marketplace/live_products', { products });

  } catch (err) {
    console.error(err);
    res.send('');
  }
};
