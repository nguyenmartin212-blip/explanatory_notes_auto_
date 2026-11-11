/** MongoDB duplicate key error (E11000). */
export function isDuplicateKey(err) {
  return Boolean(err) && (err.code === 11000 || err.code === 11001);
}
