export function isSameDay(d1: Date, d2: Date) {
  return d1.getFullYear() === d2.getFullYear() && d1.getMonth() === d2.getMonth() && d1.getDate() === d2.getDate();
}

export function formatDateGroup(timestamp: number) {
  const date = new Date(timestamp);
  const today = new Date();

  if (isSameDay(date, today)) return "Today";

  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  if (isSameDay(date, yesterday)) return "Yesterday";

  return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long' }).format(date);
}
