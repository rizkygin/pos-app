export default function Loading() {
  return (
    <div className="flex h-full min-h-[60vh] w-full flex-col items-center justify-center gap-6">
      <div className="relative flex items-center justify-center">
        <div className="absolute h-20 w-20 animate-ping rounded-full bg-blue-500/10" />
        <div className="h-14 w-14 animate-spin rounded-full border-4 border-gray-200 dark:border-gray-800" />
        <div className="absolute h-14 w-14 animate-spin rounded-full border-4 border-transparent border-t-blue-600" />
      </div>
      <p className="animate-pulse text-sm font-medium text-gray-500 dark:text-gray-400">
        Loading dashboard...
      </p>
    </div>
  );
}
