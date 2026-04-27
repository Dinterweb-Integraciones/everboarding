import Image from "next/image";
import Link from "next/link";

type BrandLogoProps = {
  href: string;
  priority?: boolean;
};

export function BrandLogo({ href, priority = false }: BrandLogoProps) {
  return (
    <Link href={href} className="flex items-center">
      <Image
        src="/brand-hubspot-dinterweb.webp"
        alt="HubSpot y dinterweb"
        width={485}
        height={95}
        priority={priority}
        className="h-[4.5rem] w-auto object-contain sm:h-[5.5rem]"
      />
    </Link>
  );
}
