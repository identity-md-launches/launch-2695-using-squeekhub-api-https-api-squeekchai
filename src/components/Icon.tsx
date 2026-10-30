import type { CSSProperties } from "react";
const paths: Record<string, React.ReactNode> = {
  arrow: <path d="M5 12h14m-5-5 5 5-5 5" />,
  up: <path d="m6 14 6-6 6 6M12 8v11" />,
  down: <path d="m6 10 6 6 6-6M12 5v11" />,
  wallet: (
    <>
      <path d="M19 8V5H5a2 2 0 0 0 0 4h15v10H5a2 2 0 0 1-2-2V7" />
      <path d="M16 12h4v4h-4z" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </>
  ),
  trophy: (
    <>
      <path d="M8 3h8v7a4 4 0 0 1-8 0zM8 5H4v3a4 4 0 0 0 4 4m8-7h4v3a4 4 0 0 1-4 4m-4 2v6m-4 0h8" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v6m0-10v1" />
    </>
  ),
  check: <path d="m5 12 4 4L19 6" />,
  refresh: (
    <>
      <path d="M20 7v5h-5M4 17v-5h5" />
      <path d="M5 8a8 8 0 0 1 13-3l2 3M4 16l2 3a8 8 0 0 0 13-3" />
    </>
  ),
  external: (
    <>
      <path d="M14 4h6v6m0-6L10 14" />
      <path d="M10 4H4v16h16v-6" />
    </>
  ),
  close: <path d="m6 6 12 12M6 18 18 6" />,
  shield: (
    <>
      <path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6z" />
      <path d="m8 12 3 3 5-6" />
    </>
  ),
  activity: <path d="M2 12h5l3-8 4 16 3-8h5" />,
  chevron: <path d="m9 5 7 7-7 7" />,
};
export function Icon({
  name,
  size = 20,
  className,
  style,
}: {
  name: string;
  size?: number;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
      style={style}
    >
      {paths[name] || paths.info}
    </svg>
  );
}
