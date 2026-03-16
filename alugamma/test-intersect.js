function intersectLines(
    x1, y1, x2, y2,
    x3, y3, x4, y4
) {
    const det = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4);
    if (Math.abs(det) < 1e-6) return null;
    const t1 = x1 * y2 - y1 * x2;
    const t2 = x3 * y4 - y3 * x4;
    const x = (t1 * (x3 - x4) - (x1 - x2) * t2) / det;
    const y = (t1 * (y3 - y4) - (y1 - y2) * t2) / det;
    return { x, y };
}
console.log(intersectLines(0, 10, 10, 0, 5, 0, 10, 5));
