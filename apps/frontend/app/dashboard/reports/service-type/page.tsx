import { SegmentReport } from '@/components/reports/segment-report';

export default function Page() {
  return (
    <SegmentReport
      dimension="service"
      title="Laporan Dine In / Take Away"
      subtitle="Penjualan kasir per cara penyajian. Tidak Tercatat = transaksi sebelum fitur ini ada atau dari kasir desktop"
      groupHeading="Penyajian"
    />
  );
}
