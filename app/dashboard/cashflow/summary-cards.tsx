import { ArrowUpRight, ArrowDownRight, TrendingUp, TrendingDown } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatMonthYear } from "@/lib/date-calender";

interface SummaryCardsProps {
    dailyIn: number;
    dailyOut: number;
    monthlyIn: number;
    monthlyOut: number;
    isToday: boolean;
    selectedDate: Date;
    formatCurrency: (value: number) => string;
}

export function SummaryCards({ dailyIn, dailyOut, monthlyIn, monthlyOut, isToday, selectedDate, formatCurrency }: SummaryCardsProps) {
    return (
        <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
            <Card className="bg-gradient-to-br from-green-50 to-emerald-50 dark:from-green-950/20 dark:to-emerald-950/20 border-green-100 dark:border-green-900/50">
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium text-green-800 dark:text-green-400">Daily In</CardTitle>
                    <ArrowUpRight className="h-4 w-4 text-green-600 dark:text-green-400" />
                </CardHeader>
                <CardContent>
                    <div className="text-2xl font-bold text-green-900 dark:text-green-300">{formatCurrency(dailyIn)}</div>
                    <p className="text-xs text-green-600/80 dark:text-green-500 mt-1">{isToday ? "Today's" : "Selected day's"} total income</p>
                </CardContent>
            </Card>

            <Card className="bg-gradient-to-br from-red-50 to-rose-50 dark:from-red-950/20 dark:to-rose-950/20 border-red-100 dark:border-red-900/50">
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium text-red-800 dark:text-red-400">Daily Out</CardTitle>
                    <ArrowDownRight className="h-4 w-4 text-red-600 dark:text-red-400" />
                </CardHeader>
                <CardContent>
                    <div className="text-2xl font-bold text-red-900 dark:text-red-300">{formatCurrency(dailyOut)}</div>
                    <p className="text-xs text-red-600/80 dark:text-red-500 mt-1">{isToday ? "Today's" : "Selected day's"} total expenses</p>
                </CardContent>
            </Card>

            <Card className="lg:col-start-3">
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">Monthly In</CardTitle>
                    <TrendingUp className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                    <div className="text-2xl font-bold">{formatCurrency(monthlyIn)}</div>
                    <p className="text-xs text-muted-foreground mt-1">{formatMonthYear(selectedDate)}</p>
                </CardContent>
            </Card>

            <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">Monthly Out</CardTitle>
                    <TrendingDown className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                    <div className="text-2xl font-bold">{formatCurrency(monthlyOut)}</div>
                    <p className="text-xs text-muted-foreground mt-1">{formatMonthYear(selectedDate)}</p>
                </CardContent>
            </Card>
        </div>
    );
}
