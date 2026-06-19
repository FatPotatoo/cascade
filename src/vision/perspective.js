/**
 * Perspective transform (PRD FR-6, §14).
 *
 * The player marks four corners of the wall play area on the camera feed
 * (corner-pin). We build a homography that maps points from *normalized camera
 * space* (the quad the player drew, in [0,1] coords) into *game space*
 * (a clean width×height rectangle). Detected note centroids are then mapped
 * point-by-point — we never warp the whole image, which keeps us in budget.
 *
 * Pure JS so it has no per-frame OpenCV Mat churn: compute the 3×3 matrix once
 * when corners change, then apply it to each detected point.
 */

/**
 * Solve an 8×8 linear system A·x = b by Gaussian elimination with partial
 * pivoting. Returns the solution vector (length 8).
 */
function solve8(A, b) {
  const n = 8;
  // Augmented matrix.
  const M = A.map((row, i) => [...row, b[i]]);

  for (let col = 0; col < n; col++) {
    // Partial pivot.
    let piv = col;
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(M[r][col]) > Math.abs(M[piv][col])) piv = r;
    }
    if (piv !== col) [M[col], M[piv]] = [M[piv], M[col]];

    const d = M[col][col];
    if (Math.abs(d) < 1e-12) continue; // near-singular; leave as-is
    for (let c = col; c <= n; c++) M[col][c] /= d;

    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = M[r][col];
      if (f === 0) continue;
      for (let c = col; c <= n; c++) M[r][c] -= f * M[col][c];
    }
  }
  return M.map((row) => row[n]);
}

/**
 * Compute the homography mapping 4 source points → 4 destination points.
 * @param {Array<[number,number]>} src four [x,y] points (camera/normalized)
 * @param {Array<[number,number]>} dst four [x,y] points (game space)
 * @returns {number[]} 9-element row-major 3×3 matrix [a,b,c,d,e,f,g,h,1]
 */
export function computeHomography(src, dst) {
  const A = [];
  const b = [];
  for (let i = 0; i < 4; i++) {
    const [sx, sy] = src[i];
    const [dx, dy] = dst[i];
    A.push([sx, sy, 1, 0, 0, 0, -sx * dx, -sy * dx]);
    b.push(dx);
    A.push([0, 0, 0, sx, sy, 1, -sx * dy, -sy * dy]);
    b.push(dy);
  }
  const h = solve8(A, b);
  return [h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7], 1];
}

/** Apply a 3×3 homography to a point. @returns {[number,number]} */
export function applyHomography(H, x, y) {
  const w = H[6] * x + H[7] * y + H[8];
  return [
    (H[0] * x + H[1] * y + H[2]) / w,
    (H[3] * x + H[4] * y + H[5]) / w,
  ];
}

/**
 * Build the camera-quad → game-rect transform for a session.
 *
 * @param {Array<[number,number]>} corners four normalized [0,1] points in
 *        order TL, TR, BR, BL (as captured by the corner-pin step). If null,
 *        falls back to the identity quad (whole frame → whole play area).
 * @param {number} width  game width
 * @param {number} height game height
 */
export function makePlayAreaTransform(corners, width, height) {
  const src = corners || [
    [0, 0],
    [1, 0],
    [1, 1],
    [0, 1],
  ];
  const dst = [
    [0, 0],
    [width, 0],
    [width, height],
    [0, height],
  ];
  const H = computeHomography(src, dst);
  return {
    /** map a normalized [0,1] camera point into game space */
    map: (nx, ny) => applyHomography(H, nx, ny),
    H,
  };
}
