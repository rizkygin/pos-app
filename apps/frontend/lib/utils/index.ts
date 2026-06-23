import { clsx, type ClassValue } from "clsx";
import { cx } from "./cx";

/**
 * Combines multiple class names using clsx and merges Tailwind classes using a custom twMerge.
 * This is the standard utility function used by shadcn components.
 */
export function cn(...inputs: ClassValue[]) {
    return cx(clsx(inputs));
}
