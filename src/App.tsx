import { useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet.vectorgrid';

// Tipe data berikut dipakai supaya komponen React tetap jelas:
// - FeatureProperties: properti mentah dari tile PBF
// - HoverInfo: isi panel hover saat feature disentuh
// - RouteSummary: ringkasan hasil routing OSRM
// - RouteInputs: form koordinat asal/tujuan
// - RouteStatus: status proses routing
type FeatureProperties = Record<string, unknown>;

type HoverInfo = {
  layerName: string;
  title: string;
  properties: FeatureProperties;
};

type RouteSummary = {
  distance: number;
  duration: number;
  coordinates: [number, number][];
};

type RouteInputs = {
  startLng: string;
  startLat: string;
  endLng: string;
  endLat: string;
};

type RouteStatus = {
  kind: 'idle' | 'loading' | 'success' | 'error';
  message: string;
};

// Endpoint tile vector PBF yang dibaca oleh Leaflet.VectorGrid.
const TILE_URL = 'https://peta.smartsystem.id/data/pmtiles/{z}/{x}/{y}.pbf';
// Definisi rute mengikuti PANDUAN_DEVELOPER_CLIENT.md:
// - endpoint OSRM menerima urutan longitude, latitude
// - overview=full dan geometries=geojson dipakai agar hasil rute bisa langsung digambar di Leaflet
const ROUTE_URL = 'https://rute.smartsystem.id/route/v1/driving/{longitude_asal},{latitude_asal};{longitude_tujuan},{latitude_tujuan}?overview=full&geometries=geojson';

// Contoh request final yang dibangun dari input default di bawah:
const ROUTE_EXAMPLE_URL = 'https://rute.smartsystem.id/route/v1/driving/107.62678798649758,-6.929305772885831;107.69649673774937,-6.953538906008247?overview=full&geometries=geojson';

// Data rute bawaan aplikasi.
// Form sidebar memakai data ini, lalu loadRoute() mengirimkannya ke OSRM.
// Data rute bawaan aplikasi.
// Form sidebar memakai data ini, lalu loadRoute() mengirimkannya ke OSRM.
// Titik awal: PT LSKK
// Titik akhir: ITB Innovation Park
const initialInputs: RouteInputs = {
  startLng: '107.62678798649758',
  startLat: '-6.929305772885831',
  endLng: '107.69649673774937',
  endLat: '-6.953538906008247',
};

// State awal panel hover sebelum user mengarah ke feature.
const initialHover: HoverInfo = {
  layerName: 'Belum ada feature',
  title: 'Arahkan kursor ke feature pada peta',
  properties: {},
};

// Status awal routing sebelum request OSRM dijalankan.
const initialRouteStatus: RouteStatus = {
  kind: 'idle',
  message: 'Isi koordinat lalu klik Muat rute.',
};

// Alur gambar rute di aplikasi ini:
// 1. User mengisi koordinat asal dan tujuan pada form sidebar.
// 2. loadRoute() membangun URL OSRM dari ROUTE_URL.
// 3. Response OSRM dibaca dari data.routes[0].geometry.coordinates.
// 4. Koordinat [lng, lat] diubah menjadi [lat, lng] agar cocok dengan Leaflet.
// 5. Garis rute digambar ulang ke routeLayer sebagai polyline merah tebal.

function escapeHtml(value: unknown): string {
  // Helper sederhana untuk mencegah HTML mentah tampil di popup.
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function getTitle(properties: FeatureProperties): string {
  // Ambil field paling informatif yang tersedia dari properti feature.
  const titleKeys = ['name', 'kind', 'type', 'class', 'layer', 'category', 'admin_level'];
  for (const key of titleKeys) {
    const value = properties[key];
    if (value !== undefined && value !== null && value !== '') {
      return `${key}: ${value}`;
    }
  }
  return 'Feature';
}

function parseRouteCoordinate(value: string): number {
  // Form input bertipe string, jadi perlu dikonversi menjadi angka.
  const parsed = Number(value.trim());
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

function formatDistance(distance: number): string {
  // Format jarak dari meter ke meter/km agar lebih mudah dibaca di UI.
  if (distance >= 1000) {
    return `${(distance / 1000).toFixed(2)} km`;
  }
  return `${Math.round(distance)} m`;
}

function formatDuration(duration: number): string {
  // Format durasi dari detik ke jam/menit.
  const totalMinutes = Math.round(duration / 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) {
    return `${minutes} menit`;
  }
  return `${hours} jam ${minutes} menit`;
}

function buildRouteUrl(routeInputs: RouteInputs): string {
  // Susun URL final OSRM dengan urutan longitude, latitude.
  return ROUTE_URL
    .replace('{longitude_asal}', routeInputs.startLng.trim())
    .replace('{latitude_asal}', routeInputs.startLat.trim())
    .replace('{longitude_tujuan}', routeInputs.endLng.trim())
    .replace('{latitude_tujuan}', routeInputs.endLat.trim());
}

function drawRoute(routeLayer: L.LayerGroup, latLngs: [number, number][]) {
  // routeLayer adalah group khusus untuk semua elemen rute.
  // Setiap kali rute baru digambar, semua layer lama dihapus dulu.
  routeLayer.clearLayers();

  // Marker asal dan tujuan tetap dipakai untuk menunjukkan titik endpoint rute.
  L.circleMarker(latLngs[0], {
    radius: 7,
    color: '#0f6f45',
    weight: 3,
    fillColor: '#d1fae5',
    fillOpacity: 1,
  }).addTo(routeLayer);

  L.circleMarker(latLngs[latLngs.length - 1], {
    radius: 7,
    color: '#b91c1c',
    weight: 3,
    fillColor: '#fee2e2',
    fillOpacity: 1,
  }).addTo(routeLayer);

  // Lapisan bawah yang lebih tebal berfungsi sebagai halo agar garis rute lebih mudah dibaca.
  L.polyline(latLngs, {
    color: '#ffffff',
    weight: 10,
    opacity: 0.92,
    lineCap: 'round',
    lineJoin: 'round',
  }).addTo(routeLayer);

  // Garis utama: merah tebal, gaya seperti peta navigasi.
  L.polyline(latLngs, {
    color: '#d71920',
    weight: 7,
    opacity: 1,
    lineCap: 'round',
    lineJoin: 'round',
  }).addTo(routeLayer);
}

function App() {
  // Komponen utama aplikasi: menyatukan state React, Leaflet map, dan alur routing.
  // Ref untuk akses langsung ke instance Leaflet dan elemen peta.
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const vectorLayerRef = useRef<L.VectorGrid | null>(null);
  const routeLayerRef = useRef<L.LayerGroup | null>(null);
  const hoverTooltipRef = useRef<L.Tooltip | null>(null);
  // React state dipakai untuk data yang memengaruhi UI sidebar.
  const [hoverInfo, setHoverInfo] = useState<HoverInfo>(initialHover);
  const [mapStatus, setMapStatus] = useState('Memuat tile vector...');
  const [layerNames, setLayerNames] = useState<string[]>([]);
  const [routeInputs, setRouteInputs] = useState<RouteInputs>(initialInputs);
  const [routeStatus, setRouteStatus] = useState<RouteStatus>(initialRouteStatus);
  const [routeSummary, setRouteSummary] = useState<RouteSummary | null>(null);
  const [opacity, setOpacity] = useState(90);

  // Ubah objek properti menjadi array agar mudah dirender sebagai tabel.
  const propertyEntries = useMemo(() => Object.entries(hoverInfo.properties), [hoverInfo.properties]);

  const loadRoute = async (routeInputsValue: RouteInputs = routeInputs) => {
    // STEP 1: baca input asal dan tujuan.
    // startLng/startLat = titik asal
    // endLng/endLat     = titik tujuan
    const startLng = parseRouteCoordinate(routeInputsValue.startLng);
    const startLat = parseRouteCoordinate(routeInputsValue.startLat);
    const endLng = parseRouteCoordinate(routeInputsValue.endLng);
    const endLat = parseRouteCoordinate(routeInputsValue.endLat);

    // STEP 2: validasi input angka.
    if ([startLng, startLat, endLng, endLat].some((value) => Number.isNaN(value))) {
      setRouteStatus({ kind: 'error', message: 'Koordinat rute tidak valid. Pastikan format angka benar.' });
      return;
    }

    // STEP 3: beri feedback ke UI bahwa request routing sedang berjalan.
    setRouteStatus({ kind: 'loading', message: 'Menghitung rute via OSRM...' });
    setRouteSummary(null);

    try {
      // STEP 4: bangun URL final ke OSRM.
      const url = buildRouteUrl(routeInputsValue);

      // STEP 5: fetch data route dari server OSRM.
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      // STEP 6: baca JSON response.
      const data = await response.json();
      // Struktur data yang dipakai dari OSRM:
      // data.routes[0].geometry.coordinates -> array [lng, lat]
      // data.routes[0].distance            -> meter
      // data.routes[0].duration            -> detik
      const route = data.routes?.[0];
      const coordinates = route?.geometry?.coordinates as [number, number][] | undefined;

      if (!route || !coordinates?.length) {
        throw new Error('Rute tidak ditemukan.');
      }

      // STEP 7: ubah format koordinat dari GeoJSON ke format Leaflet.
      const latLngs = coordinates.map(([lng, lat]) => [lat, lng] as [number, number]);
      const routeLayer = routeLayerRef.current;
      if (routeLayer) {
        // STEP 8: gambar ulang semua elemen rute ke layer khusus.
        drawRoute(routeLayer, latLngs);
      }

      // STEP 9: simpan ringkasan hasil routing ke state.
      setRouteSummary({
        distance: route.distance,
        duration: route.duration,
        coordinates: coordinates,
      });
      setRouteStatus({
        kind: 'success',
        message: `Rute berhasil dimuat. Jarak ${formatDistance(route.distance)} dan estimasi ${formatDuration(route.duration)}.`,
      });

      // STEP 10: fokuskan peta ke batas rute supaya langsung terlihat.
      const bounds = L.latLngBounds(latLngs);
      mapRef.current?.fitBounds(bounds, { padding: [30, 30] });
    } catch (error) {
      setRouteStatus({
        kind: 'error',
        message: error instanceof Error ? error.message : 'Gagal memuat rute.',
      });
    }
  };

  useEffect(() => {
    // useEffect hanya jalan sekali saat komponen dipasang.
    if (!mapContainerRef.current || mapRef.current) {
      return;
    }

    // STEP A: buat instance Leaflet map.
    const map = L.map(mapContainerRef.current, {
      zoomControl: true,
      preferCanvas: false,
      zoomSnap: 0.01,
      zoomDelta: 0.25,
    }).setView([-6.9175, 107.6191], 12);

    // STEP B: pasang basemap OpenStreetMap sebagai basemap gambar png.
    const baseLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      subdomains: 'abc',
      maxZoom: 20,
      attribution: '&copy; OpenStreetMap contributors',
    }).addTo(map);

    // STEP C: definisikan style untuk setiap layer data vector.
    const styleByLayer = {
      earth: {
        fill: true,
        fillColor: '#dff5f0',
        fillOpacity: 1,
        stroke: false,
      },
      landcover: {
        fill: true,
        fillColor: '#c8ecc5',
        fillOpacity: 1,
        stroke: false,
      },
      landuse: {
        fill: true,
        fillColor: '#b9dfab',
        fillOpacity: 1,
        stroke: false,
      },
      water: {
        fill: true,
        fillColor: '#a8e8ef',
        fillOpacity: 1,
        stroke: false,
        color: '#8ccfe0',
        weight: 1,
      },
      boundaries: () => ({
        color: '#b16be0',
        weight: 1.1,
        fillOpacity: 0,
        opacity: 0.8,
      }),
      roads: (properties: FeatureProperties, zoom: number) => {
        const roadClass = String(properties.class ?? properties.kind ?? '');
        const isMajor = /motorway|trunk|primary/.test(roadClass);
        return {
          color: isMajor ? '#ff8f1f' : '#f8b94c',
          weight: isMajor ? Math.max(1.3, zoom * 0.08) : 0.8,
          opacity: isMajor ? 0.82 : 0.55,
        };
      },
      buildings: {
        fill: true,
        fillColor: '#f4d580',
        fillOpacity: 0.5,
        color: '#e7be5a',
        weight: 0.4,
      },
      places: () => ({
        color: '#d43ce0',
        radius: 2,
        fillColor: '#d43ce0',
        fillOpacity: 1,
        weight: 0,
      }),
      pois: () => ({
        color: '#f04e9b',
        radius: 2.5,
        fillColor: '#f04e9b',
        fillOpacity: 1,
        weight: 0,
      }),
    };

    // STEP D: buat layer vector dari tile PBF.
    const vectorLayer = L.vectorGrid.protobuf(TILE_URL, {
      rendererFactory: L.svg.tile,
      interactive: true,
      maxNativeZoom: 14,
      vectorTileLayerStyles: styleByLayer,
    }) as unknown as L.VectorGrid;

    // STEP E: sediakan group khusus untuk elemen route.
    const routeLayer = L.layerGroup().addTo(map);
    // STEP F: tooltip hover yang dipakai ulang, bukan dibuat baru setiap event.
    const hoverTooltip = L.tooltip({
      permanent: false,
      sticky: true,
      direction: 'top',
      opacity: 0.96,
      className: 'feature-tooltip',
    });

    // STEP G: saat hover, baca properti feature lalu tampilkan ke sidebar dan tooltip.
    const updateHoverState = (event: any) => {
      const properties = (event.layer?.properties || event.layer?.feature?.properties || event.properties || {}) as FeatureProperties;
      const layerName = event.layer?.name || event.layer?.layerName || event.sourceLayer || 'vector tile feature';
      const title = getTitle(properties);

      setHoverInfo({ layerName, title, properties });
      hoverTooltip
        .setLatLng(event.latlng)
        .setContent(`<strong>${escapeHtml(title)}</strong><br />${escapeHtml(layerName)}`);

      if (!map.hasLayer(hoverTooltip)) {
        hoverTooltip.addTo(map);
      }
    };

    vectorLayer.on('loading', () => {
      // Event loading dipakai untuk memberi status di sidebar.
      setMapStatus('Memuat tile vector...');
    });

    vectorLayer.on('load', () => {
      // Setelah tile termuat, ambil daftar layer yang terdeteksi.
      const names = vectorLayer.getDataLayerNames();
      setLayerNames(names);
      setMapStatus(names.length ? `Tile berhasil dimuat. Layer: ${names.join(', ')}` : 'Tile berhasil dimuat.');
    });

    vectorLayer.on('mouseover', (event: any) => {
      if (!event.latlng) {
        return;
      }
      updateHoverState(event);
    });

    vectorLayer.on('mousemove', (event: any) => {
      if (!event.latlng) {
        return;
      }
      updateHoverState(event);
    });

    vectorLayer.on('mouseout', () => {
      if (map.hasLayer(hoverTooltip)) {
        map.removeLayer(hoverTooltip);
      }
      setHoverInfo(initialHover);
      if (layerNames.length) {
        setMapStatus(`Tile berhasil dimuat. Layer: ${layerNames.join(', ')}`);
      }
    });

    vectorLayer.on('click', (event: any) => {
      // Klik feature menampilkan popup tabel properti.
      const properties = (event.layer?.properties || event.layer?.feature?.properties || event.properties || {}) as FeatureProperties;
      const content = `
        <div class="popup-card">
          <strong>${escapeHtml(getTitle(properties))}</strong>
          <div style="margin-bottom: 10px; color: #4b5563;">${escapeHtml(event.layer?.name || event.sourceLayer || 'vector feature')}</div>
          <table class="popup-table">
            <tbody>
              ${Object.entries(properties)
                .map(([key, value]) => `<tr><th>${escapeHtml(key)}</th><td>${escapeHtml(value)}</td></tr>`)
                .join('')}
            </tbody>
          </table>
        </div>
      `;

      L.popup({ className: 'feature-popup', maxWidth: 420 })
        .setLatLng(event.latlng)
        .setContent(content)
        .openOn(map);
    });

    vectorLayer.addTo(map);
    // Simpan referensi instance agar state React dapat mengontrol layer Leaflet.
    routeLayerRef.current = routeLayer;
    hoverTooltipRef.current = hoverTooltip;
    vectorLayerRef.current = vectorLayer;
    mapRef.current = map;

    // STEP H: set opacity awal sesuai slider.
    const syncOpacity = (value: number) => {
      vectorLayer.setOpacity(value / 100);
    };

    syncOpacity(opacity);

    map.invalidateSize();

    // Muat contoh rute otomatis dari URL GeoJSON yang diberikan user.
    void loadRoute(initialInputs);

    return () => {
      map.remove();
      mapRef.current = null;
      vectorLayerRef.current = null;
      routeLayerRef.current = null;
      hoverTooltipRef.current = null;
    };
  }, []);

  useEffect(() => {
    // Ketika slider berubah, update opacity layer vector secara langsung.
    vectorLayerRef.current?.setOpacity(opacity / 100);
  }, [opacity]);

  const handleRouteInputChange = (field: keyof RouteInputs) => (event: React.ChangeEvent<HTMLInputElement>) => {
    // Handler generik agar semua input form route bisa memakai satu fungsi.
    setRouteInputs((current) => ({ ...current, [field]: event.target.value }));
  };

  const resetRoute = () => {
    // Hapus rute dan kembalikan status ke kondisi awal.
    routeLayerRef.current?.clearLayers();
    setRouteSummary(null);
    setRouteStatus(initialRouteStatus);
  };

  return (
    <main className="app-shell">
      {/* Sidebar kiri: semua kontrol, info hover, dan dokumentasi rute. */}
      <aside className="sidebar">
        <div>
          <p className="eyebrow">Leaflet PMTiles Viewer</p>
          <h1>Peta berbasis ReactJS</h1>
          <p className="intro">
            Menggunakan basemap OpenStreetMap, vector tile dari
            <span className="mono">https://peta.smartsystem.id/data/pmtiles/{'{z}'}/{'{x}'}/{'{y}'}.pbf</span>
            , hover untuk lihat info feature, dan routing OSRM sesuai panduan developer.
          </p>
        </div>

        <div className="panel">
          {/* Slider opacity mengubah nilai state `opacity`, lalu disinkronkan ke layer vector. */}
          <label htmlFor="opacityRange">Opacity layer</label>
          <input
            id="opacityRange"
            type="range"
            min="0"
            max="100"
            value={opacity}
            onChange={(event) => setOpacity(Number(event.target.value))}
          />
          <div className="panel-row">
            <span>0%</span>
            <span>{opacity}%</span>
            <span>100%</span>
          </div>
        </div>

        <div className="panel">
          {/* Panel ini menampilkan status map dan tabel properti feature saat hover. */}
          <h2>Info hover</h2>
          <p>{mapStatus}</p>
          <div className={`feature-info ${propertyEntries.length ? '' : 'empty'}`}>
            <span className="title">{hoverInfo.title}</span>
            <div style={{ marginBottom: 10, color: '#5f6f68' }}>Layer: {hoverInfo.layerName}</div>
            {propertyEntries.length ? (
              <table>
                <tbody>
                  {propertyEntries.map(([key, value]) => (
                    <tr key={key}>
                      <th>{key}</th>
                      <td>{String(value ?? '')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <div>Belum ada feature yang dipilih.</div>
            )}
          </div>
        </div>

        <div className="panel">
          {/* Layer vector yang terdeteksi dari tile PBF ditampilkan sebagai list. */}
          <h2>Layer terdeteksi</h2>
          <ul className="layer-list">
            {layerNames.length ? (
              layerNames.map((name) => <li key={name}>{name}</li>)
            ) : (
              <li>Memuat...</li>
            )}
          </ul>
        </div>

        <div className="panel">
          {/* Form routing OSRM: input disimpan sebagai string lalu di-parse saat `loadRoute()`. */}
          <h2>Routing OSRM</h2>
          {/* Penjelasan singkat syntax input rute. */}
          <p className="intro" style={{ marginTop: 0 }}>
            Isi koordinat dalam urutan <strong>longitude, latitude</strong> lalu klik Muat rute.
          </p>
          <p className="intro" style={{ marginTop: 0 }}>
            Saat app dibuka, contoh rute dari URL GeoJSON yang diberikan akan langsung digambar ke peta.
            Kalau garis belum terlihat, klik <strong>Muat rute</strong> untuk mem-fetch ulang dan merender polyline.
          </p>
          <div className="route-note">
            <strong>Langkah gambar rute</strong>
            <ol>
              <li>Masukkan koordinat asal dan tujuan.</li>
              <li>Fungsi <code>loadRoute()</code> menyusun URL OSRM dari <code>ROUTE_URL</code>.</li>
              <li>Response OSRM diambil dari <code>data.routes[0]</code>.</li>
              <li>Koordinat GeoJSON <code>[lng, lat]</code> diubah ke format Leaflet <code>[lat, lng]</code>.</li>
              <li>Polyline merah tebal digambar ulang di <code>routeLayer</code>.</li>
            </ol>
          </div>
          <div className="route-note">
            {/* Lokasi definisi penting di file ini. */}
            <strong>Di mana definisi rutenya?</strong>
            <p>
              Definisi endpoint ada di konstanta <code>ROUTE_URL</code> di bagian atas file ini.
              Input sumber datanya ada di <code>routeInputs</code>, lalu fungsi <code>loadRoute()</code>
              membangun request ke OSRM dan menggambar hasil GeoJSON sebagai polyline di peta.
            </p>
            <p>
              Contoh request yang dipakai aplikasi ini adalah:
            </p>
            <code>{ROUTE_EXAMPLE_URL}</code>
          </div>
          <div className={`route-status ${routeStatus.kind}`}>
            {routeStatus.message}
          </div>
          {routeSummary ? (
            <div className="route-summary">
              <div><strong>Jarak:</strong> {formatDistance(routeSummary.distance)}</div>
              <div><strong>Durasi:</strong> {formatDuration(routeSummary.duration)}</div>
              <div><strong>Titik:</strong> {routeSummary.coordinates.length}</div>
            </div>
          ) : null}
        </div>
      </aside>

      {/* Area kanan: container peta Leaflet. */}
      <section className="map-wrap">
        <div ref={mapContainerRef} id="map" />
      </section>
    </main>
  );
}

export default App;
