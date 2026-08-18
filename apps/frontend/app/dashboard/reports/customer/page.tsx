import { SegmentReport } from '@/components/reports/segment-report';

export default function Page() {
  return (
    <SegmentReport
      dimension="customer"
      title="Laporan per Pelanggan"
      subtitle="Semua pesanan per nama pelanggan — kasir dan aplikasi"
      groupHeading="Pelanggan"
    />
  );
}
