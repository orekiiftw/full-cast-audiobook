import type { SVGProps } from "react";
import { ICONS, type IconName } from "./iconPaths";

interface IconProps extends SVGProps<SVGSVGElement> {
  name: IconName;
  size?: number;
}

export function Icon({ name, size = 20, className = "", ...rest }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={`inline-block shrink-0 ${className}`}
      aria-hidden="true"
      {...rest}
    >
      {ICONS[name]}
    </svg>
  );
}
