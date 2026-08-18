import { SegmentReport } from '@/components/reports/segment-report';

export default function Page() {
  return (
    <SegmentReport
      dimension="cashier"
      title="Laporan per Kasir"
      subtitle="Penjualan kasir dikelompokkan per nama kasir"
      groupHeading="Kasir"
    />
  );
}
