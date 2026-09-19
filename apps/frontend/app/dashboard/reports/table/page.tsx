import { SegmentReport } from '@/components/reports/segment-report';

export default function Page() {
  return (
    <SegmentReport
      dimension="table"
      title="Laporan per Meja"
      subtitle="Bill meja yang sudah dibayar, dikelompokkan per meja (meja gabungan dihitung bersama)"
      groupHeading="Meja"
      emptyHint="Laporan ini terisi dari bill yang dibayar lewat Manajemen Meja."
    />
  );
}
