// src/lib/deliveryNotePuppeteer.js
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');

/**
 * generate delivery note PNG using puppeteer (HTML -> screenshot)
 * opts:
 *  - outPath: absolute path for PNG file
 *  - order: { id, total, dapur_name, dapur_phone, dapur_address, created_at, notes, receiver_name? }
 *  - items: [{ product_name, qty, price }]
 *  - vendor: {
 *      name,
 *      phone?,
 *      address?,
 *      logo_url?,
 *      sender_name?,
 *      sender_contact?,
 *      plate_number?,
 *      shipped_at?
 *    }
 *  - signatureDataUrl: dataURL (png) of signature PENERIMA (dapur)
 */
async function generateDeliveryNote({ outPath, order, items = [], vendor = {}, signatureDataUrl = null, proofDataUrl = null }) {
  const dir = path.dirname(outPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const html = buildHtml({ order, items, vendor, signatureDataUrl, proofDataUrl });

  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  try {
    const page = await browser.newPage();

    const width = 1200;
    await page.setViewport({ width, height: 1200, deviceScaleFactor: 1 });

    await page.setContent(html, { waitUntil: ['load', 'domcontentloaded'] });

    await sleep(200);

    await page.screenshot({
      path: outPath,
      fullPage: true,   // ⬅️ ini yang penting
      omitBackground: false
    });
    return outPath;
  } finally {
    try { await browser.close(); } catch (_) { }
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function escapeHtml(s) {
  if (!s) return '';
  return String(s).replace(/[&<>"']/g, m => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[m]);
}

function receiverNameFromOrder(order) {
  return order.receiver_name || '';
}

// ==================== TEMPLATE SURAT JALAN ====================
function buildHtml({ order, items, vendor, signatureDataUrl, proofDataUrl }) {
  const itemsRows = (items || []).map((it, idx) => {
    const name = escapeHtml(it.product_name || '-');
    const qty = escapeHtml(String(it.qty || ''));
    const price = Number(it.price) || 0;
    const ket = `Rp ${price.toLocaleString('id-ID')}`;
    return `
      <tr>
        <td style="border:1px solid #000;padding:4px 6px;text-align:center;">${idx + 1}</td>
        <td style="border:1px solid #000;padding:4px 6px;">${name}</td>
        <td style="border:1px solid #000;padding:4px 6px;text-align:center;">${qty}</td>
        <td style="border:1px solid #000;padding:4px 6px;">${ket}</td>
      </tr>
    `;
  }).join('\n');

  const dapurName = escapeHtml(order.dapur_name || '');
  const dapurPhone = escapeHtml(order.dapur_phone || '');
  const dapurAddress = escapeHtml(order.dapur_address || '');
  const vendorName = escapeHtml(vendor.name || '');
  const vendorPhone = escapeHtml(vendor.phone || '');
  const vendorAddress = escapeHtml(vendor.address || '');
  const totalFormatted = (Number(order.total) || 0).toLocaleString('id-ID');

  const dateObj = new Date(order.created_at || Date.now());
  const tglStr = dateObj.toLocaleDateString('id-ID', {
    day: 'numeric',
    month: 'long',
    year: 'numeric'
  });

  const notes = escapeHtml(order.notes || '');
  const receiverName = escapeHtml(receiverNameFromOrder(order));

  const senderName = escapeHtml(vendor.sender_name || vendorName || '');
  const senderContact = escapeHtml(vendor.sender_contact || '');
  const plateNumber = escapeHtml(vendor.plate_number || '');
  const shippedDateStr = vendor.shipped_at
    ? new Date(vendor.shipped_at).toLocaleDateString('id-ID')
    : '';
  const senderSignDataUrl = vendor.sender_signatureDataUrl || null;

  const senderSignImgHtml = senderSignDataUrl
    ? `<img src="${senderSignDataUrl}" style="max-width:200px; max-height:70px; display:block; object-fit:contain; margin:0 auto 6px auto;"/>`
    : `<div style="width:200px;height:70px;border:1px solid #ccc;margin:0 auto 6px auto;"></div>`;

  const signatureImgHtml = signatureDataUrl
    ? `<img src="${signatureDataUrl}" style="max-width:200px; max-height:70px; display:block; object-fit:contain; margin:0 auto 6px auto;"/>`
    : `<div style="width:200px;height:70px;border:1px solid #ccc;margin:0 auto 6px auto;"></div>`;

  const proofImgHtml = proofDataUrl
    ? `<img src="${proofDataUrl}"
           style="display:block; margin:0 auto;
                  max-width:600px; width:70%;
                  height:auto;
                  border:1px solid #000; border-radius:4px;"/>`
    : `<div style="width:70%; max-width:600px; height:180px;
                margin:0 auto;
                border:1px solid #000; border-radius:4px;
                display:flex; align-items:center; justify-content:center;
                font-size:11px; color:#777;">
       Foto bukti penerimaan barang
     </div>`;

  return `
  <!doctype html>
  <html>
    <head>
      <meta charset="utf-8"/>
      <title>Surat Jalan - Order ${escapeHtml(order.id)}</title>
      <style>
        * { box-sizing: border-box; }
        body {
          font-family: Arial, Helvetica, sans-serif;
          font-size: 12px;
          color: #000;
          margin: 0;
          padding: 0;
          background: #ffffff;
        }
        .page {
          width: 1120px;
          margin: 20px auto;
          padding: 24px 32px 28px 32px;
          border: 1px solid #000;
        }
        .header-row {
          display:flex;
          justify-content:space-between;
          align-items:flex-start;
        }
        .header-left {
          max-width:65%;
        }
        .company-name {
          font-size:18px;
          font-weight:bold;
        }
        .company-address {
          margin-top:4px;
          font-size:11px;
          line-height:1.3;
        }
        .header-right {
          font-size:11px;
          text-align:left;
          min-width:220px;
        }
        .header-right-label {
          font-weight:bold;
          text-transform:uppercase;
        }
        .line {
          border-bottom:1px solid #000;
          min-height:10px;
          margin:2px 0 4px 0;
        }
        .title {
          text-align:center;
          margin-top:10px;
          margin-bottom:6px;
          font-size:16px;
          font-weight:bold;
          text-transform:uppercase;
        }
        .no-row {
          font-size:12px;
          margin-bottom:4px;
        }
        .info-text {
          font-size:12px;
          margin-bottom:8px;
        }
        table {
          border-collapse: collapse;
          width: 100%;
        }
        .items-table th {
          border:1px solid #000;
          padding:4px 6px;
          font-size:12px;
          text-align:center;
        }
        .items-table td {
          font-size:12px;
        }
        .notes {
          font-size:12px;
          margin-top:8px;
        }
        .notes-box {
          border:1px solid #000;
          min-height:40px;
          padding:4px 6px;
          margin-top:2px;
        }
        .total-row {
          font-size:12px;
          margin-top:6px;
        }
        .sign-section {
          margin-top:26px;
          font-size:12px;
        }
        .sign-top {
          text-align:right;
          margin-bottom:18px;
        }
        .sign-columns {
          display:flex;
          justify-content:space-between;
          text-align:center;
        }
        .sign-col {
          width:32%;
        }
        .sign-name {
          margin-top:4px;
        }
        .sign-label {
          margin-bottom:50px;
        }
        .separator-line {
          margin-top:22px;
          border-top:1px solid #000;
        }
        .proof-section {
          margin-top:10px;
          font-size:12px;
        }
        .proof-title {
          font-weight:bold;
          margin-bottom:6px;
        .proof-wrapper {
          margin-top:4px;
          text-align:center;
        } 
      </style>
    </head>
    <body>
      <div class="page">
        <!-- HEADER -->
        <div class="header-row">
          <div class="header-left">
            <div class="company-name">MBG</div>
            <div class="company-address">
              Jl. Tanjung Duren Barat III No.12B, RT.7/RW.5, Tj. Duren Utara, Kec. Grogol petamburan, Kota Jakarta Barat, Daerah Khusus Ibukota Jakarta 11470<br/>
              Telp: 0855-1888-190
            </div>
          </div>
          <div class="header-right">
            <div class="header-right-label">Kepada</div>
            Yth.<br/>
            <div class="line">${dapurName}</div>
            <div class="line">${dapurAddress}</div>
            <div class="line">${dapurPhone}</div>
          </div>
        </div>

        <!-- JUDUL -->
        <div class="title">SURAT JALAN</div>

        <!-- NO & INFO -->
        <div class="no-row">
          No. : ${escapeHtml(String(order.id))}<br/>
          Tgl : ${tglStr}
        </div>

        <div class="info-text">
          Harap diterima dengan baik barang-barang tersebut dibawah ini :
        </div>

        <!-- TABEL BARANG -->
        <table class="items-table">
          <thead>
            <tr>
              <th style="width:60px;">Nomor Urut</th>
              <th>Nama Barang</th>
              <th style="width:120px;">Jumlah barang</th>
              <th style="width:180px;">Keterangan</th>
            </tr>
          </thead>
          <tbody>
            ${itemsRows || `
              <tr>
                <td colspan="4" style="border:1px solid #000;padding:6px;text-align:center;">
                  (Tidak ada item)
                </td>
              </tr>
            `}
          </tbody>
        </table>

        <div class="total-row">
          Total nilai barang: <strong>Rp ${totalFormatted}</strong>
        </div>

        <div class="notes">
          Catatan:
          <div class="notes-box">
            ${notes || '&nbsp;'}
          </div>
        </div>

        <!-- TANDA TANGAN -->
        <div class="sign-section">
          <div class="sign-top">
            ${plateNumber ? `No. Kendaraan: ${plateNumber}<br/>` : ''}
            ${shippedDateStr ? `Tanggal Kirim: ${shippedDateStr}` : ''}
            ${senderContact ? `<br/>Kontak Pengirim: ${senderContact}` : ''}
          </div>
          <div class="sign-columns">
            <div class="sign-col">
              <div class="sign-label">Penerima</div>
              ${signatureImgHtml}
              <div class="sign-name">( ${receiverName || '&nbsp;'} )</div>
            </div>
            <div class="sign-col">
              <div class="sign-label">Pengirim</div>
              ${senderSignImgHtml}
              <div class="sign-name">( ${senderName || '&nbsp;'} )</div>
            </div>
            <div class="sign-col">
              <div class="sign-label">Mengetahui</div>
              <div style="width:200px;height:70px;margin:0 auto 6px auto;"></div>
              <div class="sign-name">( ...... )</div>
            </div>
          </div>
        </div>

        <!-- GARIS PEMBATAS -->
        <div class="separator-line"></div>

        <!-- FOTO BUKTI -->
        <div class="proof-section">
          <div class="proof-title">Foto Bukti Penerimaan Barang</div>
          <div class="proof-wrapper">
            ${proofImgHtml}
          </div>
        </div>
      </div>
    </body>
  </html>
  `;
}

module.exports = { generateDeliveryNote };
