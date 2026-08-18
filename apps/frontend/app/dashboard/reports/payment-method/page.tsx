import { SegmentReport } from '@/components/reports/segment-report';

export default function Page() {
  return (
    <SegmentReport
      dimension="payment"
      title="Laporan Metode Pembayaran"
      subtitle="Penjualan kasir dikelompokkan per metode bayar"
      groupHeading="Metode Bayar"
    />
  );
}
