// Can this browser draw 3D (WebGL)? Kept in its own tiny file so asking doesn't download the
// big 3D library.
export function webglAvailable() {
  try {
    const canvas = document.createElement("canvas");
    return !!(canvas.getContext("webgl2") || canvas.getContext("webgl"));
  } catch {
    return false;
  }
}
