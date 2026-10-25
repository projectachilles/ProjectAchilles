// Brand marks for the EDR integrations. Transparent, trimmed 128px renders of
// the supplied artwork (src/assets/integrations), sized by the caller like the
// lucide icons they sit next to (e.g. `h-4 w-4`). Decorative: the adjacent
// label names the vendor, so alt is empty.

import crowdstrikePng from '@/assets/integrations/crowdstrike.png';
import crowdstrikeWebp from '@/assets/integrations/crowdstrike.webp';
import sentinelonePng from '@/assets/integrations/sentinelone.png';
import sentineloneWebp from '@/assets/integrations/sentinelone.webp';
import { cn } from '@/lib/utils';

interface LogoProps {
  className?: string;
}

function Logo({ png, webp, className, testId }: LogoProps & { png: string; webp: string; testId: string }) {
  return (
    <picture className="contents">
      <source srcSet={webp} type="image/webp" />
      <img
        src={png}
        alt=""
        aria-hidden="true"
        draggable={false}
        data-testid={testId}
        className={cn('inline-block shrink-0 object-contain', className)}
      />
    </picture>
  );
}

export function CrowdStrikeLogo({ className }: LogoProps) {
  return <Logo png={crowdstrikePng} webp={crowdstrikeWebp} className={className} testId="crowdstrike-logo" />;
}

export function SentinelOneLogo({ className }: LogoProps) {
  return <Logo png={sentinelonePng} webp={sentineloneWebp} className={className} testId="sentinelone-logo" />;
}
