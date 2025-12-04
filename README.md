---

# MBG Marketplace

Sistem pemesanan bahan dapur berbasis web dengan alur terstruktur antara **Dapur → Yayasan → Vendor**, lengkap dengan delivery note generator, digital signature, dan pembagian order otomatis ke vendor terkait.

---

## 📌 Ringkasan Project

Repo ini berisi source code lengkap aplikasi **MBG Marketplace**, terdiri dari:

* Backend Node.js + Express
* View engine Pug
* Database MySQL
* Autentikasi (JWT + Middleware Role)
* Sistem multi-role (Dapur, Vendor, Yayasan)
* Alur pemesanan terintegrasi
* Generator Surat Jalan (PNG) via Puppeteer
* Upload tanda tangan (Canvas → PNG)
* Dashboard terpisah per role
* Manager file (multer), styling (Bootstrap)

Project ini sudah memiliki struktur backend, routing lengkap, kontrol alur pesanan, pengiriman, notifikasi, dan tampilan Pug.

---

## 📂 Struktur Folder

Struktur ini diambil langsung dari isi zip:

```
/src
  /controllers
    authController.js
    dapurController.js
    marketplaceController.js
    vendorController.js
    yayasanController.js

  /middleware
    auth.js
    roleCheck.js

  /models
    db.js

  /lib
    deliveryNotePuppeteer.js  ← HTML → PNG generator

  /public
    /uploads
      /products
      /signatures
      /delivery
      /delivery_notes
      ... (folder hash upload)

  /routes
    auth.js
    dapur.js
    vendor.js
    yayasan.js
    product.js
    cart.js
    order.js

  /views
    layout.pug
    marketplace/
    vendor/
    yayasan/
    dapur/
    partials/
    ... semua template UI Pug
```

File penting lain:

* `package.json`
* `package-lock.json`
* `db.txt` (catatan query / database)
* ZIP tambahan: `new_mbg_market.zip` (project lama tersimpan dalam repo)

---

## 🧰 Tech Stack

### Backend

* Node.js (Express)
* MySQL (mysql2/promise)
* JWT + Session
* Multer (upload)
* Puppeteer (generate delivery note PNG)
* Sharp (compress image)
* crypto, bcrypt

### Frontend

* Pug template engine
* Bootstrap
* Canvas signature
* Vanilla JS

---

## 🔄 Alur Sistem (berdasarkan file & controller yang ada)

### 1. Dapur

* Tambah item ke cart
* Checkout → membuat order
* Tidak langsung ke vendor → masuk ke Yayasan

### 2. Yayasan

* Approve atau reject order
* Setelah approve → sistem memecah pesanan sesuai vendor produk
* Mengirim notifikasi ke vendor terkait

### 3. Vendor

* Melihat hanya item yang relevan (filter by vendor in controller)
* Update status: pending → preparing → shipped
* Upload bukti & foto pengiriman
* Generate delivery note otomatis:

  ```
  html → PNG via src/lib/deliveryNotePuppeteer.js
  ```
* Kirim ke dapur untuk tanda tangan

### 4. Dapur (Tanda Tangan)

* Membuka halaman sign
* Mengisi signature pad canvas
* Sistem menyimpan PNG ke:

  ```
  /src/public/uploads/signatures/{orderId}/
  ```

### 5. Yayasan Monitoring

* Yayasan melihat semua bukti kirim + signature

---

## 📜 Delivery Note Generator

File utamanya:

```
src/lib/deliveryNotePuppeteer.js
```

Fungsi:

* Render HTML (template khusus) menjadi PNG via Puppeteer
* Menyimpan file ke `/uploads/delivery_notes/`
* Menampilkan:

  * logo vendor
  * data order & vendor
  * list item
  * tanda tangan penerima
  * timestamp shipment

---

## 🔐 Autentikasi & Roles

Ada 3 role besar:

* **dapur**
* **vendor**
* **yayasan_admin**

Dari folder `middleware/`:

* `auth.js` → cek user login
* `roleCheck.js` → validasi role per route

Route per role:

```
/routes/auth.js
/routes/dapur.js
/routes/vendor.js
/routes/yayasan.js
```

---

## 🛠️ Instalasi

### 1. Clone repo

```
git clone https://github.com/iwakx/projects
cd projects
```

### 2. Install dependencies

```
npm install
```

### 3. Setup `.env`

Contoh `.env.example` tersedia:

```
DB_HOST=...
DB_USER=...
DB_PASS=...
DB_NAME=...
JWT_SECRET=...
SMTP_HOST=...
```

### 4. Import database

Gunakan file:

```
db.txt
```

atau migration SQL yang lu punya.

### 5. Jalankan server

```
npm run dev
```

Akses:

```
http://localhost:3000
```

---

## 🧪 Fitur Penting Berdasarkan Kode

* Order splitting per vendor
* Pengelolaan status pesanan vendor
* Surat jalan otomatis
* Upload foto pengiriman
* Upload tanda tangan digital
* Dashboard terpisah setiap role
* Validasi permission per role
* Upload produk (vendor)
* Marketplace frontend
* Cart system

---

## 🔧 Scripts (dari package.json)

```json
"scripts": {
  "start": "node app.js",
  "dev": "nodemon app.js"
}
```

---

## 🤝 Kontribusi

Pull requests, issue, dan saran sangat diterima.

---

## 📝 Lisensi

MIT License.

---
