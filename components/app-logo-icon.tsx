import type { SVGAttributes } from 'react';

export default function AppLogoIcon(props: SVGAttributes<SVGElement>) {
    return (
        <svg {...props} viewBox="0 0 40 42" xmlns="http://www.w3.org/2000/svg">
            <image href="/sinchan2.jpg" width="100%" height="100%" preserveAspectRatio="none" />
        </svg>
    );
}
