const pool = require('../models/db');


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

    const [products] = await pool.query(sql, params);

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
      WHERE 1 = 1
    `;
    const params = [];

    if (search) {
      sql += ' AND (p.name LIKE ? OR p.category LIKE ? OR u.name LIKE ?)';
      const like = `%${search}%`;
      params.push(like, like, like);
    }

    sql += ' ORDER BY p.created_at DESC';

    const [products] = await pool.query(sql, params);

    res.json({ products });

  } catch (err) {
    console.error(err);
    res.status(500).json({
      products: [],
      error: 'Gagal melakukan pencarian'
    });
  }
};
