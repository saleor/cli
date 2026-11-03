// Durations as people read them in output.

// How long something has run: "42s", "3m 05s".
export const elapsed = (ms: number) => {
  const seconds = Math.round(ms / 1000);
  const minutes = Math.floor(seconds / 60);

  return minutes === 0
    ? `${seconds}s`
    : `${minutes}m ${String(seconds % 60).padStart(2, "0")}s`;
};

// How long ago something happened: "just now", "5 min ago", "3 days ago".
export const ago = (date: Date, now = Date.now()) => {
  const minutes = Math.round((now - date.getTime()) / 60_000);

  if (minutes < 1) {
    return "just now";
  }

  if (minutes < 60) {
    return `${minutes} min ago`;
  }

  const hours = Math.round(minutes / 60);

  return hours < 48 ? `${hours} h ago` : `${Math.round(hours / 24)} days ago`;
};
