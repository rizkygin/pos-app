import type { Metadata } from 'next';
import { SearchOrderClient } from '@/components/order/search-order-client';

export const metadata: Metadata = {
  title: 'Cari Pesanan',
};

// Everything here is typed by the customer and answered live from
// /api/search-products, so there is nothing to render on the server.
export default function SearchOrderPage() {
  return <SearchOrderClient />;
}
