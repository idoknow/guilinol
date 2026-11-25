export const grades = Object.freeze(['legendary', 'high', 'medium', 'low'] as const);
export type Grade = typeof grades[number];

export const probabilities = Object.freeze({
  red: Object.freeze([0.03, 0.18, 0.36, 0.43]),
  blue: Object.freeze([0.00813, 0.10569, 0.37398, 0.51220]),
  green: Object.freeze([0.00505, 0.05768, 0.31002, 0.62725]),
});

export function drawGrade(zone: keyof typeof probabilities, random: () => number): Grade {
  let roll = random();
  for (const [index, probability] of probabilities[zone].entries()) {
    roll -= probability;
    if (roll < 0) return grades[index];
  }
  return 'low';
}

const priceRanges = { legendary: [1200, 2000], high: [400, 999], medium: [52, 200], low: [20, 120] } as const;

export function basePrice(grade: Grade, weightFraction: number): number {
  const [min, max] = priceRanges[grade];
  return Math.round(min + Math.max(0, Math.min(1, weightFraction)) * (max - min));
}
