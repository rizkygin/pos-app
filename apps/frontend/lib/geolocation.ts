// Shared browser-geolocation settings and error text.
//
// Background: on macOS a failed fix surfaces as POSITION_UNAVAILABLE with the
// message "CoreLocation framework reported a kCLErrorLocationUnknown failure".
// Apple documents that error as transient — the fix often succeeds moments
// later — so a single getCurrentPosition call gives up far too easily. When it
// gave up, the location forms were left holding empty coordinates and saved
// them anyway; see lib/coords.ts for the damage that caused.

/**
 * Where a map opens when it has nothing valid to show.
 *
 * Pangkalan Bun — the town these outlets serve. It was Banjarmasin (-3.3199,
 * 114.5907) 350 km east, which meant an owner whose browser refused to locate
 * them started their shop's location pin in a different city. Mirrors
 * DEFAULT_COORDS in the backend's lib/utils/coords.
 */
export const FALLBACK_COORDS = { lat: -2.6847, lon: 111.6236 } as const;

const isMobile = () =>
  typeof navigator !== 'undefined' &&
  /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

export const GEOLOCATION_OPTIONS: PositionOptions = {
  // A laptop has no GPS — it locates by scanning Wi-Fi access points, so high
  // accuracy buys nothing and only makes CoreLocation work (and fail) harder.
  get enableHighAccuracy() {
    return isMobile();
  },
  timeout: 15_000,
  // Was 0, which forbade reusing a good fix from seconds ago and made every
  // press a cold start — precisely when kCLErrorLocationUnknown shows up.
  maximumAge: 60_000,
};

/** Human-readable, platform-honest explanation for a geolocation failure. */
export function geolocationMessage(err: GeolocationPositionError): string {
  switch (err.code) {
    case err.PERMISSION_DENIED:
      return 'Izin lokasi ditolak. Klik ikon gembok di address bar, ubah izin Lokasi ke "Izinkan", lalu muat ulang halaman.';
    case err.POSITION_UNAVAILABLE:
      // Never say "aktifkan GPS" here: a Mac or desktop PC has no GPS chip.
      return isMobile()
        ? 'Lokasi tidak tersedia. Pastikan GPS aktif, lalu coba lagi.'
        : 'Lokasi tidak tersedia. Pastikan Wi-Fi menyala (tidak perlu tersambung) dan Layanan Lokasi diizinkan untuk browser ini di pengaturan sistem.';
    case err.TIMEOUT:
      return 'Permintaan lokasi timeout. Coba lagi.';
    default:
      return 'Gagal mendapatkan lokasi. Coba lagi.';
  }
}

/**
 * getCurrentPosition with one automatic retry on POSITION_UNAVAILABLE.
 *
 * The retry is what makes the transient CoreLocation failure invisible to the
 * user. Permission denials and timeouts are NOT retried — the first answer is
 * already final, and retrying a denial just delays the error message.
 */
export function getCurrentPosition(
  onSuccess: PositionCallback,
  onError: PositionErrorCallback,
  options: PositionOptions = GEOLOCATION_OPTIONS,
): void {
  navigator.geolocation.getCurrentPosition(onSuccess, (err) => {
    if (err.code !== err.POSITION_UNAVAILABLE) {
      onError(err);
      return;
    }
    // Second attempt: allow a slightly staler cached fix, since any real
    // position beats failing outright on a form the user is trying to submit.
    navigator.geolocation.getCurrentPosition(onSuccess, onError, {
      ...options,
      maximumAge: 300_000,
    });
  }, options);
}
