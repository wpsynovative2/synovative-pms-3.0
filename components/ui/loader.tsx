/*
 * The one loading animation in the app. The shape lives in globals.css as
 * `.pms-loader` (the dot figure is Uiverse.io's, by bociKond — see
 * Loading.txt). Three ways in:
 *
 *   <Loader />          the dots on their own, at any size
 *   <LoadingScreen />   centred in the space it is given, with a line of text
 *   <ButtonLoader />    small enough to sit inside a button's label
 *
 * It paints in `currentColor`, so it takes the colour of whatever holds it -
 * brand on a boot screen, the label colour inside a button.
 */

/** Local, so nothing here has to reach into the client-only primitives file. */
const join = (...parts: (string | false | null | undefined)[]) =>
  parts.filter(Boolean).join(" ");

/**
 * `size` is the dot ring's own box. The animation swings the dots out by a
 * quarter of that on every side, so the span reserves 1.5x the room and the
 * loader can never be clipped by the layout around it.
 */
export function Loader({
  size = 44.8,
  className,
  label = "Loading",
}: {
  size?: number;
  className?: string;
  /** Read out to screen readers; the animation itself is decorative. */
  label?: string;
}) {
  const box = size * 1.5;
  return (
    <span
      role="status"
      aria-label={label}
      className={join("inline-flex shrink-0 items-center justify-center", className)}
      style={{ width: box, height: box }}
    >
      <span
        aria-hidden
        className="pms-loader"
        style={{ "--loader-size": `${size}px` } as React.CSSProperties}
      />
    </span>
  );
}

/** What a screen shows while it has nothing to show yet. */
export function LoadingScreen({
  label,
  size = 44.8,
  className,
}: {
  label?: string;
  size?: number;
  className?: string;
}) {
  return (
    <div
      className={join(
        "flex min-h-60 flex-1 flex-col items-center justify-center gap-3 text-brand-ink",
        className,
      )}
    >
      <Loader size={size} label={label ?? "Loading"} />
      {label ? <p className="text-xs text-ink-faint">{label}</p> : null}
    </div>
  );
}

/** Sized and spaced to replace an icon inside a button's label. */
export function ButtonLoader({ className }: { className?: string }) {
  return <Loader size={11} className={join("-my-2 -ml-1", className)} label="Working" />;
}
