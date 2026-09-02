/**
 * Team-based binary pair matching display helpers.
 * Mirrors backend `mlmBinaryPairIncomeService` — every pair needs a
 * 2:1 (or 1:2) volume ratio, no 1:1 exception after the first.
 */

export function teamLegWeakerSide(binary = {}) {
  const left = Number(binary.leftLegTeamActiveCount) || 0;
  const right = Number(binary.rightLegTeamActiveCount) || 0;
  if (left < right) return "left";
  if (right < left) return "right";
  return "either";
}

export function isTeamLegWeaker(binary, side) {
  const weaker = teamLegWeakerSide(binary);
  if (weaker === "either") return false;
  return weaker === side;
}

/**
 * Customer-facing hint for the binary network panel.
 */
export function buildBinaryPairHint(binary, formatINR) {
  const left = Number(binary?.leftLegTeamActiveCount) || 0;
  const right = Number(binary?.rightLegTeamActiveCount) || 0;
  const nextAmount =
    binary?.nextPairBonusAmount > 0 ? formatINR(binary.nextPairBonusAmount) : "—";
  const pairsRemaining = Number(binary?.pairsRemaining) || 0;
  const dailyCap = Number(binary?.dailyPairCap) || 0;
  const capNote = dailyCap > 0 ? ` Up to ${dailyCap} pairs paid per day.` : "";

  if (pairsRemaining > 0) {
    return (
      `${pairsRemaining} team pair${pairsRemaining === 1 ? "" : "s"} ready at ${nextAmount} each. ` +
      `Active Plan A volume: ${left} left · ${right} right.${capNote}`
    );
  }

  const weaker = teamLegWeakerSide(binary);
  const growLeg =
    weaker === "either"
      ? "either binary leg"
      : `${weaker} binary leg`;

  return (
    `Grow active Plan A members on your ${growLeg}. ` +
    `Next team match pays ${nextAmount}. Every pair needs 2:1 or 1:2 volume.${capNote}`
  );
}
