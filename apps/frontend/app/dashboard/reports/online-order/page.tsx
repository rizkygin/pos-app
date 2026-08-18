import { SegmentReport } from '@/components/reports/segment-report';

export default function Page() {
  return (
    <SegmentReport
      dimension="online"
      title="Laporan Order Online"
      subtitle="Pesanan dari aplikasi, dikelompokkan per jenis pengantaran"
      groupHeading="Jenis Order"
    />
  );
}
