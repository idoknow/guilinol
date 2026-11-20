// Undamped LSQR for the road spline's CSR constraints. Scalar binary64
// operations in a fixed order avoid native BLAS reductions and fused products.
import {readFileSync, writeFileSync} from 'node:fs';

const input = readFileSync(0);
const rows = input.readUInt32LE(0), cols = input.readUInt32LE(4);
let cursor = 8;
function read(Type, length) {
  const bytes = length * Type.BYTES_PER_ELEMENT;
  const array = new Type(input.buffer.slice(input.byteOffset + cursor, input.byteOffset + cursor + bytes));
  cursor += bytes;
  return array;
}
const offsets = read(Uint32Array, rows + 1);
const indices = read(Uint32Array, offsets[rows]);
const values = read(Float64Array, offsets[rows]);
const u = read(Float64Array, rows);
const x = read(Float64Array, cols);
let v = new Float64Array(cols);
let next = new Float64Array(cols);

function normalize(vector) {
  let sum = 0;
  for (const value of vector) sum += value * value;
  const norm = Math.sqrt(sum);
  if (norm) {
    const scale = 1 / norm;
    for (let i = 0; i < vector.length; i++) vector[i] *= scale;
  }
  return norm;
}
function forward(row, vector) {
  let total = 0;
  for (let j = offsets[row]; j < offsets[row + 1]; j++) total += values[j] * vector[indices[j]];
  return total;
}
function transpose(out) {
  out.fill(0);
  for (let r = 0; r < rows; r++) {
    for (let j = offsets[r]; j < offsets[r + 1]; j++) out[indices[j]] += values[j] * u[r];
  }
}

for (let r = 0; r < rows; r++) u[r] -= forward(r, x);
let phiBar = normalize(u);
transpose(v);
let alpha = normalize(v);
const w = v.slice();
let rhoBar = alpha;
const initialNorm = phiBar;
let matrixNorm = 0;
for (let i = 0; i < 2200 && alpha && phiBar; i++) {
  for (let r = 0; r < rows; r++) u[r] = forward(r, v) - alpha * u[r];
  const beta = normalize(u);
  matrixNorm = Math.sqrt(matrixNorm * matrixNorm + alpha * alpha + beta * beta);
  transpose(next);
  for (let c = 0; c < cols; c++) next[c] -= beta * v[c];
  [next, v] = [v, next];
  alpha = normalize(v);
  const rho = Math.sqrt(rhoBar * rhoBar + beta * beta);
  const cos = rhoBar / rho, sin = beta / rho;
  const phi = cos * phiBar;
  const step = phi / rho, turn = -sin * alpha / rho;
  rhoBar = -cos * alpha;
  phiBar *= sin;
  for (let c = 0; c < cols; c++) {
    x[c] += step * w[c];
    w[c] = v[c] + turn * w[c];
  }
  if (Math.abs(phiBar) <= 1e-7 * initialNorm ||
      alpha * Math.abs(sin * phi) <= 1e-7 * matrixNorm * Math.abs(phiBar)) break;
}
writeFileSync(1, Buffer.from(x.buffer));
