import Link from "next/link";
import { ArrowLeft } from "lucide-react";

// The frame every guide sits in: a way back to the list, the guide's category,
// its title and a one-paragraph lede. Kept deliberately plain so the article's
// own diagrams and examples carry the page.
export function ArticleShell({
  category,
  title,
  lede,
  children,
}: {
  category: string;
  title: string;
  lede: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <main className="mx-2 px-4 pb-16 md:mx-6">
      <article className="mx-auto flex max-w-4xl flex-col gap-12 pt-2">
        <header className="flex max-w-[68ch] flex-col gap-3">
          <Link
            href="/dashboard/panduan"
            className="inline-flex w-fit items-center gap-1.5 rounded-md text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            <ArrowLeft className="size-4" />
            Panduan
          </Link>
          <p className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">
            {category}
          </p>
          <h1 className="text-3xl font-bold tracking-tight text-balance sm:text-[34px] sm:leading-tight">
            {title}
          </h1>
          <div className="text-base text-muted-foreground">{lede}</div>
        </header>
        {children}
      </article>
    </main>
  );
}

export function ArticleSection({
  id,
  title,
  intro,
  children,
}: {
  id: string;
  title: string;
  intro?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section aria-labelledby={id} className="flex flex-col gap-5">
      <div className="flex max-w-[68ch] flex-col gap-1.5">
        <h2 id={id} className="text-xl font-semibold tracking-tight text-balance">
          {title}
        </h2>
        {intro && <div className="text-muted-foreground">{intro}</div>}
      </div>
      {children}
    </section>
  );
}
