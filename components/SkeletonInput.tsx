// Reusable loading skeleton sized to a form control.
//
// Stands in for an input with an IDENTICAL footprint (height var(--control-h),
// full width) so a real value landing causes zero reflow. The shimmer gradient
// and its reduced-motion hard-stop live in globals.css (`.nv-skeleton`); this
// component is just the sized, aria-hidden box. Pass `height` to reuse the same
// shimmer for non-field placeholders (e.g. rail rows).
export default function SkeletonInput({
  className = '',
  height = 'var(--control-h)',
  width = '100%',
  style,
}: {
  className?: string;
  height?: string;
  width?: string;
  style?: React.CSSProperties;
}) {
  return (
    <div
      aria-hidden
      className={`nv-skeleton ${className}`}
      style={{ height, width, ...style }}
    />
  );
}
