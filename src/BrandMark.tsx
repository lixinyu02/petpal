import './brand-mark.css';
/** The product mark shares its paths and colors with public/favicon.svg. */
export default function BrandMark({ size = 32, className }: { size?: number; className?: string }) {
  return <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width={size} height={size} className={`petpal-brand-icon${className ? ` ${className}` : ''}`} aria-hidden="true" focusable="false">
    <rect width="64" height="64" rx="20" fill="#235e4d"/>
    <path d="M14 38V16l14 10h8l14-10v22c0 19-36 19-36 0" fill="#e9d4b5"/>
    <path d="M24 35v4m16-4v4" stroke="#2c4135" strokeWidth="4" strokeLinecap="round"/>
    <path d="m29 44 3 3 3-3" fill="none" stroke="#2c4135" strokeWidth="2"/>
  </svg>;
}
