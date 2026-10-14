# Guess Battle

Game tebak angka multiplayer dua pemain. Masing-masing pemain memilih angka rahasia 1–100 untuk ditebak lawannya. Kesempatan menebak tidak terbatas; server menentukan pemenang saat tebakan benar pertama diterima.

## Kebutuhan
- Python 3.10 atau lebih baru
- Koneksi internet untuk mengunduh paket Python dan font Google (font tetap opsional)

## Jalankan di Windows

Buka CMD di folder proyek:

```cmd
py -m venv .venv
.venv\Scripts\activate
py -m pip install -r requirements.txt
py -m uvicorn main:app --reload
```

Buka `http://127.0.0.1:8000` di browser.

Jika perintah `py` tidak tersedia, coba gunakan `python` untuk perintah yang sama.

## Uji dua pemain di satu komputer
- Buka `http://127.0.0.1:8000` di browser biasa dan buat room.
- Buka alamat yang sama di jendela incognito/browser lain, lalu gabung memakai kode room.

Jangan buka dua pemain pada tab yang berbagi sesi browser/localStorage jika ingin menguji sebagai dua pemain yang berbeda. Gunakan browser atau profil berbeda.

## Deploy agar teman dari jaringan lain bisa bermain
Cara termudah adalah menggunakan layanan hosting Python yang mendukung WebSocket, misalnya Render atau layanan sejenis.

1. Buat repositori GitHub berisi semua file proyek ini.
2. Buat Web Service baru pada penyedia hosting Python.
3. Hubungkan repositori.
4. Build/install command: `pip install -r requirements.txt`
5. Start command: `uvicorn main:app --host 0.0.0.0 --port $PORT`
6. Pastikan paket hosting mendukung WebSocket dan koneksi HTTPS.
7. Buka URL HTTPS yang diberikan hosting dan kirim URL tersebut ke teman.
8. Satu pemain membuat room, lalu pemain kedua memasukkan kode room.

Jangan gunakan server development `--reload` pada production.

## Catatan penting
- Room disimpan di memori proses. Semua room dan permainan akan hilang saat server restart/deploy ulang.
- Untuk versi ini, jalankan satu instance server saja. Beberapa instance memerlukan shared storage/pub-sub seperti Redis.
- Angka rahasia hanya disimpan di backend dan tidak dikirim ke browser lawan.
- Kode room bukan sistem akun atau sistem keamanan tingkat tinggi. Jangan gunakan untuk informasi sensitif.
- Pemain dapat menebak angka dengan brute force karena kesempatan tidak terbatas; hal ini sesuai aturan game. Untuk game publik, pertimbangkan rate limiting dan perlindungan spam.
- Pada MVP ini, pemenang adalah tebakan benar pertama yang diproses server. Jika dua tebakan benar datang hampir bersamaan, urutan pemrosesan server menentukan pemenang.
- Tombol "Kembali ke lobby" menutup tampilan sesi di browser. Untuk ronde berikutnya, buat room baru. Sesi lawan yang masih tersambung dapat melihat status disconnect.
