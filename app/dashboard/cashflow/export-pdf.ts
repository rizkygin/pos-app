import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { formatMonthYear, formatReadableDate, formatShortDate } from "@/lib/date-calender";

export interface Transaction {
    id: string;
    type: "IN" | "OUT";
    category: string;
    amount: number;
    date: string;
    note: string;
}

interface ExportParams {
    monthlyTransactions: Transaction[];
    monthlyIn: number;
    monthlyOut: number;
    monthlyNet: number;
    selectedDate: Date;
}

export function exportMonthlyPDF({ monthlyTransactions, monthlyIn, monthlyOut, monthlyNet, selectedDate }: ExportParams) {
    const doc = new jsPDF();
    const period = formatMonthYear(selectedDate);
    const currFmt = (v: number) => new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0 }).format(v);

    doc.setFontSize(18);
    doc.setFont("helvetica", "bold");
    doc.text("Monthly Cashflow Report", 14, 20);
    doc.setFontSize(11);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(100);
    doc.text(`Period: ${period}`, 14, 28);
    doc.text(`Generated: ${formatReadableDate(new Date())}`, 14, 34);
    doc.setTextColor(0);

    let yPos = 44;

    doc.setFontSize(13);
    doc.setFont("helvetica", "bold");
    doc.text("Transaction Details", 14, yPos);
    yPos += 2;

    const sortedTx = [...monthlyTransactions].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

    autoTable(doc, {
        startY: yPos,
        head: [["#", "Date", "Type", "Category", "Note", "Amount"]],
        body: sortedTx.map((t, i) => [
            String(i + 1),
            formatShortDate(new Date(t.date)),
            t.type === "IN" ? "Cash In" : "Cash Out",
            t.category,
            t.note || "-",
            (t.type === "OUT" ? "- " : "+ ") + currFmt(t.amount)
        ]),
        theme: "striped",
        headStyles: { fillColor: [41, 128, 185], textColor: 255, fontStyle: "bold" },
        styles: { fontSize: 8, cellPadding: 3 },
        columnStyles: { 0: { cellWidth: 10 }, 5: { halign: "right" } },
        margin: { left: 14, right: 14 }
    });

    yPos = (doc as any).lastAutoTable?.finalY ?? yPos + 10;
    yPos += 10;

    if (yPos > 230) { doc.addPage(); yPos = 20; }

    doc.setFontSize(13);
    doc.setFont("helvetica", "bold");
    doc.text("Income Details by Category", 14, yPos);
    yPos += 2;

    const incomeByCategory: Record<string, number> = {};
    monthlyTransactions.filter(t => t.type === "IN").forEach(t => {
        incomeByCategory[t.category] = (incomeByCategory[t.category] || 0) + t.amount;
    });
    const incomeRows = Object.entries(incomeByCategory).sort((a, b) => b[1] - a[1]);

    autoTable(doc, {
        startY: yPos,
        head: [["Category", "Total"]],
        body: [
            ...incomeRows.map(([cat, amt]) => [cat, currFmt(amt)]),
            [{ content: "Total Income", styles: { fontStyle: "bold" } }, { content: currFmt(monthlyIn), styles: { fontStyle: "bold" } }]
        ],
        theme: "striped",
        headStyles: { fillColor: [39, 174, 96], textColor: 255, fontStyle: "bold" },
        styles: { fontSize: 9, cellPadding: 3 },
        columnStyles: { 1: { halign: "right" } },
        margin: { left: 14, right: 14 }
    });

    yPos = (doc as any).lastAutoTable?.finalY ?? yPos + 10;
    yPos += 10;

    if (yPos > 230) { doc.addPage(); yPos = 20; }

    doc.setFontSize(13);
    doc.setFont("helvetica", "bold");
    doc.text("Expense Details by Category", 14, yPos);
    yPos += 2;

    const expenseByCategory: Record<string, number> = {};
    monthlyTransactions.filter(t => t.type === "OUT").forEach(t => {
        expenseByCategory[t.category] = (expenseByCategory[t.category] || 0) + t.amount;
    });
    const expenseRows = Object.entries(expenseByCategory).sort((a, b) => b[1] - a[1]);

    autoTable(doc, {
        startY: yPos,
        head: [["Category", "Total"]],
        body: [
            ...expenseRows.map(([cat, amt]) => [cat, currFmt(amt)]),
            [{ content: "Total Expenses", styles: { fontStyle: "bold" } }, { content: currFmt(monthlyOut), styles: { fontStyle: "bold" } }]
        ],
        theme: "striped",
        headStyles: { fillColor: [192, 57, 43], textColor: 255, fontStyle: "bold" },
        styles: { fontSize: 9, cellPadding: 3 },
        columnStyles: { 1: { halign: "right" } },
        margin: { left: 14, right: 14 }
    });

    yPos = (doc as any).lastAutoTable?.finalY ?? yPos + 10;
    yPos += 10;

    if (yPos > 230) { doc.addPage(); yPos = 20; }

    doc.setFontSize(13);
    doc.setFont("helvetica", "bold");
    doc.text("End of Month Cash Reconciliation", 14, yPos);
    yPos += 2;

    autoTable(doc, {
        startY: yPos,
        head: [["Description", "Amount"]],
        body: [
            ["Total Cash In", currFmt(monthlyIn)],
            ["Total Cash Out", "(" + currFmt(monthlyOut) + ")"],
            [{ content: "Net Cash Flow", styles: { fontStyle: "bold" } }, { content: currFmt(monthlyNet), styles: { fontStyle: "bold", textColor: monthlyNet >= 0 ? [39, 174, 96] : [192, 57, 43] } }],
        ],
        theme: "plain",
        headStyles: { fillColor: [52, 73, 94], textColor: 255, fontStyle: "bold" },
        styles: { fontSize: 10, cellPadding: 4 },
        columnStyles: { 1: { halign: "right" } },
        margin: { left: 14, right: 14 }
    });

    yPos = (doc as any).lastAutoTable?.finalY ?? yPos + 10;
    yPos += 8;

    doc.setFontSize(10);
    doc.setFont("helvetica", "italic");
    doc.setTextColor(100);
    doc.text(monthlyNet >= 0 ? "✓ Positive cash flow — Surplus" : "⚠ Negative cash flow — Deficit", 14, yPos);

    const pageCount = doc.getNumberOfPages();
    for (let i = 1; i <= pageCount; i++) {
        doc.setPage(i);
        doc.setFontSize(8);
        doc.setFont("helvetica", "normal");
        doc.setTextColor(150);
        doc.text(`Page ${i} of ${pageCount}`, doc.internal.pageSize.getWidth() - 30, doc.internal.pageSize.getHeight() - 10);
        doc.text("Cashflow Report — POS System", 14, doc.internal.pageSize.getHeight() - 10);
    }

    const monthSlug = period.toLowerCase().replace(/\s+/g, '-');
    doc.save(`cashflow-report-${monthSlug}.pdf`);
}
