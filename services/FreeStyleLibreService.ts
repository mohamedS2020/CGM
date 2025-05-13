import NfcManager, { NfcTech, NfcEvents } from 'react-native-nfc-manager';
import { Platform } from 'react-native';
import NfcService from './NfcService';
import { GlucoseReading } from './MeasurementService';
import { ReadingSource } from './GlucoseMonitoringService';

export interface LibreSensorInfo {
  serialNumber: string;
  sensorType: string;
  remainingLifeMinutes: number;
  isActive: boolean;
}

/**
 * Service for handling communication with FreeStyle Libre sensors
 */
export default class FreeStyleLibreService {
  private static instance: FreeStyleLibreService;
  private nfcService: NfcService;
  
  // Memory block sizes and counts
  private static readonly BLOCK_SIZE = 8;
  private static readonly TREND_BLOCK = 0x28;
  private static readonly CALIBRATION_BLOCK_START = 0x2C;
  private static readonly CALIBRATION_BLOCK_END = 0x2E;
  
  // Command codes
  private static readonly READ_SINGLE_BLOCK = 0x20;
  
  /**
   * Get singleton instance
   */
  public static getInstance(): FreeStyleLibreService {
    if (!FreeStyleLibreService.instance) {
      FreeStyleLibreService.instance = new FreeStyleLibreService();
    }
    return FreeStyleLibreService.instance;
  }
  
  private constructor() {
    this.nfcService = NfcService.getInstance();
    console.log('[FreeStyleLibreService] Initialized');
  }
  
  /**
   * Detect if the scanned tag is a FreeStyle Libre sensor
   */
  public async detectLibreSensor(): Promise<boolean> {
    try {
      console.log('[FreeStyleLibreService] Attempting to detect FreeStyle Libre sensor');
      
      // Ensure NFC is not in use
      if (this.nfcService.isOperationInProgress()) {
        console.log('[FreeStyleLibreService] Another NFC operation is in progress');
        return false;
      }
      
      this.nfcService.setOperationInProgress(true);
      
      try {
        // Request NfcV technology
        await NfcManager.requestTechnology(NfcTech.NfcV);
        
        // Try to read the first block which should contain sensor info
        const command = [0x02, FreeStyleLibreService.READ_SINGLE_BLOCK, 0x00];
        const response = await this.sendLibreCommand(command);
        
        // Check if response matches expected Libre format
        if (response && response.length >= 8) {
          console.log('[FreeStyleLibreService] Successfully detected FreeStyle Libre sensor');
          return true;
        }
        
        console.log('[FreeStyleLibreService] Not a FreeStyle Libre sensor');
        return false;
      } finally {
        // Clean up NFC resources
        await NfcManager.cancelTechnologyRequest();
        this.nfcService.setOperationInProgress(false);
      }
    } catch (error) {
      console.error('[FreeStyleLibreService] Error detecting FreeStyle Libre sensor:', error);
      this.nfcService.setOperationInProgress(false);
      return false;
    }
  }
  
  /**
   * Read sensor information from FreeStyle Libre
   */
  public async readSensorInfo(): Promise<LibreSensorInfo | null> {
    try {
      console.log('[FreeStyleLibreService] Reading FreeStyle Libre sensor info');
      
      // Ensure NFC is not in use
      if (this.nfcService.isOperationInProgress()) {
        console.log('[FreeStyleLibreService] Another NFC operation is in progress');
        return null;
      }
      
      this.nfcService.setOperationInProgress(true);
      
      try {
        // Request NfcV technology
        await NfcManager.requestTechnology(NfcTech.NfcV);
        
        // Read blocks containing sensor information
        const headerData = await this.readMemoryBlocks(0, 3);
        
        // Parse serial number from blocks 0-3
        const serialNumber = this.extractSerialNumber(headerData);
        
        // Read sensor status block
        let remainingLifeMinutes = 0;
        try {
          const statusData = await this.readMemoryBlocks(0x03, 0x03);
          remainingLifeMinutes = this.extractRemainingLife(statusData);
        } catch (error) {
          console.warn('[FreeStyleLibreService] Error reading status block:', error);
          // Continue with default values
        }
        
        // Determine sensor type
        const sensorType = this.determineSensorType(headerData);
        
        const sensorInfo = {
          serialNumber,
          sensorType,
          remainingLifeMinutes,
          isActive: remainingLifeMinutes > 0
        };
        
        console.log('[FreeStyleLibreService] Sensor info:', sensorInfo);
        return sensorInfo;
      } finally {
        // Clean up NFC resources
        await NfcManager.cancelTechnologyRequest();
        this.nfcService.setOperationInProgress(false);
      }
    } catch (error) {
      console.error('[FreeStyleLibreService] Error reading sensor info:', error);
      this.nfcService.setOperationInProgress(false);
      return null;
    }
  }
  
  /**
   * Read glucose data from FreeStyle Libre sensor
   */
  public async readGlucoseData(): Promise<GlucoseReading> {
    try {
      console.log('[FreeStyleLibreService] Reading glucose data from FreeStyle Libre sensor');
      
      // Ensure NFC is not in use
      if (this.nfcService.isOperationInProgress()) {
        console.log('[FreeStyleLibreService] Another NFC operation is in progress');
        throw new Error('Another NFC operation is in progress');
      }
      
      this.nfcService.setOperationInProgress(true);
      
      try {
        // Request NfcV technology
        await NfcManager.requestTechnology(NfcTech.NfcV);
        
        // Read memory blocks 0x00 to 0x2F
        console.log('[FreeStyleLibreService] Reading memory blocks 0x00 to 0x2F');
        const memoryData = await this.readMemoryBlocks(0x00, 0x2F);
        
        // Extract trend data from block 0x28
        console.log('[FreeStyleLibreService] Extracting trend data from block 0x28');
        const trendBlock = memoryData.slice(
          FreeStyleLibreService.TREND_BLOCK * FreeStyleLibreService.BLOCK_SIZE, 
          (FreeStyleLibreService.TREND_BLOCK + 1) * FreeStyleLibreService.BLOCK_SIZE
        );
        const rawGlucose = this.extractRawGlucose(trendBlock);
        
        // Extract calibration data from blocks 0x2C-0x2E
        console.log('[FreeStyleLibreService] Extracting calibration data from blocks 0x2C-0x2E');
        const calibrationData = memoryData.slice(
          FreeStyleLibreService.CALIBRATION_BLOCK_START * FreeStyleLibreService.BLOCK_SIZE,
          (FreeStyleLibreService.CALIBRATION_BLOCK_END + 1) * FreeStyleLibreService.BLOCK_SIZE
        );
        const { slope, offset } = this.extractCalibrationParams(calibrationData);
        
        // Calculate glucose value using calibration formula
        console.log(`[FreeStyleLibreService] Calculating glucose: ${rawGlucose} * ${slope} + ${offset}`);
        const glucoseValue = (rawGlucose * slope) + offset;
        
        // Create glucose reading object
        const reading: GlucoseReading = {
          value: Math.round(glucoseValue),
          timestamp: new Date(),
          source: ReadingSource.LIBRE_SENSOR,
          isAlert: this.isGlucoseInAlertRange(glucoseValue)
        };
        
        console.log(`[FreeStyleLibreService] Final glucose value: ${reading.value} mg/dL`);
        return reading;
      } finally {
        // Clean up NFC resources
        await NfcManager.cancelTechnologyRequest();
        this.nfcService.setOperationInProgress(false);
      }
    } catch (error) {
      console.error('[FreeStyleLibreService] Error reading glucose data:', error);
      this.nfcService.setOperationInProgress(false);
      throw error;
    }
  }
  
  /**
   * Read historical data from FreeStyle Libre sensor
   */
  public async readHistoricalData(): Promise<GlucoseReading[]> {
    try {
      console.log('[FreeStyleLibreService] Reading historical data from FreeStyle Libre sensor');
      
      // Ensure NFC is not in use
      if (this.nfcService.isOperationInProgress()) {
        console.log('[FreeStyleLibreService] Another NFC operation is in progress');
        return [];
      }
      
      this.nfcService.setOperationInProgress(true);
      
      try {
        // Request NfcV technology
        await NfcManager.requestTechnology(NfcTech.NfcV);
        
        // Read memory blocks containing historical data
        const memoryData = await this.readMemoryBlocks(0x00, 0x2F);
        
        // Extract calibration data for glucose calculation
        const calibrationData = memoryData.slice(
          FreeStyleLibreService.CALIBRATION_BLOCK_START * FreeStyleLibreService.BLOCK_SIZE,
          (FreeStyleLibreService.CALIBRATION_BLOCK_END + 1) * FreeStyleLibreService.BLOCK_SIZE
        );
        const { slope, offset } = this.extractCalibrationParams(calibrationData);
        
        // Extract historical data (blocks vary depending on sensor version)
        // This is a simplified implementation
        const historyBlocks = memoryData.slice(0x16 * FreeStyleLibreService.BLOCK_SIZE);
        const readings: GlucoseReading[] = [];
        
        // Parse historical entries
        const now = new Date();
        for (let i = 0; i < 32; i++) {
          const blockOffset = i * 6; // Each history entry is 6 bytes
          if (blockOffset + 6 <= historyBlocks.length) {
            const entryData = historyBlocks.slice(blockOffset, blockOffset + 6);
            const rawValue = this.extractHistoricalGlucose(entryData);
            
            if (rawValue > 0) {
              const glucoseValue = (rawValue * slope) + offset;
              const timestamp = new Date(now.getTime() - (i * 15 * 60 * 1000)); // 15 min intervals
              
              readings.push({
                value: Math.round(glucoseValue),
                timestamp,
                source: ReadingSource.LIBRE_SENSOR,
                isAlert: this.isGlucoseInAlertRange(glucoseValue)
              });
            }
          }
        }
        
        console.log(`[FreeStyleLibreService] Retrieved ${readings.length} historical readings`);
        return readings;
      } finally {
        // Clean up NFC resources
        await NfcManager.cancelTechnologyRequest();
        this.nfcService.setOperationInProgress(false);
      }
    } catch (error) {
      console.error('[FreeStyleLibreService] Error reading historical data:', error);
      this.nfcService.setOperationInProgress(false);
      return [];
    }
  }
  
  /**
   * Read multiple memory blocks from the sensor
   */
  private async readMemoryBlocks(startBlock: number, endBlock: number): Promise<Uint8Array> {
    const blockCount = endBlock - startBlock + 1;
    const resultData = new Uint8Array(blockCount * FreeStyleLibreService.BLOCK_SIZE);
    
    for (let block = startBlock; block <= endBlock; block++) {
      try {
        const command = [0x02, FreeStyleLibreService.READ_SINGLE_BLOCK, block];
        const response = await this.sendLibreCommand(command);
        
        // Make sure response is valid and has expected length
        if (response && response.length === FreeStyleLibreService.BLOCK_SIZE) {
          // Calculate offset in the result array
          const offset = (block - startBlock) * FreeStyleLibreService.BLOCK_SIZE;
          
          // Check if the offset is valid
          if (offset >= 0 && offset + FreeStyleLibreService.BLOCK_SIZE <= resultData.length) {
            // Copy response data to our memory array
            resultData.set(response, offset);
          } else {
            console.warn(`[FreeStyleLibreService] Invalid offset ${offset} for block ${block}, skipping`);
            // Fill with zeros for invalid offset
            const zeroBlock = new Uint8Array(FreeStyleLibreService.BLOCK_SIZE);
            resultData.set(zeroBlock, (block - startBlock) * FreeStyleLibreService.BLOCK_SIZE);
          }
        } else {
          console.warn(`[FreeStyleLibreService] Invalid response length for block ${block}: ${response ? response.length : 'null'}`);
          // Fill with zeros for invalid response
          const zeroBlock = new Uint8Array(FreeStyleLibreService.BLOCK_SIZE);
          resultData.set(zeroBlock, (block - startBlock) * FreeStyleLibreService.BLOCK_SIZE);
        }
      } catch (error) {
        console.error(`[FreeStyleLibreService] Error reading block ${block.toString(16)}:`, error);
        
        // For critical blocks, throw the error to abort the entire read
        if (block === FreeStyleLibreService.TREND_BLOCK || 
            (block >= FreeStyleLibreService.CALIBRATION_BLOCK_START && 
             block <= FreeStyleLibreService.CALIBRATION_BLOCK_END)) {
          throw new Error(`Failed to read critical block ${block.toString(16)}`);
        }
        
        // For non-critical blocks, fill with zeros and continue
        const zeroBlock = new Uint8Array(FreeStyleLibreService.BLOCK_SIZE);
        resultData.set(zeroBlock, (block - startBlock) * FreeStyleLibreService.BLOCK_SIZE);
      }
    }
    
    return resultData;
  }
  
  /**
   * Send a command to the FreeStyle Libre sensor
   */
  private async sendLibreCommand(command: number[]): Promise<Uint8Array> {
    const tag = await NfcManager.getTag();
    if (!tag) {
      throw new Error('No NFC tag found');
    }
    
    try {
      // Send command
      const response = await NfcManager.transceive(command);
      
      // Ensure response is valid
      if (!response || !Array.isArray(response)) {
        console.warn('[FreeStyleLibreService] Invalid response from transceive:', response);
        return new Uint8Array(FreeStyleLibreService.BLOCK_SIZE); // Return zeros
      }
      
      // Create a fixed-size buffer
      const resultBuffer = new Uint8Array(FreeStyleLibreService.BLOCK_SIZE);
      
      // Copy only what fits in our buffer
      const bytesToCopy = Math.min(response.length, FreeStyleLibreService.BLOCK_SIZE);
      for (let i = 0; i < bytesToCopy; i++) {
        resultBuffer[i] = response[i];
      }
      
      return resultBuffer;
    } catch (error) {
      console.error('[FreeStyleLibreService] Error in sendLibreCommand:', error);
      throw error;
    }
  }
  
  /**
   * Extract raw glucose value from trend data block
   */
  private extractRawGlucose(trendBlock: Uint8Array): number {
    // Implementation to extract the raw glucose value from block 0x28
    // This is based on the FreeStyle Libre format
    const rawValue = (trendBlock[0] | (trendBlock[1] << 8)) & 0x3FFF;
    return rawValue;
  }
  
  /**
   * Extract historical glucose value
   */
  private extractHistoricalGlucose(historyData: Uint8Array): number {
    // Implementation to extract historical glucose value
    const rawValue = (historyData[0] | (historyData[1] << 8)) & 0x3FFF;
    return rawValue;
  }
  
  /**
   * Extract calibration parameters from calibration blocks
   */
  private extractCalibrationParams(calibrationData: Uint8Array): { slope: number, offset: number } {
    // Extract calibration parameters from blocks 0x2C-0x2E
    // Based on reverse-engineered FreeStyle Libre sensor format
    
    try {
      // Extract raw calibration values
      const i1 = ((calibrationData[3] & 0x0F) << 8) | calibrationData[2];
      const i2 = ((calibrationData[3] & 0xF0) << 4) | calibrationData[4];
      const i3 = ((calibrationData[5] & 0x0F) << 8) | calibrationData[6];
      const i4 = ((calibrationData[5] & 0xF0) << 4) | calibrationData[7];
      
      // Calculate sensor-specific parameters
      const sensorParameters = {
        i1: i1,
        i2: i2,
        i3: i3,
        i4: i4
      };
      
      // Calculate slope and offset using calibration formula
      // These values are approximated based on common Libre sensor behavior
      const slope = 0.1 + (sensorParameters.i1 * 0.0001);
      const offset = -0.5 + (sensorParameters.i2 * 0.01);
      
      console.log(`[FreeStyleLibreService] Calculated calibration: slope=${slope}, offset=${offset}`);
      return { slope, offset };
    } catch (error) {
      console.warn('[FreeStyleLibreService] Error extracting calibration, using defaults:', error);
      // Fallback to default values if extraction fails
      return { slope: 0.1, offset: 0 };
    }
  }
  
  /**
   * Extract serial number from sensor data
   */
  private extractSerialNumber(headerData: Uint8Array): string {
    // Implementation to extract serial number
    let serialNumber = '';
    for (let i = 0; i < 8; i++) {
      serialNumber += headerData[i].toString(16).padStart(2, '0');
    }
    return serialNumber;
  }
  
  /**
   * Extract remaining sensor life in minutes
   * FreeStyle Libre sensors store remaining life in minutes in bytes 4-5 of the status block
   */
  private extractRemainingLife(statusData: Uint8Array): number {
    // Extract remaining life from status data block
    // Bytes 4-5 contain the remaining life in minutes as a little-endian 16-bit value
    const remainingLifeMinutes = statusData[4] | (statusData[5] << 8);
    
    // Validate the value - Libre sensors typically last 14 days (20160 minutes)
    // If the value is unreasonable, return a default
    if (remainingLifeMinutes > 30000) {
      console.warn('[FreeStyleLibreService] Unrealistic remaining life value:', remainingLifeMinutes);
      return 20160; // Default to 14 days
    }
    
    console.log(`[FreeStyleLibreService] Sensor remaining life: ${remainingLifeMinutes} minutes (${(remainingLifeMinutes / 60 / 24).toFixed(1)} days)`);
    return remainingLifeMinutes;
  }
  
  /**
   * Determine sensor type from header data
   * Different FreeStyle Libre sensor models have distinct header signatures
   */
  private determineSensorType(headerData: Uint8Array): string {
    // Check the first byte which identifies the sensor type
    const sensorByte = headerData[0];
    
    // Identify sensor model based on known signatures
    switch (sensorByte) {
      case 0xDF:
        return 'Libre 1';
      case 0xA2:
        return 'Libre 2';
      case 0xE5:
        return 'Libre Pro/H';
      case 0x9D:
        return 'Libre US 14 day';
      case 0xC5:
        return 'Libre 3';
      default:
        // Check additional bytes for further identification
        if (headerData[1] === 0x00 && headerData[2] === 0x00) {
          return 'Libre Sense';
        }
        console.warn('[FreeStyleLibreService] Unknown sensor type:', sensorByte.toString(16));
        return 'Unknown';
    }
  }
  
  /**
   * Check if glucose level is in alert range
   */
  private isGlucoseInAlertRange(glucoseValue: number): boolean {
    // Use standard thresholds for alerts
    const GLUCOSE_LOW = 70;
    const GLUCOSE_HIGH = 180;
    
    return glucoseValue < GLUCOSE_LOW || glucoseValue > GLUCOSE_HIGH;
  }
} 