# Base Map Load

Aplikasi ini adalah demo **ReactJS + Leaflet** untuk:

- menampilkan basemap OpenStreetMap,
- memuat vector tile PBF dari `https://peta.smartsystem.id/data/pmtiles/{z}/{x}/{y}.pbf`,
- mengekstrak dan menampilkan informasi feature saat hover/click,
- mengatur opacity layer vector,
- memuat route dari OSRM,
- menggambar route sebagai polyline di peta.

Referensi kode utama ada di [src/App.tsx](src/App.tsx).

## Teknologi yang dipakai

- ReactJS
- Vite
- Leaflet
- `leaflet.vectorgrid`
- Fetch API untuk request routing ke OSRM

## Menjalankan aplikasi

```powershell
npm install
npm run dev
```

Buka URL lokal yang ditampilkan Vite, biasanya `http://127.0.0.1:5173`.

## Sumber data

### 1. Basemap

Basemap menggunakan OpenStreetMap tile layer:

```text
https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png
```

### 2. Tile vector PBF

Tile vector dimuat dari endpoint:

```text
https://peta.smartsystem.id/data/pmtiles/{z}/{x}/{y}.pbf
```

Endpoint ini dibaca oleh `Leaflet.VectorGrid` agar feature vector bisa:

- di-hover,
- diklik,
- ditampilkan properti datanya,
- di-style berdasarkan nama layer.

### 3. Routing OSRM

Routing menggunakan endpoint:

```text
https://rute.smartsystem.id/route/v1/driving/{longitude_asal},{latitude_asal};{longitude_tujuan},{latitude_tujuan}?overview=full&geometries=geojson
```

Urutan koordinat untuk OSRM wajib:

- `longitude, latitude`

## Step by Step Implementasi

### A. Load basemap

1. Buat map container dengan Leaflet.
2. Set `center` dan `zoom` awal map.
3. Tambahkan basemap OpenStreetMap sebagai layer dasar.
4. Pastikan basemap ditambahkan ke map sebelum layer lain.

Contoh sintaks inti:

```ts
const map = L.map(mapContainerRef.current).setView([-6.9175, 107.6191], 12);

L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  subdomains: 'abc',
  maxZoom: 20,
  attribution: '&copy; OpenStreetMap contributors',
}).addTo(map);
```

### B. Load tile PBF

1. Siapkan `Leaflet.VectorGrid`.
2. Arahkan ke URL tile PBF.
3. Aktifkan `interactive: true` jika ingin hover/click.
4. Tentukan style per layer data agar map terlihat jelas.
5. Tambahkan layer vector ke map.

Contoh sintaks inti:

```ts
const vectorLayer = L.vectorGrid.protobuf(
  'https://peta.smartsystem.id/data/pmtiles/{z}/{x}/{y}.pbf',
  {
    rendererFactory: L.svg.tile,
    interactive: true,
    maxNativeZoom: 14,
    vectorTileLayerStyles: {
      roads: { color: '#ff8f1f', weight: 2 },
    },
  }
);

vectorLayer.addTo(map);
```

### C. Extract informasi feature dari PBF

1. Dengarkan event `mouseover`, `mousemove`, atau `click` pada vector layer.
2. Ambil properti feature dari event.
3. Ekstrak field yang tersedia seperti `name`, `kind`, `class`, `sort_rank`, dan lain-lain.
4. Render hasilnya ke panel sidebar atau popup.

Contoh logika inti:

```ts
vectorLayer.on('mouseover', (event: any) => {
  const properties = event.layer?.properties || event.properties || {};
  const title = properties.name || properties.kind || 'Feature';
  console.log(title, properties);
});
```

### D. Atur opacity layer vector

1. Simpan nilai opacity di state React.
2. Gunakan slider untuk mengubah nilai opacity.
3. Saat nilai berubah, panggil `setOpacity()` pada vector layer.

Contoh sintaks inti:

```ts
vectorLayer.setOpacity(0.6);
```

Jika slider bernilai `60`, opacity yang dikirim ke layer adalah `0.6`.

### E. Load data route dari OSRM

1. Siapkan input koordinat asal dan tujuan.
2. Pastikan formatnya `longitude, latitude`.
3. Bentuk URL request ke OSRM.
4. Fetch response JSON.
5. Ambil `data.routes[0]`.
6. Baca `geometry.coordinates`, `distance`, dan `duration`.

Contoh data yang dipakai aplikasi ini:

- Asal: `107.62678798649758, -6.929305772885831`
- Tujuan: `107.69649673774937, -6.953538906008247`

Contoh request final:

```text
https://rute.smartsystem.id/route/v1/driving/107.62678798649758,-6.929305772885831;107.69649673774937,-6.953538906008247?overview=full&geometries=geojson
```

### F. Gambar route di peta

1. Ambil koordinat route dari OSRM.
2. Ubah format dari `[lng, lat]` menjadi `[lat, lng]` untuk Leaflet.
3. Bersihkan layer route lama.
4. Gambar marker titik awal dan tujuan.
5. Gambar polyline utama sebagai garis tebal merah.
6. Tambahkan halo putih di bawah garis agar lebih terlihat.
7. Fit bounds ke route supaya rute langsung tampak di viewport.

Contoh sintaks inti:

```ts
const latLngs = coordinates.map(([lng, lat]) => [lat, lng] as [number, number]);

routeLayer.clearLayers();
L.polyline(latLngs, {
  color: '#ffffff',
  weight: 10,
  opacity: 0.92,
  lineCap: 'round',
  lineJoin: 'round',
}).addTo(routeLayer);

L.polyline(latLngs, {
  color: '#d71920',
  weight: 7,
  opacity: 1,
  lineCap: 'round',
  lineJoin: 'round',
}).addTo(routeLayer);
```

## Alur kerja aplikasi

Urutan kerja di aplikasi ini adalah:

1. Map dibuat dan basemap dimuat.
2. Tile vector PBF dimuat dari endpoint Smart System.
3. Layer vector dihover atau diklik untuk mengambil info feature.
4. Opacity layer diubah melalui slider.
5. Route dicari ke OSRM.
6. Route digambar di peta sebagai garis merah tebal.
7. Peta menyesuaikan zoom ke bounds rute.

## Syntax penting di `App.tsx`

- `L.map(...)` untuk membuat map Leaflet.
- `L.tileLayer(...)` untuk basemap raster.
- `L.vectorGrid.protobuf(...)` untuk membaca tile PBF.
- `vectorLayer.on('mouseover', ...)` untuk hover info.
- `vectorLayer.on('click', ...)` untuk popup info feature.
- `vectorLayer.setOpacity(...)` untuk opacity layer.
- `fetch(url)` untuk request routing ke OSRM.
- `L.polyline(...)` untuk menggambar route.
- `map.fitBounds(...)` untuk memfokuskan tampilan ke route.

## Catatan koordinat

- Leaflet marker dan `setView()` memakai format `[latitude, longitude]`.
- OSRM memakai format `longitude, latitude`.
- GeoJSON route dari OSRM biasanya berisi `coordinates` dalam format `[lng, lat]`.
- Karena itu koordinat harus dibalik sebelum digambar dengan Leaflet.

## Troubleshooting

### Garis route tidak muncul

- Pastikan response OSRM punya `routes[0].geometry.coordinates`.
- Pastikan koordinat input tidak tertukar lat/lng.
- Coba naikkan `weight` polyline.
- Tambahkan halo putih agar garis lebih jelas.

### Feature PBF tidak bisa dihover

- Pastikan `interactive: true` aktif.
- Pastikan style layer sesuai nama layer data yang benar.
- Pastikan event hover dibaca dari `event.layer.properties` atau `event.properties`.

### Layer vector terlalu transparan

- Naikkan nilai opacity slider.
- Pastikan `setOpacity(value / 100)` dipanggil ke vector layer.
