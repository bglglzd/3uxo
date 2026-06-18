import { useId } from "react";

interface Props {
  /** Размер квадрата в px. */
  size?: number;
  /**
   * Цвет знака:
   * - "brand" — фирменный градиент (по теме);
   * - "current" — currentColor (для приглушённых/моно-вариантов).
   */
  tone?: "brand" | "current";
  /** Сколько концентричных волн рисовать (1 для очень мелких размеров ≤24px). */
  waves?: 1 | 2;
  className?: string;
}

/**
 * Знак Auris — ушная раковина, ловящая входящий звук: дуга-чаша + концентричные
 * волны + точка-канал. Единственный фирменный вектор, рисуется кодом.
 * Градиент — через стопы с цветами темы (`--brand-a`/`--brand-b`), id уникален
 * на инстанс (useId), чтобы несколько знаков на странице не конфликтовали.
 */
export function AurisMark({
  size = 30,
  tone = "brand",
  waves = 2,
  className,
}: Props) {
  const gid = useId();
  const paint = tone === "brand" ? `url(#${gid})` : "currentColor";
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      className={className ? `auris-mark ${className}` : "auris-mark"}
      aria-hidden="true"
    >
      {tone === "brand" && (
        <defs>
          <linearGradient
            id={gid}
            x1="14"
            y1="14"
            x2="48"
            y2="50"
            gradientUnits="userSpaceOnUse"
          >
            <stop className="am-a" />
            <stop offset="1" className="am-b" />
          </linearGradient>
        </defs>
      )}
      <path
        d="M43 17.5 C29 11.5 14 21 14 33 C14 45 29 54.5 43 48.5"
        stroke={paint}
        strokeWidth="4.3"
        strokeLinecap="round"
      />
      <path
        d="M39.5 24 C46.5 28 46.5 38 39.5 42"
        stroke={paint}
        strokeWidth="3.7"
        strokeLinecap="round"
      />
      {waves === 2 && (
        <path
          d="M34.5 28.5 C39 31 39 35 34.5 37.5"
          stroke={paint}
          strokeWidth="3.7"
          strokeLinecap="round"
        />
      )}
      <circle cx="29" cy="33" r="2.2" fill={paint} />
    </svg>
  );
}
