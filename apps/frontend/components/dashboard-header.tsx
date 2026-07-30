"use client";

interface DashboardHeaderProps {
    title: string;
    description?: string;
}

// `description` was declared on the props type but never destructured or
// rendered — every one of the 16+ call sites across the app that pass it
// (page subtitles, admin page blurbs) silently lost that text.
export function DashboardHeader({ title, description }: DashboardHeaderProps) {
    return (
        <header className="flex flex-col gap-1.5 py-8">
            <h1 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
                {title}
            </h1>
            {description && (
                <p className="text-sm text-muted-foreground sm:text-base">
                    {description}
                </p>
            )}
        </header>
    );
}
