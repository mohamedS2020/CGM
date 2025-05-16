import NfcManager, { NfcTech, NfcEvents } from 'react-native-nfc-manager';
import { Platform } from 'react-native';
import NfcService from './NfcService';
import { GlucoseReading } from './MeasurementService';
import { ReadingSource } from './ReadingTypes';

// Extend the GlucoseReading interface to include our source type
declare module './MeasurementService' {
  export interface GlucoseReading {
    source?: ReadingSource;
  }
}

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
      console.log('[FreeStyleLibreService] Please position sensor against phone and hold steady...');
      
      // Ensure NFC system is properly reset before starting
      try {
        console.log('[FreeStyleLibreService] Resetting NFC system before reading...');
        await this.nfcService.resetNfcSystem();
        await new Promise(resolve => setTimeout(resolve, 500)); // Wait 500ms for NFC system to stabilize
      } catch (resetError) {
        console.warn('[FreeStyleLibreService] Error resetting NFC system:', resetError);
        // Continue anyway
      }
      
      // Ensure NFC is not in use
      if (this.nfcService.isOperationInProgress()) {
        console.log('[FreeStyleLibreService] Another NFC operation is in progress');
        throw new Error('Another NFC operation is in progress');
      }
      
      // Mark operation as in progress with a longer timeout (60 seconds instead of 30)
      this.nfcService.setOperationInProgress(true, 60000);
      
      // Add a short delay to give UI time to update and user time to position sensor
      await new Promise(resolve => setTimeout(resolve, 800));
      
      let memoryData: Uint8Array | null = null;
      let retryCount = 0;
      const maxRetries = 2;
      
      // Try reading the memory blocks with retries
      while (memoryData === null && retryCount <= maxRetries) {
        try {
          // Request NfcV technology
          console.log('[FreeStyleLibreService] Requesting NfcV technology...');
          console.log('[FreeStyleLibreService] Scanning for sensor - please hold phone steady against sensor...');
          await NfcManager.requestTechnology(NfcTech.NfcV);
          
          // Read memory blocks 0x00 to 0x2F
          console.log('[FreeStyleLibreService] Reading memory blocks 0x00 to 0x2F');
          memoryData = await this.readMemoryBlocks(0x00, 0x2F);
        } catch (error) {
          console.error(`[FreeStyleLibreService] Error reading glucose data (attempt ${retryCount + 1}/${maxRetries + 1}):`, error);
          
          // Clean up NFC resources before retry
          try {
            console.log('[FreeStyleLibreService] Cleaning up NFC resources...');
            await NfcManager.cancelTechnologyRequest().catch(() => {/* ignore errors */});
          } catch (cleanupError) {
            console.error('[FreeStyleLibreService] Error cleaning up NFC resources:', cleanupError);
          }
          
          // Reset NFC system if this isn't the last retry
          if (retryCount < maxRetries) {
            console.log('[FreeStyleLibreService] Resetting NFC system after error...');
            await this.nfcService.resetNfcSystem();
            await new Promise(resolve => setTimeout(resolve, 1000)); // longer wait between retries
            retryCount++;
          } else {
            // If we've exhausted all retries, rethrow the error
            throw error;
          }
        }
      }
      
      // If we still don't have memory data after all retries, throw an error
      if (!memoryData) {
        throw new Error('Failed to read sensor data after multiple attempts');
      }
      
      try {
        // Log the raw bytes from key memory blocks
        console.log('[FreeStyleLibreService] Raw data from block 0x27:', this.bytesToHex(memoryData.slice(0x27 * 8, 0x28 * 8)));
        console.log('[FreeStyleLibreService] Raw data from block 0x28:', this.bytesToHex(memoryData.slice(0x28 * 8, 0x29 * 8)));
        console.log('[FreeStyleLibreService] Raw data from block 0x29:', this.bytesToHex(memoryData.slice(0x29 * 8, 0x2A * 8)));
        
        // Extract trend data from block 0x28
        console.log('[FreeStyleLibreService] Extracting trend data from block 0x28');
        const trendBlock = memoryData.slice(
          FreeStyleLibreService.TREND_BLOCK * FreeStyleLibreService.BLOCK_SIZE, 
          (FreeStyleLibreService.TREND_BLOCK + 1) * FreeStyleLibreService.BLOCK_SIZE
        );
        
        // Log the specific bytes used for current glucose calculation
        console.log('[FreeStyleLibreService] Current glucose bytes:', this.bytesToHex(trendBlock.slice(0, 2)));
        
        // Extract raw glucose value
        const rawGlucose = this.extractRawGlucose(trendBlock);
        console.log('[FreeStyleLibreService] Raw uncalibrated glucose value:', rawGlucose);
        
        // Read calibration data from blocks
        console.log('[FreeStyleLibreService] Extracting calibration data');
        const calibrationData = memoryData.slice(
          FreeStyleLibreService.CALIBRATION_BLOCK_START * FreeStyleLibreService.BLOCK_SIZE,
          (FreeStyleLibreService.CALIBRATION_BLOCK_END + 1) * FreeStyleLibreService.BLOCK_SIZE
        );
        
        // Log raw calibration data
        console.log('[FreeStyleLibreService] Raw calibration data:', this.bytesToHex(calibrationData));
        
        // Extract calibration parameters
        const { slope, offset } = this.extractCalibrationParams(calibrationData);
        console.log('[FreeStyleLibreService] Calibration parameters:', JSON.stringify({ slope, offset }));
        
        // Log intermediate calculation steps
        const slopeAdjustment = rawGlucose * slope;
        console.log('[FreeStyleLibreService] After applying slope:', slopeAdjustment);
        
        const offsetAdjustment = slopeAdjustment + offset;
        console.log('[FreeStyleLibreService] After applying offset:', offsetAdjustment);
        
        // Apply calibration and round to nearest integer
        const calibratedGlucose = Math.max(0, Math.round(offsetAdjustment));
        console.log('[FreeStyleLibreService] Final calibrated glucose value:', calibratedGlucose);
        
        // Check if value is extremely high and potentially should be capped
        if (calibratedGlucose > 500) {
          console.log('[FreeStyleLibreService] WARNING: Value exceeds 500 mg/dL (official app limit)');
          console.log('[FreeStyleLibreService] FreeStyle app would likely display this as 500+ mg/dL');
          // Uncomment to implement capping
          // const cappedValue = 500;
          // console.log('[FreeStyleLibreService] Value capped to 500 mg/dL');
        }
        
        // Formulate the reading
        const reading: GlucoseReading = {
          timestamp: new Date(),
          value: calibratedGlucose,
          isAlert: this.isGlucoseInAlertRange(calibratedGlucose), // Set alert if needed
          source: ReadingSource.LIBRE_SENSOR,
          _isSensorReading: true
        };
        
        console.log('[FreeStyleLibreService] Successfully read glucose value:', reading.value);
        return reading;
      } finally {
        // Ensure NFC resources are cleaned up
        try {
          console.log('[FreeStyleLibreService] Cleaning up NFC resources...');
          await NfcManager.cancelTechnologyRequest().catch(() => {/* ignore errors */});
        } catch (cleanupError) {
          console.error('[FreeStyleLibreService] Error cleaning up NFC resources:', cleanupError);
        }
        
        // Reset operation state
        this.nfcService.setOperationInProgress(false);
      }
    } catch (error) {
      // If an error happened, try to clean up and reset
      try {
        console.log('[FreeStyleLibreService] Cleaning up NFC resources...');
        await NfcManager.cancelTechnologyRequest().catch(() => {/* ignore errors */});
      } catch (cleanupError) {
        // Ignore cleanup errors
      }
      
      console.error('[FreeStyleLibreService] Error reading glucose data:', error);
      
      // Reset NFC system in case of error
      try {
        console.log('[FreeStyleLibreService] Resetting NFC system after error...');
        await this.nfcService.resetNfcSystem();
      } catch (resetError) {
        // Ignore reset errors
      }
      
      // Reset operation state
      this.nfcService.setOperationInProgress(false);
      
      // Rethrow the error for the caller to handle
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
        console.log('[FreeStyleLibreService] Reading memory blocks for historical data');
        const memoryData = await this.readMemoryBlocks(0x00, 0x2F);
        
        // Log raw data from key memory blocks
        console.log('[FreeStyleLibreService] Raw historical block data (first few blocks):');
        for (let i = 0x16; i < 0x1A; i++) {
          console.log(`[FreeStyleLibreService] Block 0x${i.toString(16).padStart(2, '0')}:`, 
            this.bytesToHex(memoryData.slice(i * FreeStyleLibreService.BLOCK_SIZE, (i+1) * FreeStyleLibreService.BLOCK_SIZE)));
        }
        
        // Extract calibration data for glucose calculation
        console.log('[FreeStyleLibreService] Extracting calibration data for historical readings');
        const calibrationData = memoryData.slice(
          FreeStyleLibreService.CALIBRATION_BLOCK_START * FreeStyleLibreService.BLOCK_SIZE,
          (FreeStyleLibreService.CALIBRATION_BLOCK_END + 1) * FreeStyleLibreService.BLOCK_SIZE
        );
        console.log('[FreeStyleLibreService] Calibration block data:', this.bytesToHex(calibrationData));
        
        const { slope, offset } = this.extractCalibrationParams(calibrationData);
        console.log('[FreeStyleLibreService] Extracted calibration parameters:', { slope, offset });
        
        // Extract historical data (blocks vary depending on sensor version)
        // This is a simplified implementation
        console.log('[FreeStyleLibreService] Processing historical data blocks');
        const historyBlocks = memoryData.slice(0x16 * FreeStyleLibreService.BLOCK_SIZE);
        const readings: GlucoseReading[] = [];
        
        // Parse historical entries
        const now = new Date();
        console.log('[FreeStyleLibreService] Parsing historical entries (up to 32 entries)');
        for (let i = 0; i < 32; i++) {
          const blockOffset = i * 6; // Each history entry is 6 bytes
          if (blockOffset + 6 <= historyBlocks.length) {
            // Extract timestamp - 15 minute intervals, with index 0 being the most recent
            const timestamp = new Date(now.getTime() - (i * 15 * 60 * 1000));
            console.log(`[FreeStyleLibreService] Historical entry ${i} timestamp:`, timestamp);
            
            // Extract history data segment
            const historySegment = historyBlocks.slice(blockOffset, blockOffset + 6);
            console.log(`[FreeStyleLibreService] Historical entry ${i} raw data:`, this.bytesToHex(historySegment));
            
            // Extract raw glucose value
            const rawGlucose = this.extractHistoricalGlucose(historySegment);
            console.log(`[FreeStyleLibreService] Historical entry ${i} raw glucose:`, rawGlucose);
            
            // Calculate actual glucose value
            if (rawGlucose > 0) { // Skip invalid readings (often 0)
              const glucoseValue = (rawGlucose * slope) + offset;
              console.log(`[FreeStyleLibreService] Historical entry ${i} calculated glucose (raw*slope+offset):`, 
                `${rawGlucose} * ${slope} + ${offset} = ${glucoseValue}`);
              
              const roundedValue = Math.round(glucoseValue);
              console.log(`[FreeStyleLibreService] Historical entry ${i} rounded glucose:`, roundedValue);
              
              readings.push({
                value: roundedValue,
                timestamp,
                source: ReadingSource.LIBRE_SENSOR,
                isAlert: this.isGlucoseInAlertRange(glucoseValue)
              });
            } else {
              console.log(`[FreeStyleLibreService] Historical entry ${i} skipped (invalid raw value:`, rawGlucose, ')');
            }
          }
        }
        
        console.log(`[FreeStyleLibreService] Extracted ${readings.length} historical readings`);
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
    
    let failedBlocks = 0;
    const maxRetries = 3;
    const maxGlobalRetries = 2; // Retry the entire reading process twice if needed
    let globalRetryCount = 0;
    
    while (globalRetryCount <= maxGlobalRetries) {
      try {
        // If this is a retry, reset the NFC system and re-request the technology
        if (globalRetryCount > 0) {
          console.log(`[FreeStyleLibreService] Global retry ${globalRetryCount}/${maxGlobalRetries} - resetting NFC system`);
          
          // Make sure existing resources are properly released
          try {
            await NfcManager.cancelTechnologyRequest().catch(() => {/* ignore errors */});
          } catch (cancelError) {
            console.log('[FreeStyleLibreService] Error cancelling technology request:', cancelError);
            // Continue anyway
          }
          
          // Give the system time to recover
          await new Promise(resolve => setTimeout(resolve, 1000));
          
          // Reset the NFC system
          await this.nfcService.resetNfcSystem();
          await new Promise(resolve => setTimeout(resolve, 1000)); // Wait longer between retries
          
          // Re-request the technology
          try {
            console.log('[FreeStyleLibreService] Re-requesting NfcV technology...');
            await NfcManager.requestTechnology(NfcTech.NfcV);
            console.log('[FreeStyleLibreService] Successfully re-requested NfcV technology');
            
            // Additional wait after successful technology request
            await new Promise(resolve => setTimeout(resolve, 500));
          } catch (techError) {
            console.error('[FreeStyleLibreService] Error re-requesting NfcV technology:', techError);
            // Try once more after a longer delay
            await new Promise(resolve => setTimeout(resolve, 1500));
            try {
              await NfcManager.requestTechnology(NfcTech.NfcV);
              console.log('[FreeStyleLibreService] Successfully re-requested NfcV technology on second attempt');
            } catch (secondTechError) {
              console.error('[FreeStyleLibreService] Failed to re-request NfcV technology on second attempt:', secondTechError);
              // If we can't get the technology after two attempts, move to the next global retry
              globalRetryCount++;
              continue;
            }
          }
        }
        
        // Reset failed blocks counter for each global retry
        failedBlocks = 0;
        
        // Read each block
        for (let block = startBlock; block <= endBlock; block++) {
          let blockData: Uint8Array | null = null;
          let retryCount = 0;
          
          // Try reading this block up to maxRetries times
          while (retryCount < maxRetries && blockData === null) {
            try {
              // Add small delay between reads to give the NFC controller time to recover
              if (retryCount > 0) {
                await new Promise(resolve => setTimeout(resolve, 300 + retryCount * 100));
              }
              
              const command = [0x02, FreeStyleLibreService.READ_SINGLE_BLOCK, block];
              const response = await this.sendLibreCommand(command);
              
              // Make sure response is valid and has expected length
              if (response && response.length === FreeStyleLibreService.BLOCK_SIZE) {
                blockData = response;
              } else {
                console.warn(`[FreeStyleLibreService] Invalid response length for block ${block.toString(16)}: ${response ? response.length : 'null'}`);
                retryCount++;
                
                // Small delay before retry
                if (retryCount < maxRetries) {
                  await new Promise(resolve => setTimeout(resolve, 200 * retryCount));
                }
              }
            } catch (error) {
              console.error(`[FreeStyleLibreService] Error reading block ${block.toString(16)} (attempt ${retryCount+1}/${maxRetries}):`, error);
              
              // For specific NFC errors, try to recover
              if (error instanceof Error) {
                if (error.message.includes('no tech request available') || 
                    error.message.includes('no reference available')) {
                  // Try to re-request the technology
                  try {
                    await NfcManager.cancelTechnologyRequest().catch(() => {/* ignore errors */});
                    await new Promise(resolve => setTimeout(resolve, 500));
                    await NfcManager.requestTechnology(NfcTech.NfcV);
                    console.log(`[FreeStyleLibreService] Successfully re-requested technology after error reading block ${block}`);
                  } catch (reRequestError) {
                    console.error(`[FreeStyleLibreService] Failed to re-request technology:`, reRequestError);
                  }
                }
              }
              
              retryCount++;
              
              // Longer delay before retry for communication errors
              if (retryCount < maxRetries) {
                await new Promise(resolve => setTimeout(resolve, 300 * retryCount));
              }
            }
          }
          
          // Calculate offset in the result array
          const offset = (block - startBlock) * FreeStyleLibreService.BLOCK_SIZE;
          
          // Store block data in result, or increment failed blocks count
          if (blockData !== null) {
            // Copy blockData to resultData at the appropriate offset
            for (let i = 0; i < FreeStyleLibreService.BLOCK_SIZE; i++) {
              resultData[offset + i] = blockData[i];
            }
          } else {
            // If we couldn't read this block after all retries, mark it as failed
            failedBlocks++;
            
            // Fill with zeros to maintain array structure
            for (let i = 0; i < FreeStyleLibreService.BLOCK_SIZE; i++) {
              resultData[offset + i] = 0;
            }
            
            console.warn(`[FreeStyleLibreService] Failed to read block ${block.toString(16)} after ${maxRetries} attempts`);
          }
        }
        
        // If we've read all blocks with acceptable level of errors, return the data
        // Allow a small percentage of blocks to fail (e.g., 10%)
        const failurePercentage = (failedBlocks / blockCount) * 100;
        if (failurePercentage <= 10) {
          console.log(`[FreeStyleLibreService] Successfully read ${blockCount - failedBlocks}/${blockCount} blocks (${failurePercentage.toFixed(1)}% failure rate)`);
          return resultData;
        }
        
        // If too many blocks failed, try again with a global retry
        console.warn(`[FreeStyleLibreService] Too many blocks failed (${failedBlocks}/${blockCount} = ${failurePercentage.toFixed(1)}%), attempting global retry`);
        globalRetryCount++;
        
      } catch (error) {
        console.error(`[FreeStyleLibreService] Error during memory block reading (global retry ${globalRetryCount}/${maxGlobalRetries}):`, error);
        globalRetryCount++;
        
        // Make sure to release the NFC technology before trying again
        try {
          await NfcManager.cancelTechnologyRequest().catch(e => {/* ignore */});
        } catch (cleanupError) {
          // Ignore cleanup errors
        }
      }
    }
    
    // If we've exhausted all global retries and still failed
    console.error(`[FreeStyleLibreService] Failed to read memory blocks after ${maxGlobalRetries+1} attempts`);
    throw new Error('Failed to read sensor data after multiple attempts');
  }
  
  /**
   * Send a command to the FreeStyle Libre sensor
   */
  private async sendLibreCommand(command: number[]): Promise<Uint8Array> {
    // Try to get the NFC tag with multiple attempts
    let tag = null;
    let tagAttempts = 0;
    const maxTagAttempts = 3;
    
    // Check if NFC technology is properly requested before trying to get tag
    try {
      // Verify NFC technology is available before proceeding
      const techAvailable = await this.verifyNfcTechAvailable();
      if (!techAvailable) {
        // Try to reset NFC and request technology again
        console.log('[FreeStyleLibreService] NFC tech not available, requesting NfcV technology...');
        try {
          // Make sure any existing tech request is cancelled
          await NfcManager.cancelTechnologyRequest().catch(() => {/* ignore errors */});
          await new Promise(resolve => setTimeout(resolve, 500));
          await NfcManager.requestTechnology(NfcTech.NfcV);
          console.log('[FreeStyleLibreService] Successfully requested NfcV technology');
        } catch (techError) {
          console.error('[FreeStyleLibreService] Failed to request NfcV technology:', techError);
          throw new Error('Failed to establish NFC communication - please try again');
        }
      }
    } catch (verifyError) {
      console.warn('[FreeStyleLibreService] Error verifying NFC tech availability:', verifyError);
      // Continue and try anyway
    }
    
    while (!tag && tagAttempts < maxTagAttempts) {
      try {
        tag = await NfcManager.getTag();
        if (!tag) {
          tagAttempts++;
          
          // Log the attempt
          if (tagAttempts < maxTagAttempts) {
            console.log(`[FreeStyleLibreService] No tag detected, waiting longer (attempt ${tagAttempts}/${maxTagAttempts})...`);
            // Wait with increasing duration
            await new Promise(resolve => setTimeout(resolve, 800 + tagAttempts * 400));
          } else {
            console.error('[FreeStyleLibreService] Maximum tag detection attempts reached');
          }
        }
      } catch (tagError) {
        console.error('[FreeStyleLibreService] Error getting NFC tag:', tagError);
        
        // Handle specific error types
        const errorMessage = tagError instanceof Error ? tagError.message : String(tagError);
        
        if (errorMessage.includes('no tech request available')) {
          console.log('[FreeStyleLibreService] No tech request available, trying to re-request technology...');
          // Try to request technology again
          try {
            await NfcManager.cancelTechnologyRequest().catch(() => {/* ignore errors */});
            await new Promise(resolve => setTimeout(resolve, 500));
            await NfcManager.requestTechnology(NfcTech.NfcV);
            console.log('[FreeStyleLibreService] Successfully re-requested NfcV technology after error');
            // Don't increment attempts for this specific error
            continue;
          } catch (reRequestError) {
            console.error('[FreeStyleLibreService] Failed to re-request NfcV technology:', reRequestError);
          }
        } else if (errorMessage.includes('no reference available')) {
          console.log('[FreeStyleLibreService] No NFC reference available, tag may have been lost');
          // For this error, wait a bit longer as it often means the tag was present but lost
          await new Promise(resolve => setTimeout(resolve, 1000 + tagAttempts * 500));
        }
        
        tagAttempts++;
        // Wait with increasing duration
        if (tagAttempts < maxTagAttempts) {
          await new Promise(resolve => setTimeout(resolve, 800 + tagAttempts * 400));
        }
      }
    }
    
    // If no tag was found after all attempts
    if (!tag) {
      console.error('[FreeStyleLibreService] No NFC tag found after multiple attempts');
      throw new Error('No NFC tag found - please ensure the sensor is properly positioned on your phone');
    }
    
    try {
      // Add timeout protection with a longer timeout (8 seconds)
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('TAG_COMMUNICATION_TIMEOUT')), 8000);
      });
      
      console.log(`[FreeStyleLibreService] Sending command to block ${command[2]}`);
      
      // Send command with timeout protection
      const responsePromise = NfcManager.transceive(command);
      const response = await Promise.race([responsePromise, timeoutPromise]) as number[];
      
      // Ensure response is valid
      if (!response || !Array.isArray(response)) {
        console.warn(`[FreeStyleLibreService] Invalid response from transceive for block ${command[2]}:`, response);
        throw new Error(`Invalid NFC response format for block ${command[2]}`);
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
      console.error(`[FreeStyleLibreService] Error in sendLibreCommand for block ${command[2]}:`, error);
      
      // Convert timeout errors to a standardized form
      if (error instanceof Error && error.message === 'TAG_COMMUNICATION_TIMEOUT') {
        throw new Error(`COMMUNICATION_ERROR: Tag communication timed out for block ${command[2]}`);
      }
      
      // Try to verify if the tag is still connected
      try {
        const tagStillPresent = await NfcManager.getTag();
        if (!tagStillPresent) {
          throw new Error(`NFC tag connection lost while reading block ${command[2]} - please keep the sensor steady`);
        }
      } catch (tagCheckError) {
        // Ignore errors in tag check
      }
      
      throw error;
    }
  }
  
  /**
   * Verify if NFC technology is currently available/requested
   * This helps catch "no tech request available" errors before they happen
   */
  private async verifyNfcTechAvailable(): Promise<boolean> {
    try {
      // Try a lightweight operation that requires tech request to be active
      // getTag() is a good choice as it doesn't actually communicate with the tag
      const tagCheck = await NfcManager.getTag();
      return true; // If we get here without error, tech is available
    } catch (error) {
      if (error instanceof Error && 
          (error.message.includes('no tech request available') || 
           error.message.includes('no reference available'))) {
        return false; // Tech not available
      }
      // For other errors, we're not sure, so assume it might be available
      return true;
    }
  }
  
  /**
   * Extract raw glucose value from trend data block
   */
  private extractRawGlucose(trendBlock: Uint8Array): number {
    // Log detailed extraction process
    console.log('[FreeStyleLibreService] Raw trend block bytes:', this.bytesToHex(trendBlock));
    
    // The current glucose bytes are the first two bytes of the trend block
    const byte0 = trendBlock[0];
    const byte1 = trendBlock[1];
    
    console.log('[FreeStyleLibreService] Current glucose byte0 (LSB):', byte0.toString(16).padStart(2, '0'));
    console.log('[FreeStyleLibreService] Current glucose byte1 (MSB):', byte1.toString(16).padStart(2, '0'));
    
    // Combine the bytes to form a 16-bit value
    const combined = byte0 | (byte1 << 8);
    console.log('[FreeStyleLibreService] Combined 16-bit value:', combined.toString(16).padStart(4, '0'));
    
    // Apply bitmask 0x3FFF (14 bits) to get the raw glucose value
    const rawValue = combined & 0x3FFF;
    console.log('[FreeStyleLibreService] After applying bitmask 0x3FFF:', rawValue);
    
    return rawValue;
  }
  
  /**
   * Extract historical glucose value
   */
  private extractHistoricalGlucose(historyData: Uint8Array): number {
    // Log detailed extraction process
    console.log('[FreeStyleLibreService] Raw history data bytes:', this.bytesToHex(historyData));
    
    // The historical glucose bytes are the first two bytes of the history data
    const byte0 = historyData[0];
    const byte1 = historyData[1];
    
    console.log('[FreeStyleLibreService] Historical glucose byte0 (LSB):', byte0.toString(16).padStart(2, '0'));
    console.log('[FreeStyleLibreService] Historical glucose byte1 (MSB):', byte1.toString(16).padStart(2, '0'));
    
    // Combine the bytes to form a 16-bit value
    const combined = byte0 | (byte1 << 8);
    console.log('[FreeStyleLibreService] Combined 16-bit value:', combined.toString(16).padStart(4, '0'));
    
    // Apply bitmask 0x3FFF (14 bits) to get the raw glucose value
    const rawValue = combined & 0x3FFF;
    console.log('[FreeStyleLibreService] After applying bitmask 0x3FFF:', rawValue);
    
    return rawValue;
  }
  
  /**
   * Extract calibration parameters from calibration blocks
   */
  private extractCalibrationParams(calibrationData: Uint8Array): { slope: number, offset: number } {
    // Extract calibration parameters from blocks 0x2C-0x2E
    // Based on reverse-engineered FreeStyle Libre sensor format
    
    try {
      // Log raw calibration block data
      console.log('[FreeStyleLibreService] Calibration block bytes:', this.bytesToHex(calibrationData));
      
      // Extract raw calibration values
      const i1 = ((calibrationData[3] & 0x0F) << 8) | calibrationData[2];
      const i2 = ((calibrationData[3] & 0xF0) << 4) | calibrationData[4];
      const i3 = ((calibrationData[5] & 0x0F) << 8) | calibrationData[6];
      const i4 = ((calibrationData[5] & 0xF0) << 4) | calibrationData[7];
      
      // Log raw extracted parameters
      console.log('[FreeStyleLibreService] Raw calibration parameters:', { i1, i2, i3, i4 });
      console.log('[FreeStyleLibreService] i1 bytes:', 
          this.bytesToHex(new Uint8Array([calibrationData[2], calibrationData[3] & 0x0F])));
      console.log('[FreeStyleLibreService] i2 bytes:', 
          this.bytesToHex(new Uint8Array([calibrationData[4], (calibrationData[3] & 0xF0) >> 4])));
      
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
      console.log('[FreeStyleLibreService] Calculated slope:', slope, '(0.1 + i1*0.0001)');
      
      const offset = -0.5 + (sensorParameters.i2 * 0.01);
      console.log('[FreeStyleLibreService] Calculated offset:', offset, '(-0.5 + i2*0.01)');
      
      console.log(`[FreeStyleLibreService] Final calibration: slope=${slope}, offset=${offset}`);
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
  
  /**
   * Helper function to convert byte arrays to hex strings for logging
   */
  private bytesToHex(bytes: Uint8Array): string {
    return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join(' ');
  }
} 