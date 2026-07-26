/** Physical constants (SI). */
export const F = 96485.33212; // Faraday constant, C/mol
export const R = 8.314462618; // gas constant, J/(mol·K)
export const EPS0 = 8.8541878128e-12; // vacuum permittivity, F/m

/** Thermal voltage RT/F in volts. */
export function thermalVoltage(T: number): number {
  return (R * T) / F;
}

/** Debye length λ_D = sqrt(ε R T / (2 F² c0)) for a 1:1 electrolyte, in metres.
 *  εr: relative permittivity; c0 in mol/m³. */
export function debyeLength(εr: number, T: number, c0: number): number {
  return Math.sqrt((εr * EPS0 * R * T) / (2 * F * F * c0));
}
