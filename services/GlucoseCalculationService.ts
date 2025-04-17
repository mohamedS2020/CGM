/**
 * Service for handling glucose calculations from ADC readings.
 * Implements the conversion from voltage to glucose levels.
 */
export default class GlucoseCalculationService {
  private static instance: GlucoseCalculationService;

  // Default calibration parameters
  private calibrationSlope = 1.0;
  private calibrationOffset = 0;
  private normalGlucoseLevel = 100; // mg/dL

  // ADC reference voltage and max value
  private readonly ADC_REF_VOLTAGE = 0.9; // Voltage (V)
  private readonly ADC_MAX_VALUE = 16383; // 14-bit ADC (2^14 - 1)

  // Glucose ranges for alerts (mg/dL)
  public readonly GLUCOSE_LOW = 70;
  public readonly GLUCOSE_HIGH = 180;
  public readonly GLUCOSE_NORMAL_LOW = 70;
  public readonly GLUCOSE_NORMAL_HIGH = 140;

  // Singleton pattern
  public static getInstance(): GlucoseCalculationService {
    if (!GlucoseCalculationService.instance) {
      GlucoseCalculationService.instance = new GlucoseCalculationService();
      console.log('[GlucoseCalculationService] Service instance created');
    }
    return GlucoseCalculationService.instance;
  }

  private constructor() {
    console.log('[GlucoseCalculationService] Service initialized with default calibration parameters');
  }

  /**
   * Convert ADC value to voltage.
   * @param adcValue - Raw ADC value (0-16383)
   * @returns Voltage in volts (0-0.9V). If input is invalid, returns 0.
   */
  public adcToVoltage(adcValue: number): number {
    console.log(`[GlucoseCalculationService] Converting ADC value ${adcValue} to voltage`);

    // Validate that adcValue is a finite number.
    if (!Number.isFinite(adcValue)) {
      console.warn('[GlucoseCalculationService] ADC value is not a finite number, using fallback value 0V');
      return 0;
    }

    // Validate ADC value range
    if (adcValue < 0 || adcValue > this.ADC_MAX_VALUE) {
      console.error(`[GlucoseCalculationService] ADC value out of range: ${adcValue}. Using fallback value 0V.`);
      return 0;
    }

    // Convert ADC value to voltage:
    // Voltage = (ADC_result / 16383) * 0.9
    const voltage = (adcValue / this.ADC_MAX_VALUE) * this.ADC_REF_VOLTAGE;

    // Ensure result is valid
    if (!Number.isFinite(voltage) || isNaN(voltage)) {
      console.error('[GlucoseCalculationService] Calculated voltage is not a valid number, using fallback value 0V.');
      return 0;
    }

    console.log(`[GlucoseCalculationService] Calculated voltage: ${voltage.toFixed(6)}V`);
    return voltage;
  }

  /**
   * Convert voltage to glucose level.
   * Uses calibration parameters that should be set based on the specific sensor.
   * 
   * @param voltage - Voltage from ADC (0-0.9V)
   * @returns Glucose level in mg/dL. If any error occurs during conversion, returns a safe fallback value.
   */
  public voltageToGlucose(voltage: number): number {
    console.log(`[GlucoseCalculationService] Converting voltage ${voltage.toFixed(6)}V to glucose level`);

    // Validate that voltage is a finite number.
    if (!Number.isFinite(voltage)) {
      console.warn('[GlucoseCalculationService] Voltage is not a finite number, using fallback glucose value 100 mg/dL');
      return 100;
    }

    // Validate voltage range
    if (voltage < 0 || voltage > this.ADC_REF_VOLTAGE) {
      console.error(`[GlucoseCalculationService] Voltage out of range: ${voltage}. Using fallback glucose value 100 mg/dL.`);
      return 100;
    }

    let glucose: number;
    try {
      // Normalized voltage (0-1 range)
      const normalizedVoltage = voltage / this.ADC_REF_VOLTAGE;

      // Convert to glucose using the formula:
      // Base calculation (maps 0-1 to 0-300 mg/dL range)
      glucose = normalizedVoltage * 300;

      // Apply sensor-specific calibration
      glucose = (glucose * this.calibrationSlope) + this.calibrationOffset;

      // If glucose falls below 0, clamp to 0.
      if (glucose < 0) {
        console.warn('[GlucoseCalculationService] Calculated negative glucose value, clamping to 0');
        glucose = 0;
      }

      // Check if the result is a valid number
      if (!Number.isFinite(glucose) || isNaN(glucose)) {
        console.warn('[GlucoseCalculationService] Invalid glucose calculation result, using fallback value 100 mg/dL');
        glucose = 100; // Fallback to a safe default value
      }
    } catch (error) {
      console.error('[GlucoseCalculationService] Error converting voltage to glucose, using fallback value 100 mg/dL:', error);
      return 100; // Safe fallback value in case of unexpected error
    }

    const roundedGlucose = Math.round(glucose);
    console.log(`[GlucoseCalculationService] Calculated glucose level: ${roundedGlucose} mg/dL`);
    return roundedGlucose;
  }

  /**
   * Convert ADC value directly to glucose.
   * Convenience method that combines adcToVoltage and voltageToGlucose.
   * 
   * @param adcValue - Raw ADC value (0-16383)
   * @returns Glucose level in mg/dL. If conversion fails, returns a fallback value.
   */
  public adcToGlucose(adcValue: number): number {
    console.log(`[GlucoseCalculationService] Converting ADC value ${adcValue} directly to glucose`);

    // Validate the adcValue is finite.
    if (!Number.isFinite(adcValue)) {
      console.warn('[GlucoseCalculationService] ADC value is not finite, using fallback glucose value 100 mg/dL');
      return 100;
    }

    try {
      const voltage = this.adcToVoltage(adcValue);
      return this.voltageToGlucose(voltage);
    } catch (error) {
      console.error('[GlucoseCalculationService] Error in ADC to glucose conversion, using fallback value 100 mg/dL:', error);
      return 100;
    }
  }

  /**
   * Set calibration parameters.
   * These should be determined during sensor calibration.
   * 
   * @param slope - Calibration slope
   * @param offset - Calibration offset
   */
  public setCalibration(slope: number, offset: number): void {
    console.log(`[GlucoseCalculationService] Setting calibration parameters - slope: ${slope}, offset: ${offset}`);

    if (!Number.isFinite(slope) || slope <= 0) {
      const errorMsg = 'Calibration slope must be a positive finite number';
      console.error(`[GlucoseCalculationService] ${errorMsg}`);
      return;
    }

    this.calibrationSlope = slope;
    this.calibrationOffset = offset;
    console.log('[GlucoseCalculationService] Calibration parameters updated successfully');
  }

  /**
   * Set normal glucose level for the user.
   * This is used for reference and can vary by individual.
   * 
   * @param level - Normal glucose level in mg/dL
   */
  public setNormalGlucoseLevel(level: number): void {
    console.log(`[GlucoseCalculationService] Setting normal glucose level to ${level} mg/dL`);

    if (!Number.isFinite(level) || level <= 0) {
      console.error('[GlucoseCalculationService] Normal glucose level must be a positive finite number');
      return;
    }

    this.normalGlucoseLevel = level;
  }

  /**
   * Get normal glucose level.
   * @returns Normal glucose level in mg/dL.
   */
  public getNormalGlucoseLevel(): number {
    return this.normalGlucoseLevel;
  }

  /**
   * Check if glucose level is in normal range.
   * @param glucoseLevel - Glucose level to check.
   * @returns True if in normal range, false otherwise.
   */
  public isGlucoseInNormalRange(glucoseLevel: number): boolean {
    const isInRange = glucoseLevel >= this.GLUCOSE_NORMAL_LOW &&
           glucoseLevel <= this.GLUCOSE_NORMAL_HIGH;
    console.log(`[GlucoseCalculationService] Checking if glucose ${glucoseLevel} mg/dL is in normal range (${this.GLUCOSE_NORMAL_LOW}-${this.GLUCOSE_NORMAL_HIGH}): ${isInRange}`);
    return isInRange;
  }

  /**
   * Check if glucose level is in alert range (too high or too low).
   * @param glucoseLevel - Glucose level to check.
   * @returns True if in alert range, false otherwise.
   */
  public isGlucoseInAlertRange(glucoseLevel: number): boolean {
    const isInAlertRange = glucoseLevel < this.GLUCOSE_LOW || glucoseLevel > this.GLUCOSE_HIGH;
    console.log(`[GlucoseCalculationService] Checking if glucose ${glucoseLevel} mg/dL is in alert range (<${this.GLUCOSE_LOW} or >${this.GLUCOSE_HIGH}): ${isInAlertRange}`);
    return isInAlertRange;
  }

  /**
   * Convert glucose from mg/dL to mmol/L.
   * @param mgdl - Glucose in mg/dL.
   * @returns Glucose in mmol/L.
   */
  public mgdlToMmol(mgdl: number): number {
    if (!Number.isFinite(mgdl)) {
      console.warn('[GlucoseCalculationService] mg/dL value is not finite, returning 0 mmol/L as fallback');
      return 0;
    }
    // Conversion factor: 1 mmol/L = 18 mg/dL
    const mmol = parseFloat((mgdl / 18).toFixed(1));
    console.log(`[GlucoseCalculationService] Converted ${mgdl} mg/dL to ${mmol} mmol/L`);
    return mmol;
  }

  /**
   * Convert glucose from mmol/L to mg/dL.
   * @param mmol - Glucose in mmol/L.
   * @returns Glucose in mg/dL.
   */
  public mmolToMgdl(mmol: number): number {
    if (!Number.isFinite(mmol)) {
      console.warn('[GlucoseCalculationService] mmol/L value is not finite, returning fallback value 100 mg/dL');
      return 100;
    }
    // Conversion factor: 1 mmol/L = 18 mg/dL
    const mgdl = Math.round(mmol * 18);
    console.log(`[GlucoseCalculationService] Converted ${mmol} mmol/L to ${mgdl} mg/dL`);
    return mgdl;
  }
}
