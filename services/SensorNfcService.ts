import NfcManager, { NfcTech, Ndef, NfcEvents, TagEvent } from 'react-native-nfc-manager';
import { Platform, Alert, Linking } from 'react-native';
import NfcService from './NfcService';

// Add interface for sensor info
export interface ISensorInfo {
  uid: string;
  serialNumber?: string;
  sensorType?: string;
  manufacturerData?: any;
  isActive: boolean;
}

interface NfcCommandResult {
  success: boolean;
  data?: Uint8Array;
  error?: string;
}

export enum NfcErrorType {
  NOT_SUPPORTED = 'NFC_NOT_SUPPORTED',
  NOT_ENABLED = 'NFC_NOT_ENABLED',
  TAG_NOT_FOUND = 'TAG_NOT_FOUND',
  COMMUNICATION_ERROR = 'COMMUNICATION_ERROR',
  TIMEOUT = 'TIMEOUT',
  INVALID_RESPONSE = 'INVALID_RESPONSE',
  CANCELLED = 'CANCELLED',
  UNEXPECTED_ERROR = 'UNEXPECTED_ERROR',
  EXPO_GO = 'EXPO_GO'
}

/**
 * Service for handling NFC communication with the RF430FRL15xH sensor
 * Based on ISO/IEC 15693 (13.56 MHz) standard
 */
export default class SensorNfcService {
  private static instance: SensorNfcService;
  
  // Track NFC status
  private isNfcSupported: boolean = false;
  private highDataRateFlag = 0x02; // ISO/IEC 15693 flag for high data rate
  
  // Add initialization state tracking
  private initializationPromise: Promise<boolean> | null = null;
  private initialized: boolean = false;
  
  // Reference to the core NFC service
  private nfcService: NfcService;
  
  // Command codes for ISO/IEC 15693
  private static readonly CMD_READ_SINGLE_BLOCK = 0x20;
  private static readonly CMD_WRITE_SINGLE_BLOCK = 0x21;

  // Block addresses for RF430FRL15xH
  private static readonly BLOCK_CONFIG = 0x02; // ADC configuration block
  private static readonly BLOCK_CONTROL = 0x00; // Start sampling block
  private static readonly BLOCK_RESULT = 0x09; // ADC results block

  /**
   * Get singleton instance
   */
  public static getInstance(): SensorNfcService {
    if (!SensorNfcService.instance) {
      SensorNfcService.instance = new SensorNfcService();
    }
    return SensorNfcService.instance;
  }

  /**
   * Check if NFC is available on the device - static method for direct access
   * @returns true if NFC is available, false otherwise
   */
  public static async isNfcAvailable(): Promise<boolean> {
    try {
      // Check for Expo Go first
      const nfcService = NfcService.getInstance();
      if (nfcService.isRunningInExpoGo()) {
        console.log('[SensorNfcService] Running in Expo Go - NFC not available');
        return false;
      }
      
      // Check if NfcManager is defined globally
      if (typeof NfcManager === 'undefined' || NfcManager === null) {
        console.warn('[SensorNfcService] NFC Manager is not available (undefined or null)');
        return false;
      }

      // Safely check if isSupported method exists
      if (typeof NfcManager.isSupported !== 'function') {
        console.warn('[SensorNfcService] NfcManager.isSupported is not a function');
        return false;
      }

      // For Android, we need to check if NFC is actually enabled
      if (Platform.OS === 'android') {
        try {
          // Check if NFC is supported first
          const isSupported = await NfcManager.isSupported();
          if (!isSupported) {
            console.log('[SensorNfcService] NFC is not supported on this device');
            return false;
          }
          
          // On Android, we also need to check if NFC is enabled in settings
          if (typeof NfcManager.isEnabled === 'function') {
            const isEnabled = await NfcManager.isEnabled();
            console.log(`[SensorNfcService] NFC is ${isEnabled ? 'enabled' : 'disabled'} on this Android device`);
            return isEnabled;
          } else {
            // Fallback if isEnabled is not available
            console.warn('[SensorNfcService] NfcManager.isEnabled is not available, using isSupported only');
            return isSupported;
          }
        } catch (error) {
          console.error('[SensorNfcService] Error checking NFC availability on Android:', error);
          return false;
        }
      }

      // For iOS and other platforms
      try {
        const isSupported = await NfcManager.isSupported();
        return !!isSupported; // Convert to boolean
      } catch (error) {
        console.error('[SensorNfcService] Error calling NfcManager.isSupported:', error);
        return false;
      }
    } catch (error) {
      console.error('[SensorNfcService] Error checking NFC availability:', error);
      return false;
    }
  }

  /**
   * Open NFC settings on the device - static method for direct access
   */
  public static async openNfcSettings(): Promise<void> {
    try {
      // Check for Expo Go first
      const nfcService = NfcService.getInstance();
      if (nfcService.isRunningInExpoGo()) {
        console.log('[SensorNfcService] Running in Expo Go - cannot open NFC settings');
        Alert.alert(
          'Expo Go Limitation', 
          'NFC features are not available in Expo Go. Please build a development build to use NFC.'
        );
        return;
      }
      
      // Check if NfcManager is defined globally
      if (typeof NfcManager === 'undefined' || NfcManager === null) {
        console.warn('[SensorNfcService] NFC Manager is not available (undefined or null)');
        return;
      }

      // Safely check if goToNfcSetting method exists
      if (typeof NfcManager.goToNfcSetting !== 'function') {
        console.warn('[SensorNfcService] NfcManager.goToNfcSetting is not a function');
        // Fallback to system settings on Android
        if (Platform.OS === 'android') {
          try {
            await Linking.sendIntent('android.settings.NFC_SETTINGS');
          } catch (linkingError) {
            console.error('[SensorNfcService] Error opening system NFC settings:', linkingError);
          }
        }
        return;
      }

      // Safely call the method with try/catch
      try {
        await NfcManager.goToNfcSetting();
      } catch (nfcError) {
        console.error('[SensorNfcService] Error calling NfcManager.goToNfcSetting:', nfcError);
        // Fallback to system settings on Android
        if (Platform.OS === 'android') {
          try {
            await Linking.sendIntent('android.settings.NFC_SETTINGS');
          } catch (linkingError) {
            console.error('[SensorNfcService] Error opening system NFC settings:', linkingError);
          }
        }
      }
    } catch (error) {
      console.error('[SensorNfcService] Error opening NFC settings:', error);
    }
  }

  private constructor() {
    // Get NfcService instance
    this.nfcService = NfcService.getInstance();
  }

  /**
   * Initialize the NFC service - static method
   * @returns true if NFC was successfully initialized, false otherwise
   */
  public static async initialize(): Promise<boolean> {
    const nfcService = NfcService.getInstance();
    return await nfcService.initialize();
  }

  /**
   * Initialize NFC for operations
   */
  public async initialize(): Promise<void> {
    // Check if in Expo Go
    if (this.nfcService.isRunningInExpoGo()) {
      console.log('[SensorNfcService] Running in Expo Go - skipping NFC initialization');
      this.isNfcSupported = false;
      this.initialized = false;
      return;
    }
    
    // If initialization is already in progress, return the existing promise
    if (this.initializationPromise) {
      await this.initializationPromise;
      return;
    }
    
    // Set up a new initialization promise
    this.initializationPromise = this._initialize();
    
    try {
      // Wait for initialization to complete
      this.isNfcSupported = await this.initializationPromise;
      this.initialized = true;
    } catch (error) {
      console.error('[SensorNfcService] NFC initialization failed:', error);
      this.isNfcSupported = false;
      this.initialized = false;
    } finally {
      // Clear the promise to allow future initialization attempts
      this.initializationPromise = null;
    }
  }
  
  /**
   * Internal initialization logic
   */
  private async _initialize(): Promise<boolean> {
    try {
      // Use our core NFC service for safe initialization
      const isNfcEnabled = await this.nfcService.initialize();
      
      if (!isNfcEnabled) {
        console.log('[SensorNfcService] NFC not available or supported');
        return false;
      }
      
      console.log('[SensorNfcService] NFC successfully initialized');
      return true;
    } catch (error) {
      console.error('[SensorNfcService] Failed to initialize NFC:', error);
      return false;
    }
  }

  /**
   * Safely call NFC methods with error handling and default values
   * @param fn - Function to call
   * @param defaultValue - Default value to return if there's an error
   */
  private async safeNfcCall<T>(fn: () => Promise<T>, defaultValue: T): Promise<T> {
    try {
      // Check if in Expo Go
      if (this.nfcService.isRunningInExpoGo()) {
        console.warn('[SensorNfcService] Running in Expo Go - NFC operation not available');
        return defaultValue;
      }
      
      if (!NfcManager) {
        console.warn('[SensorNfcService] NfcManager is not available');
        return defaultValue;
      }
      
      const result = await fn();
      return result !== null && result !== undefined ? result : defaultValue;
    } catch (error) {
      console.warn('[SensorNfcService] NFC operation failed:', error);
      return defaultValue;
    }
  }

  /**
   * Check if NFC is initialized
   */
  public isNfcInitialized(): boolean {
    return this.initialized;
  }

  /**
   * Clean up NFC resources
   */
  public async cleanup(): Promise<void> {
    try {
      console.log('[SensorNfcService] Cleaning up NFC resources');
      
      // First mark any operations as no longer in progress
      this.nfcService.setOperationInProgress(false);
      
      // Use the NFC service for thorough cleanup
      await this.nfcService.cleanup();
      
    } catch (error) {
      console.error('[SensorNfcService] Error during cleanup:', error);
    }
  }

  /**
   * Helper method to prepare ISO 15693 read command
   */
  private prepareReadCommand(blockAddress: number): number[] {
    return [
      this.highDataRateFlag,
      SensorNfcService.CMD_READ_SINGLE_BLOCK,
      blockAddress
    ];
  }
  
  /**
   * Helper method to prepare ISO 15693 write command
   */
  private prepareWriteCommand(blockAddress: number, data: Uint8Array): number[] {
    const command = [
      this.highDataRateFlag,
      SensorNfcService.CMD_WRITE_SINGLE_BLOCK,
      blockAddress
    ];
    
    // Add data bytes
    for (let i = 0; i < data.length; i++) {
      command.push(data[i]);
    }
    
    return command;
  }

  /**
   * Safe wrapper for glucose sensor reading that prevents concurrent operations
   */
  public async safeReadGlucoseSensor(): Promise<number> {
    // Check if NFC is already busy
    if (this.nfcService.isOperationInProgress()) {
      console.log('[SensorNfcService] NFC operation already in progress, skipping read');
      return -1; // Return an error value
    }
    
    try {
      // Mark that an operation is starting
      this.nfcService.setOperationInProgress(true);
      
      // Ensure any previous operations are fully cleaned up
      await this.nfcService.forceCancelTechnologyRequest();
      
      // Perform the actual reading
      return await this.readGlucoseSensor();
    } finally {
      // Always mark operation as completed when done
      this.nfcService.setOperationInProgress(false);
    }
  }

  /**
   * Read glucose value from sensor via NFC
   */
  public async readGlucoseSensor(): Promise<number> {
    try {
      console.log('[SensorNfcService] Starting glucose sensor reading cycle...');
      
      if (!this.initialized) {
        console.log('[SensorNfcService] NFC not initialized, initializing...');
        await this.initialize();
        
        if (!this.isNfcSupported) {
          console.error('[SensorNfcService] NFC not supported on this device');
          throw new Error(NfcErrorType.NOT_SUPPORTED);
        }
      }
      
      // Check if NFC is available
      const isAvailable = await this.isNfcAvailable();
      if (!isAvailable) {
        console.error('[SensorNfcService] NFC not available');
        throw new Error(NfcErrorType.NOT_ENABLED);
      }
      
      console.log('[SensorNfcService] Requesting NFC technology...');
      try {
        // Request NFC V technology (ISO 15693)
        await NfcManager.requestTechnology(NfcTech.NfcV, {
          alertMessage: 'Hold your phone near the glucose sensor'
        });
        console.log('[SensorNfcService] NFC technology requested successfully');
        
        // Get tag info for diagnostic purposes
        try {
          const tagInfo = await NfcManager.getTag();
          console.log('[SensorNfcService] DIAGNOSTIC - Tag info:', JSON.stringify(tagInfo));
        } catch (tagError) {
          console.warn('[SensorNfcService] Could not get tag info for diagnostics:', tagError);
        }
        
      } catch (error) {
        console.error('[SensorNfcService] Error requesting NFC technology:', error);
        
        // Handle cancellation separately
        if (typeof error === 'object' && error !== null && 'toString' in error && 
            (error.toString().includes('cancelled') || error.toString().includes('UserCancel'))) {
          console.log('[SensorNfcService] NFC scan was cancelled by the user');
          throw new Error(NfcErrorType.CANCELLED);
        }
        
        // Check for specific Android error messages indicating no tag was found
        if (Platform.OS === 'android') {
          const errorMessage = typeof error === 'object' && error !== null && 'toString' in error ? 
            error.toString().toLowerCase() : 'unknown error';
          if (errorMessage.includes('tag was lost') || 
              errorMessage.includes('tag connection lost') ||
              errorMessage.includes('tag connection lost') ||
              errorMessage.includes('no tag found') ||
              errorMessage.includes('interrupted') ||
              errorMessage.includes('timeout')) {
            console.log('[SensorNfcService] No NFC tag found or tag connection lost');
            throw new Error(NfcErrorType.TAG_NOT_FOUND);
          }
        }
        
        // Generic message for other communication errors
        throw new Error(NfcErrorType.COMMUNICATION_ERROR);
      }
      
      try {
        // DIAGNOSTIC: Try a raw transceive command to check communication
        try {
          console.log('[SensorNfcService] DIAGNOSTIC - Attempting raw transceive command...');
          // Simple ISO 15693 command to get system info
          const diagnosticCommand = [0x02, 0x2B]; // Get System Info command
          const diagnosticResponse = await NfcManager.transceive(diagnosticCommand);
          console.log('[SensorNfcService] DIAGNOSTIC - Raw command response:', 
            diagnosticResponse ? Array.from(diagnosticResponse) : 'No response');
        } catch (diagError) {
          console.log('[SensorNfcService] DIAGNOSTIC - Raw command failed:', diagError);
        }
        
        // Configure ADC (only needed once per session)
        console.log('[SensorNfcService] Running glucose reading sequence...');
        const configResult = await this.configureAdc();
        if (!configResult.success) {
          console.error('[SensorNfcService] Failed to configure ADC:', configResult.error);
          throw new Error(configResult.error);
        }
        
        // Start sampling
        const startResult = await this.startSampling();
        if (!startResult.success) {
          console.error('[SensorNfcService] Failed to start sampling:', startResult.error);
          throw new Error(startResult.error);
        }
        
        // Wait for sampling to complete (approx. 1 second)
        console.log('[SensorNfcService] Waiting for sampling to complete...');
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        // Read result
        const readResult = await this.readResult();
        if (!readResult.success || !readResult.data) {
          console.error('[SensorNfcService] Failed to read result:', readResult.error);
          throw new Error(readResult.error || NfcErrorType.INVALID_RESPONSE);
        }
        
        // Log the raw data for diagnostic purposes
        console.log('[SensorNfcService] DIAGNOSTIC - Raw ADC data bytes:', 
          Array.from(readResult.data).map(b => ('0' + (b & 0xFF).toString(16)).slice(-2)).join(' '));
        
        // Parse ADC result
        const adcValue = this.parseAdcResult(readResult.data);
        console.log(`[SensorNfcService] ADC value read successfully: ${adcValue}`);
        
        return adcValue;
      } finally {
        // Always cancel tech request to prevent resource leaks
        try {
          console.log('[SensorNfcService] Cleaning up NFC resources...');
          await NfcManager.cancelTechnologyRequest();
        } catch (error) {
          console.error('[SensorNfcService] Error cleaning up NFC tech request:', error);
        }
      }
    } catch (error) {
      console.error('[SensorNfcService] Error in glucose sensor reading cycle:', error);
      throw error;
    }
  }

  /**
   * Configure ADC0 for glucose sensor
   * Sets ADC0 with PGA gain = 1, CIC filter, 1024 decimation, 14-bit accuracy
   * Based on sensor.md documentation
   */
  private async configureAdc(): Promise<NfcCommandResult> {
    try {
      console.log('[SensorNfcService] Configuring ADC...');
      
      // Using the exact configuration from sensor.md
      // Write Block 2 (configure ADC0): 02 21 02 00 00 2C 00 00 00 00 00
      const configData = new Uint8Array([0x00, 0x00, 0x2C, 0x00, 0x00, 0x00, 0x00, 0x00]); 
      
      // Send write command to the configuration block
      if (typeof NfcManager.transceive !== 'function') {
        console.error('[SensorNfcService] NFC transceive method not available');
        return { success: false, error: NfcErrorType.COMMUNICATION_ERROR };
      }
      
      // Prepare ISO 15693 command for writing to block
      // Complete command should be like: 02 21 02 00 00 2C 00 00 00 00 00
      const payload = this.prepareWriteCommand(SensorNfcService.BLOCK_CONFIG, configData);
      
      // Log the exact bytes for diagnostic purposes
      const payloadHex = Array.from(payload).map(b => ('0' + (b & 0xFF).toString(16)).slice(-2)).join(' ');
      console.log('[SensorNfcService] DIAGNOSTIC - ADC config command:', payloadHex);
      
      // Send command and get response
      console.log('[SensorNfcService] Sending ADC configuration command...');
      console.log('[SensorNfcService] Configuration payload:', Array.from(payload));
      const response = await NfcManager.transceive(payload);
      
      if (!response || response.length < 1) {
        console.error('[SensorNfcService] Invalid ADC configuration response');
        return { success: false, error: NfcErrorType.INVALID_RESPONSE };
      }
      
      // Log response bytes for diagnostics
      const responseHex = Array.from(response).map(b => ('0' + (b & 0xFF).toString(16)).slice(-2)).join(' ');
      console.log('[SensorNfcService] DIAGNOSTIC - ADC config response:', responseHex);
      
      console.log('[SensorNfcService] ADC configured successfully, response:', Array.from(response));
      return { success: true };
    } catch (error) {
      console.error('[SensorNfcService] Error configuring ADC:', error);
      return { success: false, error: NfcErrorType.COMMUNICATION_ERROR };
    }
  }

  /**
   * Start ADC sampling
   * Triggers one ADC0 sample
   * Based on sensor.md documentation
   */
  private async startSampling(): Promise<NfcCommandResult> {
    try {
      console.log('[SensorNfcService] Starting ADC sampling...');
      
      // Using the exact command from sensor.md
      // Write Block 0 (start sampling): 02 21 00 01 00 04 00 01 01 00 00
      const startData = new Uint8Array([0x01, 0x00, 0x04, 0x00, 0x01, 0x01, 0x00, 0x00]); 
      
      // Send write command to the control block
      if (typeof NfcManager.transceive !== 'function') {
        console.error('[SensorNfcService] NFC transceive method not available');
        return { success: false, error: NfcErrorType.COMMUNICATION_ERROR };
      }
      
      // Prepare ISO 15693 command for writing to control block
      // Complete command should be like: 02 21 00 01 00 04 00 01 01 00 00
      const payload = this.prepareWriteCommand(SensorNfcService.BLOCK_CONTROL, startData);
      
      // Log the exact bytes for diagnostic purposes
      const payloadHex = Array.from(payload).map(b => ('0' + (b & 0xFF).toString(16)).slice(-2)).join(' ');
      console.log('[SensorNfcService] DIAGNOSTIC - Start sampling command:', payloadHex);
      
      // Send command and get response
      console.log('[SensorNfcService] Sending start sampling command...');
      console.log('[SensorNfcService] Start sampling payload:', Array.from(payload));
      const response = await NfcManager.transceive(payload);
      
      if (!response || response.length < 1) {
        console.error('[SensorNfcService] Invalid start sampling response');
        return { success: false, error: NfcErrorType.INVALID_RESPONSE };
      }
      
      // Log response bytes for diagnostics
      const responseHex = Array.from(response).map(b => ('0' + (b & 0xFF).toString(16)).slice(-2)).join(' ');
      console.log('[SensorNfcService] DIAGNOSTIC - Start sampling response:', responseHex);
      
      console.log('[SensorNfcService] ADC sampling started successfully, response:', Array.from(response));
      return { success: true };
    } catch (error) {
      console.error('[SensorNfcService] Error starting ADC sampling:', error);
      return { success: false, error: NfcErrorType.COMMUNICATION_ERROR };
    }
  }

  /**
   * Read ADC result from the sensor
   * Gets the result from Block 0x09
   */
  private async readResult(): Promise<NfcCommandResult> {
    try {
      console.log('[SensorNfcService] Reading ADC result...');
      
      // Send read command to the result block
      if (typeof NfcManager.transceive !== 'function') {
        console.error('[SensorNfcService] NFC transceive method not available');
        return { success: false, error: NfcErrorType.COMMUNICATION_ERROR };
      }
      
      // Prepare ISO 15693 command for reading from result block
      const payload = this.prepareReadCommand(SensorNfcService.BLOCK_RESULT);
      
      // Log the exact bytes for diagnostic purposes
      const payloadHex = Array.from(payload).map(b => ('0' + (b & 0xFF).toString(16)).slice(-2)).join(' ');
      console.log('[SensorNfcService] DIAGNOSTIC - Read result command:', payloadHex);
      
      // Send command and get response
      console.log('[SensorNfcService] Sending read ADC result command...');
      const response = await NfcManager.transceive(payload);
      
      // Validate response
      if (!response || response.length < 5) {
        console.error('[SensorNfcService] Invalid ADC result response, length:', response?.length);
        return { success: false, error: NfcErrorType.INVALID_RESPONSE };
      }
      
      // Log response bytes for diagnostics
      const responseHex = Array.from(response).map(b => ('0' + (b & 0xFF).toString(16)).slice(-2)).join(' ');
      console.log('[SensorNfcService] DIAGNOSTIC - Read result response:', responseHex);
      
      console.log('[SensorNfcService] ADC result read successfully, data:', Array.from(response));
      return { success: true, data: new Uint8Array(response) };
    } catch (error) {
      console.error('[SensorNfcService] Error reading ADC result:', error);
      return { success: false, error: NfcErrorType.COMMUNICATION_ERROR };
    }
  }

  /**
   * Parse ADC result from the response
   * Example response format: [00 90 24 FF FF FF FF FF]
   * First 3 bytes contain the ADC result (little-endian)
   */
  private parseAdcResult(data: Uint8Array): number {
    // ADC result is in bytes 1-2 (assuming byte 0 is status)
    // For example, in [00 90 24 FF FF FF FF FF], the result is 0x2490 = 9360
    // Note: The endianness can vary based on firmware; adjust if needed
    
    if (data.length < 3) {
      throw new Error(NfcErrorType.INVALID_RESPONSE);
    }
    
    // Extract ADC result (little-endian)
    // This assumes the format described in the sensor documentation
    const adcResult = ((data[2] & 0xFF) << 8) | (data[1] & 0xFF);
    
    // Validate ADC result (0 to 16383 for 14-bit ADC)
    if (adcResult < 0 || adcResult > 16383) {
      throw new Error('ADC result out of range');
    }
    
    return adcResult;
  }

  /**
   * Check if NFC is available on the device
   * @returns true if NFC is available, false otherwise
   */
  public async isNfcAvailable(): Promise<boolean> {
    const isSupported = await SensorNfcService.isNfcAvailable();
    this.isNfcSupported = isSupported;
    return isSupported;
  }

  public async readSensorInfo(): Promise<ISensorInfo | null> {
    try {
      // Check if NfcManager exists
      if (typeof NfcManager === 'undefined' || NfcManager === null) {
        throw new Error(NfcErrorType.NOT_SUPPORTED);
      }

      const tag = await this.safeNfcCall(NfcManager.getTag, null);
      if (!tag) {
        throw new Error('Failed to read NFC tag');
      }

      // Extract sensor info from tag
      const sensorInfo: ISensorInfo = {
        uid: tag.id ? tag.id.toString() : '',
        isActive: true,
        sensorType: tag.techTypes?.join(', ') || 'Unknown',
        manufacturerData: tag.ndefMessage
      };

      return sensorInfo;
    } catch (error) {
      console.error('Error reading sensor info:', error);
      return null;
    }
  }

  /**
   * Detect if a glucose sensor is present without performing a full reading
   * @returns Promise that resolves if sensor is detected, rejects if not
   */
  public async detectSensor(): Promise<boolean> {
    try {
      console.log('[SensorNfcService] Detecting sensor presence...');
      
      if (!this.initialized) {
        console.log('[SensorNfcService] NFC not initialized, initializing...');
        await this.initialize();
        
        if (!this.isNfcSupported) {
          console.error('[SensorNfcService] NFC not supported on this device');
          throw new Error(NfcErrorType.NOT_SUPPORTED);
        }
      }
      
      // Check if NFC is available
      const isAvailable = await this.isNfcAvailable();
      if (!isAvailable) {
        console.error('[SensorNfcService] NFC not available');
        throw new Error(NfcErrorType.NOT_ENABLED);
      }
      
      // Increase timeout for sensor detection from 3 to 5 seconds
      const timeoutMs = 5000;
      let timeoutId: ReturnType<typeof setTimeout> = setTimeout(() => {}, 0); // Initialize with dummy timeout
      
      try {
        // Create a promise that will reject after the timeout
        const timeoutPromise = new Promise<never>((_, reject) => {
          clearTimeout(timeoutId); // Clear the dummy timeout
          timeoutId = setTimeout(() => {
            console.log('[SensorNfcService] Sensor detection timed out after', timeoutMs, 'ms');
            reject(new Error(NfcErrorType.TIMEOUT));
          }, timeoutMs);
        });
        
        // Create a promise for the NFC sensor detection
        const detectionPromise = new Promise<boolean>(async (resolve, reject) => {
          try {
            // Request NFC V technology (ISO 15693)
            await NfcManager.requestTechnology(NfcTech.NfcV, {
              alertMessage: 'Hold your phone near the glucose sensor'
            });
            
            // If we get here, a tag was detected
            console.log('[SensorNfcService] NFC sensor detected successfully');
            resolve(true);
          } catch (error) {
            console.error('[SensorNfcService] Error during sensor detection:', error);
            
            // Check if the error is a UserCancel or related to the user cancelling the scan
            if (typeof error === 'object' && error !== null) {
              const errorStr = error.toString ? error.toString() : String(error);
              
              if (errorStr.includes('cancelled') || 
                  errorStr.includes('UserCancel') || 
                  errorStr.includes('user canceled')) {
                console.log('[SensorNfcService] User cancelled the NFC scan');
                reject(new Error(NfcErrorType.CANCELLED));
                return;
              }
              
              // Check for specific errors indicating no tag was found
              const errorMessage = errorStr.toLowerCase();
              if (errorMessage.includes('tag was lost') || 
                  errorMessage.includes('tag connection lost') ||
                  errorMessage.includes('no tag found') ||
                  errorMessage.includes('tag was not found') ||
                  errorMessage.includes('interrupted') ||
                  errorMessage.includes('timeout')) {
                console.log('[SensorNfcService] No tag was found during scan');
                reject(new Error(NfcErrorType.TAG_NOT_FOUND));
                return;
              }
            }
            
            // Generic message for other communication errors
            console.log('[SensorNfcService] Communication error during scan');
            reject(new Error(NfcErrorType.COMMUNICATION_ERROR));
          }
        });
        
        // Race between timeout and detection
        const result = await Promise.race([detectionPromise, timeoutPromise]);
        clearTimeout(timeoutId);
        return result;
      } catch (error) {
        if (error instanceof Error) {
          const errorType = error.message;
          
          // Log the error but handle more gracefully
          if (errorType === NfcErrorType.CANCELLED) {
            console.log('[SensorNfcService] Sensor detection was cancelled by user');
            // For cancellation, we'll throw a specific error so calling code can handle it
            throw error;
          } else if (errorType === NfcErrorType.TIMEOUT) {
            console.log('[SensorNfcService] Sensor detection timed out');
            // Translate timeout to TAG_NOT_FOUND for consistency in calling code
            throw new Error(NfcErrorType.TAG_NOT_FOUND);
          } else if (errorType === NfcErrorType.TAG_NOT_FOUND) {
            console.log('[SensorNfcService] No sensor tag was found');
            throw error;
          } else {
            console.error('[SensorNfcService] Unexpected error in sensor detection:', error);
            throw new Error(NfcErrorType.COMMUNICATION_ERROR);
          }
        } else {
          console.error('[SensorNfcService] Non-Error object thrown during sensor detection:', error);
          throw new Error(NfcErrorType.UNEXPECTED_ERROR);
        }
      } finally {
        // Always clean up NFC resources
        try {
          await NfcManager.cancelTechnologyRequest();
        } catch (cleanupError) {
          console.log('[SensorNfcService] Error cancelling technology request:', cleanupError);
          // Don't throw from finally block
        }
      }
    } catch (error) {
      console.error('[SensorNfcService] Sensor detection failed:', error);
      
      // Ensure we return a proper Error object with one of our error types
      if (error instanceof Error) {
        // Check if it's already one of our error types
        if (Object.values(NfcErrorType).includes(error.message as NfcErrorType)) {
          throw error;
        } else {
          // Convert to COMMUNICATION_ERROR if not one of our types
          throw new Error(NfcErrorType.COMMUNICATION_ERROR);
        }
      } else {
        // Handle non-Error objects
        throw new Error(NfcErrorType.UNEXPECTED_ERROR);
      }
    }
  }

  /**
   * Diagnostic function to test basic communication with the sensor
   * This should be used for testing if the sensor can be read from
   */
  public async diagnosticTest(): Promise<boolean> {
    try {
      console.log('[SensorNfcService] Running sensor diagnostic test...');
      
      if (!this.initialized) {
        console.log('[SensorNfcService] NFC not initialized, initializing...');
        await this.initialize();
        
        if (!this.isNfcSupported) {
          console.error('[SensorNfcService] NFC not supported on this device');
          return false;
        }
      }
      
      // Check if NFC is available
      const isAvailable = await this.isNfcAvailable();
      if (!isAvailable) {
        console.error('[SensorNfcService] NFC not available');
        return false;
      }
      
      console.log('[SensorNfcService] Requesting NFC technology for diagnostic...');
      try {
        // Request NFC V technology (ISO 15693)
        await NfcManager.requestTechnology(NfcTech.NfcV, {
          alertMessage: 'Hold your phone near the sensor for diagnostic'
        });
        console.log('[SensorNfcService] DIAGNOSTIC - NFC technology granted');
        
        // Try to get tag info
        let tagInfo = null;
        try {
          tagInfo = await NfcManager.getTag();
          console.log('[SensorNfcService] DIAGNOSTIC - Successfully read tag info:', JSON.stringify(tagInfo));
        } catch (tagError) {
          console.error('[SensorNfcService] DIAGNOSTIC - Failed to read tag:', tagError);
          return false;
        }
        
        // Try some basic communication - Get System Info command (ISO 15693)
        try {
          console.log('[SensorNfcService] DIAGNOSTIC - Sending Get System Info command...');
          const sysInfoCmd = [0x02, 0x2B]; // ISO 15693 Get System Info
          const sysInfoResponse = await NfcManager.transceive(sysInfoCmd);
          
          if (sysInfoResponse && sysInfoResponse.length > 0) {
            const respHex = Array.from(sysInfoResponse).map(b => ('0' + (b & 0xFF).toString(16)).slice(-2)).join(' ');
            console.log('[SensorNfcService] DIAGNOSTIC - System Info response:', respHex);
            console.log('[SensorNfcService] DIAGNOSTIC - Basic communication successful!');
            return true;
          } else {
            console.error('[SensorNfcService] DIAGNOSTIC - Empty system info response');
            return false;
          }
        } catch (sysInfoError) {
          console.error('[SensorNfcService] DIAGNOSTIC - System info command failed:', sysInfoError);
          
          // Try a simpler command - Read Single Block for Block 0
          try {
            console.log('[SensorNfcService] DIAGNOSTIC - Trying simpler Read Block 0 command...');
            const readBlockCmd = [0x02, 0x20, 0x00]; // Read Block 0
            const readResponse = await NfcManager.transceive(readBlockCmd);
            
            if (readResponse && readResponse.length > 0) {
              const respHex = Array.from(readResponse).map(b => ('0' + (b & 0xFF).toString(16)).slice(-2)).join(' ');
              console.log('[SensorNfcService] DIAGNOSTIC - Read Block 0 response:', respHex);
              console.log('[SensorNfcService] DIAGNOSTIC - Alternative command successful!');
              return true;
            } else {
              console.error('[SensorNfcService] DIAGNOSTIC - Empty read block response');
              return false;
            }
          } catch (readError) {
            console.error('[SensorNfcService] DIAGNOSTIC - Read block command also failed:', readError);
            return false;
          }
        }
        
      } catch (error) {
        console.error('[SensorNfcService] DIAGNOSTIC - Error in NFC communication:', error);
        return false;
      } finally {
        // Clean up NFC
        try {
          await NfcManager.cancelTechnologyRequest();
        } catch (cleanupError) {
          console.error('[SensorNfcService] DIAGNOSTIC - Error during cleanup:', cleanupError);
        }
      }
    } catch (error) {
      console.error('[SensorNfcService] DIAGNOSTIC - Unexpected error:', error);
      return false;
    }
  }
} 