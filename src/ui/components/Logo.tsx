export function Logo({ size = 34 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 500 500" aria-hidden="true">
      <polygon points="120,440 210,440 250,330 200,240 140,240" fill="#0b1726" />
      <polygon points="140,240 200,240 240,160 170,140" fill="#0284c7" />
      <polygon points="200,240 250,330 280,260 240,160" fill="#00e5ff" />
      <polygon points="170,140 240,160 210,80" fill="#38bdf8" />
      <polygon points="120,440 150,330 210,440" fill="#0369a1" />
      <path d="M 250,330 L 290,440 L 380,440 C 370,300 375,180 340,80 C 330,140 310,210 280,260 Z" fill="#151b24" />
      <path d="M 340,80 C 330,150 315,220 280,260 C 315,260 350,310 330,390 C 350,330 365,220 340,80 Z" fill="#ff1744" />
      <polygon points="290,440 380,440 340,350" fill="#991b1b" />
      <polygon points="245,330 255,330 250,320" fill="#000" />
    </svg>
  );
}
