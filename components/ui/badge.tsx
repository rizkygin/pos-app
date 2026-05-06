import { BadgeDollarSign, CircleEllipsis } from 'lucide-react';

export default function badge({ icon }: { icon: string }) {
    if (icon === 'checkout') {
        return <div className='p-1 bg-green-50 rounded-md flex items-center gap-1'><BadgeDollarSign className='text-green-500' />Terbayar</div>
    } else if (icon === 'addToChart') {
        return <div className='p-1 bg-yellow-50 rounded-md flex items-center gap-1'><CircleEllipsis className='text-yellow-500' />Pending</div>
    }
}