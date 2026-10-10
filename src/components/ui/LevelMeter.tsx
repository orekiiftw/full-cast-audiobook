interface LevelMeterProps {
  active?: boolean;
  bars?: 3 | 4 | 5;
  className?: string;
}

export function LevelMeter({ active = true, bars = 4, className = "h-3.5" }: LevelMeterProps) {
  return (
    <span aria-hidden="true" data-active={active} className={`level-meter ${className}`}>
      {Array.from({ length: bars }, (_, index) => (
        <span key={index} />
      ))}
    </span>
  );
}
