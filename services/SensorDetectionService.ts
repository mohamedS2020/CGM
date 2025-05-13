import SensorNfcService from './SensorNfcService';
import FreeStyleLibreService from './FreeStyleLibreService';

/**
 * Enum for different sensor types
 */
export enum SensorType {
  RF430 = 'rf430',
  LIBRE = 'libre',
  UNKNOWN = 'unknown'
}

/**
 * Service for detecting and identifying different sensor types
 */
export default class SensorDetectionService {
  private static instance: SensorDetectionService;
  private sensorNfcService: SensorNfcService;
  private libreService: FreeStyleLibreService;
  
  /**
   * Get singleton instance
   */
  public static getInstance(): SensorDetectionService {
    if (!SensorDetectionService.instance) {
      SensorDetectionService.instance = new SensorDetectionService();
    }
    return SensorDetectionService.instance;
  }
  
  private constructor() {
    this.sensorNfcService = SensorNfcService.getInstance();
    this.libreService = FreeStyleLibreService.getInstance();
    console.log('[SensorDetectionService] Initialized');
  }
  
  /**
   * Detect sensor type by trying each known sensor protocol
   */
  public async detectSensorType(): Promise<SensorType> {
    try {
      console.log('[SensorDetectionService] Attempting to detect sensor type');
      
      // Try to detect FreeStyle Libre sensor first
      console.log('[SensorDetectionService] Checking for FreeStyle Libre sensor');
      const isLibreSensor = await this.libreService.detectLibreSensor();
      if (isLibreSensor) {
        console.log('[SensorDetectionService] Detected FreeStyle Libre sensor');
        return SensorType.LIBRE;
      }
      
      // Try to detect RF430 sensor
      console.log('[SensorDetectionService] Checking for RF430 sensor');
      const isRF430 = await this.sensorNfcService.detectSensor();
      if (isRF430) {
        console.log('[SensorDetectionService] Detected RF430 sensor');
        return SensorType.RF430;
      }
      
      console.log('[SensorDetectionService] No known sensor type detected');
      return SensorType.UNKNOWN;
    } catch (error) {
      console.error('[SensorDetectionService] Error detecting sensor type:', error);
      return SensorType.UNKNOWN;
    }
  }
} 