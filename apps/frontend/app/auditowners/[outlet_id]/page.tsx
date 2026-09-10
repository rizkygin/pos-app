import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { serverFetch } from '@/lib/server-fetch';
import { LocalDateTime, LocalTime } from '@/components/local-datetime';
import { formatCurrency } from '@/lib/utils/format';
import { posPaymentLabel } from '@/lib/pos-payment';
import Forbidden from '@/lib/forbidden';
import { RangeForm } from './range-form';

/**
 * "Laporan Transaksi Ganda" — the duplicate-order audit, in the app.
 *
 * This used to be produced by hand against the production database and mailed
 * out as a PDF, which meant it was only ever as fresh as the last time someone
 * ran it. Here the owner picks their own window and reads it live.
 *
 * Deliberately OUTSIDE /dashboard: it names the notes to cancel and reconciles
 * a drawer against a named cashier, so it is a link an owner opens directly and
 * not a page any employee can find in the sidebar. Access is enforced by the
 * backend (owner of THIS outlet, employees never), not by hiding the nav item.
 */

export const metadata: Metadata = {
  title: 'Audit Transaksi Ganda',
  // Nothing here should ever reach a search result.
  robots: { index: false, follow: false },
};

type Pair = {
  firstId: string;
  firstAt: string;
  firstPayment: string | null;
  secondId: string;
  secondAt: string;
  secondPayment: string | null;
  gapSeconds: number;
  amount: number;
  affectsDrawer: boolean;
  items: { name: string; qty: number; note: string | null }[];
  firstCustomer: string | null;
  secondCustomer: string | null;
  cashierName: string | null;
  shiftId: number | null;
  confidence: 'likely' | 'review';
};

type Audit = {
  outlet: { id: number; name: string };
  /** A platform admin is reading a merchant's books, not their own. */
  viewedAsAdmin: boolean;
  range: { from: string; to: string };
  windowSeconds: number;
  truncated: boolean;
  summary: {
    totalOrdersScanned: number;
    pairs: number;
    excessValue: number;
    cashValue: number;
    nonCashValue: number;
    likely: { pairs: number; value: number; cashValue: number };
    review: { pairs: number; value: number };
  };
  byDay: { day: string; pairs: number; value: number; cashValue: number }[];
  shifts: {
    id: number;
    cashierName: string;
    openedAt: string | null;
    closedAt: string | null;
    pairs: number;
    phantomCash: number;
    expectedCash: number | null;
    countedCash: number | null;
    variance: number | null;
    adjustedExpectedCash: number | null;
  }[];
  pairs: Pair[];
};

export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ outlet_id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { outlet_id } = await params;
  const sp = await searchParams;
  const from = typeof sp.from === 'string' ? sp.from : '';
  const to = typeof sp.to === 'string' ? sp.to : '';

  const query = new URLSearchParams();
  if (from) query.set('from', from);
  if (to) query.set('to', to);
  const qs = query.toString();

  const res = await serverFetch(
    `/api/audit/duplicate-orders/${encodeURIComponent(outlet_id)}${qs ? `?${qs}` : ''}`,
  );

  // Not signed in at all: send them to log in and come back here, rather than
  // showing a 403 to someone who may well be the owner.
  if (res.status === 401) {
    redirect(`/login?redirect=${encodeURIComponent(`/auditowners/${outlet_id}`)}`);
  }
  // Signed in, but not the owner of THIS outlet — including employees of it.
  if (res.status === 403) return <Forbidden />;

  if (!res.ok) {
    const body = await res.json().catch(() => null);
    return (
      <Shell>
        <p className="rounded-md border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
          {body?.error ?? 'Gagal memuat audit. Coba lagi sebentar lagi.'}
        </p>
        <RangeForm outletId={outlet_id} from={from} to={to} />
      </Shell>
    );
  }

  const audit: Audit = await res.json();
  const { summary, byDay, shifts, pairs } = audit;

  return (
    <Shell>
      {audit.viewedAsAdmin && (
        <p className="rounded-md border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-800 dark:text-amber-300">
          Anda membuka halaman ini sebagai <strong className="font-semibold">admin platform</strong>
          , bukan pemilik outlet. Data di bawah adalah pembukuan milik{' '}
          <strong className="font-semibold">{audit.outlet.name}</strong> (outlet #{audit.outlet.id}).
        </p>
      )}
      <header className="flex flex-col gap-3 border-b-2 border-foreground pb-6">
        <p className="text-[0.7rem] font-semibold uppercase tracking-[0.14em] text-primary">
          Laporan Audit Kasir
        </p>
        <h1 className="text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
          Transaksi ganda di kasir {audit.outlet.name}
        </h1>
        <p className="max-w-[56ch] text-muted-foreground">
          {summary.pairs === 0 ? (
            <>Tidak ditemukan nota ganda pada rentang ini. Laci kas tidak terpengaruh.</>
          ) : (
            <>
              Sebagian penjualan tercatat dua kali. Nota kedua tidak pernah dibayar pelanggan,
              tetapi tetap masuk sebagai uang tunai — itulah sebabnya laci kas terlihat kurang
              saat tutup shift.
            </>
          )}
        </p>
        <dl className="flex flex-wrap gap-x-8 gap-y-1 pt-1 font-mono text-xs text-muted-foreground">
          <div className="flex gap-2">
            <dt>Outlet</dt>
            <dd className="text-foreground">{audit.outlet.name}</dd>
          </div>
          <div className="flex gap-2">
            <dt>Periode</dt>
            <dd className="text-foreground">
              <LocalDateTime value={`${audit.range.from}T00:00:00`} options={DAY_ONLY} /> –{' '}
              <LocalDateTime value={`${audit.range.to}T00:00:00`} options={DAY_ONLY} />
            </dd>
          </div>
          <div className="flex gap-2">
            <dt>Transaksi kasir</dt>
            <dd className="text-foreground">{summary.totalOrdersScanned}</dd>
          </div>
        </dl>
      </header>

      <RangeForm outletId={outlet_id} from={audit.range.from} to={audit.range.to} />

      <Section title="Ringkasan">
        <dl className="grid gap-px overflow-hidden rounded-md border bg-border sm:grid-cols-2 lg:grid-cols-4">
          <Figure
            label="Pasangan nota ganda"
            value={String(summary.pairs)}
            sub={`dari ${summary.totalOrdersScanned} transaksi kasir`}
            critical={summary.pairs > 0}
          />
          <Figure
            label="Nilai nota berlebih"
            value={formatCurrency(summary.excessValue)}
            sub="penjualan yang tidak pernah terjadi"
            critical={summary.excessValue > 0}
          />
          <Figure
            label="Tercatat sebagai tunai"
            value={formatCurrency(summary.cashValue)}
            sub="membuat laci kas kurang"
            critical={summary.cashValue > 0}
          />
          <Figure
            label="Tercatat non-tunai"
            value={formatCurrency(summary.nonCashValue)}
            sub="tidak memengaruhi laci"
          />
        </dl>
        {summary.pairs > 0 && (
          <div className="max-w-[62ch] space-y-3 text-sm text-muted-foreground">
            <p>
              Setiap pasangan di bawah ini berisi{' '}
              <strong className="font-semibold text-foreground">
                item yang persis sama dengan nilai yang sama
              </strong>
              , dibuat dalam rentang {audit.windowSeconds} detik. Jeda selama itu terlalu lambat
              untuk sekadar salah klik dua kali, dan pas untuk pola “struk gagal keluar, lalu
              dibuat ulang”.
            </p>
            <p>
              <strong className="font-semibold text-foreground">
                {summary.likely.pairs} pasangan
              </strong>{' '}
              hampir pasti ganda (nilai {formatCurrency(summary.likely.value)}, tunai{' '}
              {formatCurrency(summary.likely.cashValue)}).{' '}
              <strong className="font-semibold text-foreground">
                {summary.review.pairs} pasangan
              </strong>{' '}
              perlu dicek ulang (nilai {formatCurrency(summary.review.value)}).
            </p>
          </div>
        )}
      </Section>

      {shifts.length > 0 && (
        <Section title="Dampak ke laci kas">
          <p className="max-w-[62ch] text-sm text-muted-foreground">
            Nota ganda yang tercatat <strong className="font-semibold text-foreground">tunai</strong>{' '}
            menambah uang masuk yang sebenarnya tidak pernah diterima, jadi sistem mengira laci
            berisi lebih banyak daripada kenyataannya. Angka penutupan shift sendiri tidak diubah —
            yang salah adalah catatan penjualannya, bukan hitungan lacinya.
          </p>
          <div className="space-y-4">
            {shifts.map((s) => (
              <div key={s.id} className="rounded-md border p-5">
                <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
                  <h3 className="font-semibold">
                    Shift #{s.id} — {s.cashierName}
                  </h3>
                  <p className="font-mono text-xs text-muted-foreground">
                    {s.openedAt && <LocalDateTime value={s.openedAt} />}
                    {s.closedAt && (
                      <>
                        {' → '}
                        <LocalTime value={s.closedAt} options={HM} />
                      </>
                    )}
                  </p>
                </div>
                <dl className="space-y-0">
                  <LedgerRow
                    label="Saldo sistem saat tutup shift"
                    amount={s.expectedCash === null ? null : formatCurrency(s.expectedCash)}
                  />
                  <LedgerRow
                    label={`Uang tunai dari ${s.pairs} nota ganda (tidak pernah diterima)`}
                    amount={`− ${formatCurrency(s.phantomCash)}`}
                    minus
                  />
                  <LedgerRow
                    label="Saldo yang seharusnya"
                    amount={
                      s.adjustedExpectedCash === null
                        ? null
                        : formatCurrency(s.adjustedExpectedCash)
                    }
                    total
                  />
                </dl>
                {s.countedCash !== null && (
                  <p className="mt-3 text-xs text-muted-foreground">
                    Uang yang dihitung saat tutup: {formatCurrency(s.countedCash)} — selisih tercatat{' '}
                    {formatCurrency(s.variance ?? 0)}.
                  </p>
                )}
              </div>
            ))}
          </div>
        </Section>
      )}

      {byDay.length > 0 && (
        <Section title="Rincian per hari">
          <div className="overflow-x-auto rounded-md border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/50 text-[0.68rem] uppercase tracking-wider text-muted-foreground">
                  <th className="px-3 py-2 text-left font-semibold">Tanggal</th>
                  <th className="px-3 py-2 text-right font-semibold">Nota ganda</th>
                  <th className="px-3 py-2 text-right font-semibold">Nilai berlebih</th>
                  <th className="px-3 py-2 text-right font-semibold">Tercatat tunai</th>
                </tr>
              </thead>
              <tbody>
                {byDay.map((d) => (
                  <tr key={d.day} className="border-b last:border-0">
                    <td className="px-3 py-2 whitespace-nowrap">
                      <LocalDateTime value={`${d.day}T00:00:00`} options={DAY_ONLY} />
                    </td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums">{d.pairs}</td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums">
                      {formatCurrency(d.value)}
                    </td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums">
                      {formatCurrency(d.cashValue)}
                    </td>
                  </tr>
                ))}
                <tr className="border-t-2 border-foreground bg-muted/40 font-semibold">
                  <td className="px-3 py-2">Total {byDay.length} hari</td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums">{summary.pairs}</td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums">
                    {formatCurrency(summary.excessValue)}
                  </td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums">
                    {formatCurrency(summary.cashValue)}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </Section>
      )}

      {pairs.length > 0 && (
        <Section title="Daftar lengkap nota ganda">
          <p className="max-w-[62ch] text-sm text-muted-foreground">
            Waktu kiri adalah nota pertama, waktu merah adalah nota kedua yang perlu dibatalkan.
            Ditandai <strong className="font-semibold text-foreground">“Perlu dicek”</strong> bila
            item tunggal, jeda lebih dari 30 detik, dan metode bayarnya sama — pesanan seperti itu
            masih mungkin memang dua pembeli berbeda, jadi mohon dipastikan dulu.
          </p>
          <p className="max-w-[62ch] text-sm text-muted-foreground">
            Bila kasir sempat mengetik{' '}
            <strong className="font-semibold text-foreground">Nama Pelanggan</strong>, nama itulah
            yang menentukan: <strong className="font-semibold text-foreground">nama yang sama</strong>{' '}
            pada kedua nota berarti satu pesanan yang terkirim dua kali, sedangkan{' '}
            <strong className="font-semibold text-foreground">dua nama berbeda</strong> berarti dua
            pembeli dan nota keduanya jangan dibatalkan. Tanda “—” berarti namanya memang tidak
            diisi, jadi penilaian kembali memakai item, jeda, dan metode bayar.
          </p>
          <p className="max-w-[62ch] text-sm text-muted-foreground">
            <strong className="font-semibold text-foreground">Kode nota bisa diklik</strong> dan
            terbuka di tab baru, langsung ke rincian pesanannya — kode merah adalah nota kedua yang
            perlu dibatalkan. Kode yang tertulis sama dengan yang Anda lihat di Riwayat Pesanan,
            jadi bisa langsung dicocokkan. Halaman rincian mengikuti{' '}
            <strong className="font-semibold text-foreground">outlet aktif</strong> Anda, jadi bila
            Anda mengelola lebih dari satu outlet, pindah dulu ke {audit.outlet.name} lewat menu
            Outlet — kalau tidak, rinciannya akan tertulis tidak ditemukan.
          </p>
          <div className="overflow-x-auto rounded-md border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/50 text-[0.68rem] uppercase tracking-wider text-muted-foreground">
                  <th className="px-3 py-2 text-left font-semibold">Jam</th>
                  <th className="px-3 py-2 text-left font-semibold">Item &amp; kode nota</th>
                  <th className="px-3 py-2 text-left font-semibold">Pelanggan</th>
                  <th className="px-3 py-2 text-right font-semibold">Nilai</th>
                  <th className="px-3 py-2 text-left font-semibold">Bayar</th>
                  <th className="px-3 py-2 text-left font-semibold">Kasir / shift</th>
                  <th className="px-3 py-2 text-left font-semibold">Status</th>
                </tr>
              </thead>
              <tbody>
                {pairs.map((p) => (
                  <tr key={p.secondId} className="border-b align-top last:border-0">
                    <td className="px-3 py-2 font-mono text-xs whitespace-nowrap">
                      <LocalTime value={p.firstAt} />
                      <span className="mx-1 text-muted-foreground">→</span>
                      <span className="text-destructive">
                        <LocalTime value={p.secondAt} />
                      </span>
                      <span className="block text-[0.7rem] text-muted-foreground">
                        jeda {p.gapSeconds} dtk
                      </span>
                    </td>
                    <td className="min-w-[15rem] px-3 py-2 text-muted-foreground">
                      {p.items.map((i) => itemLabel(i)).join(', ')}
                      <span className="mt-0.5 block font-mono text-[0.68rem]">
                        <OrderLink id={p.firstId} />
                        <span className="text-muted-foreground/80"> / </span>
                        <OrderLink id={p.secondId} second />
                      </span>
                    </td>
                    <td className="px-3 py-2 text-xs">
                      <CustomerCell first={p.firstCustomer} second={p.secondCustomer} />
                    </td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums whitespace-nowrap">
                      {formatCurrency(p.amount)}
                    </td>
                    <td className="px-3 py-2">
                      <span className="flex flex-wrap items-center gap-1 text-[0.68rem]">
                        <span className="rounded-sm border bg-muted/50 px-1.5 py-0.5 text-muted-foreground">
                          {p.firstPayment ? posPaymentLabel(p.firstPayment) : '—'}
                        </span>
                        <span className="text-muted-foreground">→</span>
                        <span
                          className={
                            p.firstPayment !== p.secondPayment
                              ? 'rounded-sm border border-destructive/40 bg-destructive/10 px-1.5 py-0.5 text-destructive'
                              : 'rounded-sm border bg-muted/50 px-1.5 py-0.5 text-muted-foreground'
                          }
                        >
                          {p.secondPayment ? posPaymentLabel(p.secondPayment) : '—'}
                        </span>
                      </span>
                    </td>
                    <td className="px-3 py-2 text-xs text-muted-foreground whitespace-nowrap">
                      {p.cashierName ?? '—'}
                      {p.shiftId !== null && <span className="block">shift #{p.shiftId}</span>}
                    </td>
                    <td className="px-3 py-2">
                      <span
                        className={`rounded-sm px-1.5 py-0.5 text-[0.68rem] font-medium whitespace-nowrap ${
                          p.confidence === 'review'
                            ? 'bg-amber-500/15 text-amber-700 dark:text-amber-400'
                            : 'bg-destructive/10 text-destructive'
                        }`}
                      >
                        {p.confidence === 'review' ? 'Perlu dicek' : 'Hampir pasti'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {audit.truncated && (
            <p className="text-xs text-muted-foreground">
              Daftar dipotong pada 500 pasangan. Persempit rentang tanggal untuk melihat sisanya.
            </p>
          )}
        </Section>
      )}

      {summary.pairs > 0 && (
        <Section title="Penyebab &amp; tindak lanjut">
          <p className="max-w-[62ch] text-sm text-muted-foreground">
            Saat koneksi internet tersendat, pesanan sudah tersimpan di server tetapi kasir tidak
            menerima balasan — di layar muncul pesan gagal dan keranjang tidak kosong. Kasir wajar
            menekan Checkout sekali lagi, dan tersimpanlah nota kedua.
          </p>
          <ol className="max-w-[60ch] list-decimal space-y-2 pl-5 text-sm text-muted-foreground">
            <li>
              <strong className="font-semibold text-foreground">Koreksi data.</strong> Setelah Anda
              memastikan daftar di atas, batalkan nota kedua pada tiap pasangan lewat Riwayat
              Pesanan agar laporan penjualan, stok, dan kas kembali akurat.
            </li>
            <li>
              <strong className="font-semibold text-foreground">Sementara ini.</strong> Bila
              Checkout menampilkan pesan gagal, cek dulu daftar pesanan sebelum mengulang —
              kemungkinan besar pesanan sudah tersimpan.
            </li>
          </ol>
        </Section>
      )}

      <footer className="max-w-[62ch] space-y-1 border-t pt-5 text-xs text-muted-foreground">
        <p>
          Data dibaca langsung dari basis data saat halaman ini dibuka, mencakup transaksi kasir
          outlet {audit.outlet.name}. Nota yang sudah dibatalkan tidak dihitung.
        </p>
        <p>
          Nota ganda dikenali dari kombinasi item, jumlah, dan nilai yang identik dalam rentang{' '}
          {audit.windowSeconds} detik.
        </p>
      </footer>
    </Shell>
  );
}

/**
 * "Nasi Goreng (pedas) x2".
 *
 * note_product carries whatever the cashier typed into the line's note box, and
 * the POS writes a literal "-" when they typed nothing — so an unguarded render
 * puts "(-)" after half the items on the page. Anything with no letters or
 * digits in it is a placeholder, not a note.
 */
function itemLabel(i: { name: string; qty: number; note: string | null }): string {
  const note = i.note?.trim() ?? '';
  const hasNote = /[\p{L}\p{N}]/u.test(note);
  return `${i.name}${hasNote ? ` (${note})` : ''} x${i.qty}`;
}

/**
 * The "Nama Pelanggan" on each of the two notes.
 *
 * Three states, and the difference between them is the whole point of the
 * column. One name shown once means both notes carry it — the same buyer, so
 * the second note is a retry. Two names means two people, and the second note
 * is a real sale that must NOT be cancelled, so it is drawn the way a mismatched
 * payment method is. An em dash means nobody typed a name, which is the ordinary
 * case at a busy counter and carries no signal either way.
 */
function CustomerCell({ first, second }: { first: string | null; second: string | null }) {
  if (!first && !second) return <span className="text-muted-foreground">—</span>;

  // Same comparison the backend scores on, so the cell can never disagree with
  // the "Status" column beside it.
  const norm = (v: string) => v.trim().toLowerCase().replace(/\s+/g, ' ');
  if (first && second && norm(first) === norm(second)) {
    return <span className="whitespace-nowrap text-foreground">{first}</span>;
  }

  return (
    <span className="flex flex-wrap items-center gap-1">
      <span className="text-muted-foreground">{first ?? '—'}</span>
      <span className="text-muted-foreground">→</span>
      <span className="rounded-sm border border-destructive/40 bg-destructive/10 px-1.5 py-0.5 text-destructive">
        {second ?? '—'}
      </span>
    </span>
  );
}

/**
 * A note code, linking to the order it names.
 *
 * Opens in a new tab on purpose: this page is worked as a checklist — open a
 * note, confirm it, cancel it, come back for the next row — and navigating in
 * place would throw away the scroll position and the chosen date range every
 * single time.
 *
 * Rendered as the LAST 8 characters, uppercased, behind a "#" — the same short
 * code every other screen in the app prints for an order (the Order Lobby, the
 * history lists, the detail page's own header, the code a courier types to
 * search). Order ids are uuid v4, whose leading characters are the random ones
 * but whose formatting makes the head easy to misread across rows; either end
 * is equally unique, so the one that matches the rest of the product wins. An
 * owner must be able to read a code here and recognise it there.
 *
 * The target resolves the order against the reader's ACTIVE outlet cookie
 * (get-outlet-order-detail in routes/owner.ts), NOT the outlet in this page's
 * URL, so it 404s for anyone reading an outlet they are not currently switched
 * to — a multi-outlet owner, or a platform admin. The paragraph above the table
 * says so; fixing it properly means widening that route's scoping, which is a
 * decision about authorisation and not one to make from a link.
 */
function OrderLink({ id, second }: { id: string; second?: boolean }) {
  return (
    <a
      href={`/dashboard/order-outlet/${id}`}
      target="_blank"
      rel="noopener noreferrer"
      // The cell shows the short code every other screen shows; the tooltip
      // carries the full uuid, which is what someone pasting into a support
      // chat actually needs.
      title={id}
      className={`underline decoration-dotted underline-offset-2 hover:decoration-solid ${
        second ? 'text-destructive' : 'text-muted-foreground'
      }`}
    >
      #{id.slice(-8).toUpperCase()}
    </a>
  );
}

const DAY_ONLY: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'long', year: 'numeric' };
const HM: Intl.DateTimeFormatOptions = { hour: '2-digit', minute: '2-digit', hour12: false };

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-10 px-4 py-10 sm:px-6">
      {children}
    </main>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-xl font-semibold tracking-tight">{title}</h2>
      {children}
    </section>
  );
}

function Figure({
  label,
  value,
  sub,
  critical,
}: {
  label: string;
  value: string;
  sub: string;
  critical?: boolean;
}) {
  return (
    <div className="flex flex-col gap-1 bg-background p-4">
      <dt className="text-[0.72rem] font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </dt>
      <dd
        className={`font-mono text-xl font-medium tabular-nums ${critical ? 'text-destructive' : ''}`}
      >
        {value}
      </dd>
      <p className="text-xs text-muted-foreground">{sub}</p>
    </div>
  );
}

function LedgerRow({
  label,
  amount,
  minus,
  total,
}: {
  label: string;
  amount: string | null;
  minus?: boolean;
  total?: boolean;
}) {
  return (
    <div
      className={`flex items-baseline justify-between gap-6 py-2 ${
        total ? 'mt-1 border-t-2 border-foreground pt-3 font-semibold' : 'border-b border-dotted'
      }`}
    >
      <span className={total ? 'text-foreground' : 'text-muted-foreground'}>{label}</span>
      <span
        className={`font-mono tabular-nums whitespace-nowrap ${minus ? 'text-destructive' : ''}`}
      >
        {amount ?? '—'}
      </span>
    </div>
  );
}
