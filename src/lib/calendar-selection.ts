export const clampCalendarSelectionEnd = (startIndex: number, requestedEndIndex: number, isBlocked: (index: number) => boolean) => {
  const direction = requestedEndIndex >= startIndex ? 1 : -1;
  let endIndex = startIndex;
  for (let candidate = startIndex + direction; direction > 0 ? candidate <= requestedEndIndex : candidate >= requestedEndIndex; candidate += direction) {
    if (isBlocked(candidate)) break;
    endIndex = candidate;
  }
  return endIndex;
};

export const datesForCalendarSelection = (days: Date[], startIndex: number, endIndex: number) => {
  const first = days[Math.min(startIndex, endIndex)];
  const last = days[Math.max(startIndex, endIndex)];
  if (!first || !last) return undefined;
  const departure = new Date(last.getFullYear(), last.getMonth(), last.getDate() + 1);
  const dateValue = (value: Date) => `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
  return { arrival: dateValue(first), departure: dateValue(departure) };
};
