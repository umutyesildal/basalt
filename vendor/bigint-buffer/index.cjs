"use strict";
// All current Solana consumers use unsigned layouts of 8, 16, 24 or 32 bytes.
// No native addon, install script, truncation, signed interpretation or unbounded work.
const MAX_BYTES = 32;
function width(value) {
  if (!Number.isInteger(value) || value < 0 || value > MAX_BYTES) throw new RangeError("bigint codec width must be an integer from 0 to 32 bytes");
  return value;
}
function fromBytes(bytes, littleEndian) {
  if (!(bytes instanceof Uint8Array)) throw new TypeError("bigint codec input must be a Uint8Array");
  width(bytes.length);
  let result = 0n;
  for (let i = 0; i < bytes.length; i++) result = (result << 8n) | BigInt(bytes[littleEndian ? bytes.length - 1 - i : i]);
  return result;
}
function toBytes(value, length, littleEndian) {
  width(length);
  if (typeof value !== "bigint") throw new TypeError("bigint codec value must be a bigint");
  if (value < 0n || value >= (1n << BigInt(length * 8))) throw new RangeError("unsigned bigint does not fit the requested width");
  const result = Buffer.alloc(length);
  for (let i = 0; i < length; i++) { result[littleEndian ? i : length - 1 - i] = Number(value & 255n); value >>= 8n; }
  return result;
}
exports.toBigIntLE = bytes => fromBytes(bytes, true);
exports.toBigIntBE = bytes => fromBytes(bytes, false);
exports.toBufferLE = (value, length) => toBytes(value, length, true);
exports.toBufferBE = (value, length) => toBytes(value, length, false);
