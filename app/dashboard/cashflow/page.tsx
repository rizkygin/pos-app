'use client';

import { useState, useMemo, useEffect } from 'react';
import {
  PlusCircle,
  ArrowUpRight,
  ArrowDownRight,
  Wallet,
  Calendar as CalendarIcon,
  ChevronLeft,
  ChevronRight,
  Download,
  Trash2,
} from 'lucide-react';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { Calendar } from '@/components/ui/calendar';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { CATEGORY_IN, CATEGORY_OUT } from '@/lib/cashflow-categories';
import {
  isSameDay,
  isSameMonth,
  formatReadableDate,
  formatDateInput,
} from '@/lib/date-calender';
import { formatCurrency } from '@/lib/utils/format';
import { exportMonthlyPDF, type Transaction } from './export-pdf';
import { SummaryCards } from './summary-cards';

type TransactionType = 'IN' | 'OUT';

export default function CashflowPage() {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const [type, setType] = useState<TransactionType>('IN');
  const [category, setCategory] = useState<string>(CATEGORY_IN[1]);
  const [amount, setAmount] = useState<string>('');

  const handleTypeChange = (newType: TransactionType) => {
    setType(newType);
    setCategory(newType === 'IN' ? CATEGORY_IN[1] : CATEGORY_OUT[0]);
  };

  const handleDelete = async (id: string) => {
    await fetch(`/api/cashflow?id=${id}`, { method: 'DELETE' });
    setTransactions((prev) => prev.filter((t) => t.id !== id));
  };

  const handleAddTransaction = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!amount || isNaN(Number(amount)) || Number(amount) <= 0) return;

    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const res = await fetch('/api/cashflow', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type,
        category,
        amount: Number(amount),
        date: formatDateInput(selectedDate),
        timezone,
      }),
    });
    const json = await res.json();
    if (res.ok) {
      setTransactions((prev) => [json.data, ...prev]);
      setAmount('');
    }
  };

  const [selectedDate, setSelectedDate] = useState<Date>(new Date());

  useEffect(() => {
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const month = formatDateInput(selectedDate).slice(0, 7);

    setIsLoading(true);
    fetch(
      `/api/cashflow?month=${month}&timezone=${encodeURIComponent(timezone)}`,
    )
      .then((r) => r.json())
      .then((j) => setTransactions(j.data ?? []))
      .catch(() => setTransactions([]))
      .finally(() => setIsLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDate.getFullYear(), selectedDate.getMonth()]);

  const handlePrevDay = () => {
    const prev = new Date(selectedDate);
    prev.setDate(prev.getDate() - 1);
    setSelectedDate(prev);
  };

  const handleNextDay = () => {
    const next = new Date(selectedDate);
    next.setDate(next.getDate() + 1);
    setSelectedDate(next);
  };

  const isToday = isSameDay(selectedDate, new Date());

  // Daily calculations
  const dailyTransactions = useMemo(() => {
    return transactions.filter((t) =>
      isSameDay(new Date(t.date), selectedDate),
    );
  }, [transactions, selectedDate]);

  const dailyIn = dailyTransactions
    .filter((t) => t.type === 'IN' && t.category)
    .reduce((acc, t) => acc + t.amount, 0);
  const dailyOut = dailyTransactions
    .filter((t) => t.type === 'OUT')
    .reduce((acc, t) => acc + t.amount, 0);
  const dailyNet = dailyIn - dailyOut;

  // Monthly calculations
  const monthlyTransactions = useMemo(() => {
    return transactions.filter((t) =>
      isSameMonth(new Date(t.date), selectedDate),
    );
  }, [transactions, selectedDate]);

  const monthlyIn = monthlyTransactions
    .filter((t) => t.type === 'IN')
    .reduce((acc, t) => acc + t.amount, 0);
  const monthlyOut = monthlyTransactions
    .filter((t) => t.type === 'OUT')
    .reduce((acc, t) => acc + t.amount, 0);
  const monthlyNet = monthlyIn - monthlyOut;

  const displayList = useMemo(() => {
    const posCashIn = dailyTransactions.find(
      (t) => t.category === CATEGORY_IN[0],
    );
    const rest = dailyTransactions
      .filter((t) => t.category !== CATEGORY_IN[0])
      .sort((a, b) => {
        const aKey = `${a.date} ${a.time ?? ''}`;
        const bKey = `${b.date} ${b.time ?? ''}`;
        return aKey.localeCompare(bKey);
      });
    if (posCashIn) {
      return [{ ...posCashIn, note: 'Dari Sistem Cashier' }, ...rest];
    }
    return rest;
  }, [transactions, dailyTransactions]);

  return (
    <div className="flex-1 space-y-6 p-8 pt-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-2">
          <Button
            variant="outline"
            size="icon"
            className="h-8 w-8"
            onClick={handlePrevDay}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Popover>
            <PopoverTrigger asChild>
              <Button
                variant={'outline'}
                className={cn(
                  'h-8 justify-start text-left font-normal px-3 min-w-[150px]',
                  !selectedDate && 'text-muted-foreground',
                )}
              >
                <CalendarIcon className="mr-2 h-4 w-4" />
                {selectedDate ? (
                  formatReadableDate(selectedDate)
                ) : (
                  <span>Pick a date</span>
                )}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              <Calendar
                mode="single"
                selected={selectedDate}
                onSelect={(date) => {
                  if (date) setSelectedDate(date);
                }}
              />
            </PopoverContent>
          </Popover>
          <Button
            variant="outline"
            size="icon"
            className="h-8 w-8"
            onClick={handleNextDay}
            disabled={isToday}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
        <Button
          variant="outline"
          className="h-8"
          onClick={() =>
            exportMonthlyPDF({
              monthlyTransactions,
              monthlyIn,
              monthlyOut,
              monthlyNet,
              selectedDate,
            })
          }
        >
          <Download className="mr-2 h-4 w-4" />
          Export PDF
        </Button>
      </div>

      <SummaryCards
        dailyIn={dailyIn}
        dailyOut={dailyOut}
        monthlyIn={monthlyIn}
        monthlyOut={monthlyOut}
        isToday={isToday}
        selectedDate={selectedDate}
        formatCurrency={formatCurrency}
      />

      <div className="grid lg:gap-4 lg:grid-cols-7">
        {/* Form Section */}
        <Card className="col-span-full lg:col-span-3 mb-5">
          <CardHeader>
            <CardTitle>Tambahkan Arus Kas</CardTitle>
            <CardDescription>Catat Arus Kas Pian</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleAddTransaction} className="space-y-4">
              <div className="space-y-2">
                <label className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
                  Tipe Transaksi
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <Button
                    type="button"
                    variant={type === 'IN' ? 'default' : 'outline'}
                    className={
                      type === 'IN'
                        ? 'bg-green-600 hover:bg-green-700 text-white'
                        : ''
                    }
                    onClick={() => handleTypeChange('IN')}
                  >
                    <ArrowUpRight className="mr-2 h-4 w-4" /> Uang Masuk
                  </Button>
                  <Button
                    type="button"
                    variant={type === 'OUT' ? 'default' : 'outline'}
                    className={
                      type === 'OUT'
                        ? 'bg-red-600 hover:bg-red-700 text-white'
                        : ''
                    }
                    onClick={() => handleTypeChange('OUT')}
                  >
                    <ArrowDownRight className="mr-2 h-4 w-4" /> Uang Keluar
                  </Button>
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium leading-none">
                  Kategori
                </label>
                <select
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  className="flex h-10 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                  required
                >
                  {type === 'IN'
                    ? CATEGORY_IN.filter((c) => c !== CATEGORY_IN[0]).map(
                        (c) => (
                          <option key={c} value={c}>
                            {c}
                          </option>
                        ),
                      )
                    : CATEGORY_OUT.map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                </select>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium leading-none">
                  Jumlah (Rp)
                </label>
                <div className="relative">
                  <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-sm font-medium text-muted-foreground">
                    Rp
                  </span>
                  <Input
                    type="text"
                    inputMode="numeric"
                    placeholder="0"
                    className="pl-9"
                    value={
                      amount
                        ? new Intl.NumberFormat('id-ID').format(Number(amount))
                        : ''
                    }
                    onChange={(e) => {
                      const raw = e.target.value.replace(/\D/g, '');
                      setAmount(raw);
                    }}
                    required
                  />
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium leading-none">Tanggal</label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      variant={'outline'}
                      className="w-full justify-start text-left font-normal px-3"
                    >
                      <CalendarIcon className="mr-2 h-4 w-4" />
                      {formatReadableDate(selectedDate)}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar
                      mode="single"
                      selected={selectedDate}
                      onSelect={(d) => {
                        if (d) setSelectedDate(d);
                      }}
                    />
                  </PopoverContent>
                </Popover>
              </div>

              <Button type="submit" className="w-full mt-2">
                <PlusCircle className="mr-2 h-4 w-4" />
                Catat Arus Kas
              </Button>
            </form>
          </CardContent>
        </Card>

        {/* History Section */}
        <Card className="col-span-full lg:col-span-4">
          <CardHeader>
            <CardTitle>Transaksi Terbaru</CardTitle>
            <CardDescription>Arus kas Pian per </CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="flex items-center justify-center h-64 text-muted-foreground">
                <p className="text-sm">Loading transactions...</p>
              </div>
            ) : displayList.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-64 text-muted-foreground">
                <Wallet className="h-12 w-12 mb-4 opacity-20" />
                <p>No transactions yet.</p>
                <p className="text-sm">Add one using the form.</p>
              </div>
            ) : (
              <div className="rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Type</TableHead>
                      <TableHead>Category</TableHead>
                      <TableHead>Date</TableHead>
                      <TableHead>Time</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                      <TableHead className="text-right">Balance</TableHead>
                      <TableHead />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {displayList
                      .reduce<{ t: Transaction; balance: number }[]>(
                        (acc, t) => {
                          const prev =
                            acc.length > 0 ? acc[acc.length - 1].balance : 0;
                          const amt = isFinite(Number(t.amount))
                            ? Number(t.amount)
                            : 0;
                          return [
                            ...acc,
                            {
                              t,
                              balance: prev + (t.type === 'IN' ? amt : -amt),
                            },
                          ];
                        },
                        [],
                      )
                      .map(({ t, balance }) => (
                        <TableRow key={t.id}>
                          <TableCell>
                            <Badge
                              variant={
                                t.type === 'IN' ? 'default' : 'destructive'
                              }
                              className={
                                t.type === 'IN'
                                  ? 'bg-green-500 hover:bg-green-600'
                                  : ''
                              }
                            >
                              {t.type}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            <div className="font-medium text-sm">
                              {t.category}
                            </div>
                            {t.note && (
                              <div className="text-xs text-muted-foreground">
                                {t.note}
                              </div>
                            )}
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground">
                            {t.date
                              .split('-')
                              .reverse()
                              .join('/')
                              .replace(
                                /(\d+)\/(\d+)\/(\d{4})/,
                                (_, d, m, y) => `${d}/${m}/${y.slice(2)}`,
                              )}
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground">
                            {t.time ?? '—'}
                          </TableCell>
                          <TableCell
                            className={`text-right font-bold ${t.type === 'IN' ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}
                          >
                            {t.type === 'IN' ? '+' : '-'}
                            {formatCurrency(t.amount)}
                          </TableCell>
                          <TableCell
                            className={`text-right font-semibold ${balance >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}
                          >
                            {formatCurrency(balance)}
                          </TableCell>
                          <TableCell className="text-right">
                            {t.category !== CATEGORY_IN[0] && (
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7 text-muted-foreground hover:text-destructive"
                                onClick={() => handleDelete(t.id)}
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
