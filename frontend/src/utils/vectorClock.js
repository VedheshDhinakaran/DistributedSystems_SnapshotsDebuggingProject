/**
 * VectorClock utility for frontend — mirrors the backend logic
 */
const VectorClockJS = {
  happensBefore(a, b) {
    if (!a || !b) return false;
    const allKeys = new Set([...Object.keys(a), ...Object.keys(b)]);
    let strictlyLess = false;
    for (const key of allKeys) {
      const av = a[key] || 0;
      const bv = b[key] || 0;
      if (av > bv) return false;
      if (av < bv) strictlyLess = true;
    }
    return strictlyLess;
  },
  concurrent(a, b) {
    return !VectorClockJS.happensBefore(a, b) && !VectorClockJS.happensBefore(b, a);
  },
};

export default VectorClockJS;
