import { usePathname } from "next/navigation";
import { useMemo } from "react";

export const useCurrentUrl = () => {
    const pathname = usePathname();
    return useMemo(() => pathname, [pathname]);

}