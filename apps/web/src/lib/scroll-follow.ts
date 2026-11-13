/** Layout and virtualization can move the viewport; only reader intent can resume following. */
export function shouldFollowLatest({
  following,
  initial,
  returning,
  restoring,
  gap,
  movingUp,
  resized,
}: {
  following: boolean;
  initial: boolean;
  returning: boolean;
  restoring: boolean;
  gap: number;
  movingUp: boolean;
  resized: boolean;
}) {
  if (restoring) return false;
  return (
    (initial && gap <= 100) ||
    (returning && gap <= 1 && !movingUp) ||
    (following && (gap <= 100 || resized))
  );
}
