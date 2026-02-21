export function useHaptic() {
  const isSupported = typeof navigator !== "undefined" && "vibrate" in navigator;

  const tap = () => {
    if (isSupported) navigator.vibrate(10);
  };

  const success = () => {
    if (isSupported) navigator.vibrate([10, 50, 10]);
  };

  const error = () => {
    if (isSupported) navigator.vibrate([50, 30, 50, 30, 50]);
  };

  const swipeComplete = () => {
    if (isSupported) navigator.vibrate(15);
  };

  return { tap, success, error, swipeComplete, isSupported };
}
