import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { guideCategories, guidePath, guides } from "./guides";

export const metadata: Metadata = {
  title: "Panduan",
};

export default function PanduanPage() {
  return (
    <main className="mx-2 px-4 pb-16 md:mx-6">
      <div className="mx-auto flex max-w-4xl flex-col gap-10 pt-2">
        <header className="flex max-w-[64ch] flex-col gap-2">
          <h1 className="text-3xl font-bold tracking-tight">Panduan</h1>
          <p className="text-muted-foreground">
            Cara kerja fitur Ulun Pesan: dari mana angka di laporan berasal, dan cara memakai
            fitur yang tidak selalu terlihat di menu.
          </p>
        </header>

        {guideCategories.map((category) => {
          const items = guides.filter((g) => g.category === category);
          if (items.length === 0) return null;
          return (
            <section key={category} className="flex flex-col gap-3">
              <h2 className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                {category}
              </h2>
              <ul className="grid gap-3 sm:grid-cols-2">
                {items.map((guide) => {
                  const Icon = guide.icon;
                  return (
                    <li key={guide.slug}>
                      <Link
                        href={guidePath(guide.slug)}
                        className="group flex h-full gap-4 rounded-2xl border bg-card p-5 transition-colors hover:border-foreground/25 hover:bg-muted/40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                      >
                        <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-muted">
                          <Icon className="size-5 text-foreground/80" />
                        </span>
                        <span className="flex min-w-0 flex-1 flex-col gap-1">
                          <span className="flex items-center justify-between gap-2 font-semibold">
                            {guide.title}
                            <ArrowRight className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
                          </span>
                          <span className="text-sm text-muted-foreground">{guide.summary}</span>
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })}

        <p className="text-sm text-muted-foreground">Panduan fitur lain menyusul.</p>
      </div>
    </main>
  );
}
