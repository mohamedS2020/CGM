import { AppState, AppStateStatus, Platform, Alert } from 'react-native';
import SensorNfcService from './SensorNfcService';
import GlucoseCalculationService from './GlucoseCalculationService';
import MeasurementService, { GlucoseReading } from './MeasurementService';
import FreeStyleLibreService from './FreeStyleLibreService';
import { SensorType } from './SensorDetectionService';

// Define reading source if not already defined
export enum ReadingSource {
  MANUAL_SCAN = 'manual_scan',
  AUTO_MONITOR = 'auto_monitor',
  CALIBRATION = 'calibration',
  LIBRE_SENSOR = 'libre_sensor'
}

// Extend the GlucoseReading interface to include source
declare module './MeasurementService' {
  export interface GlucoseReading {
    source?: ReadingSource;
    userId?: string;
  }
}

// Default monitoring interval (in milliseconds)
const DEFAULT_INTERVAL = 5 * 60 * 1000; // 5 minutes
const MINIMUM_INTERVAL = 1 * 60 * 1000; // 1 minute
const MAXIMUM_INTERVAL = 30 * 60 * 1000; // 30 minutes

/**
 * Service for managing continuous glucose monitoring
 * Handles regular reading cycles and background monitoring
 */
export default class GlucoseMonitoringService {
  private static instance: GlucoseMonitoringService;
  
  private monitoringActive: boolean = false;
  private monitoringInterval: number = DEFAULT_INTERVAL;
  private timerId: number | null = null;
  private userId: string | null = null;
  private lastReading: GlucoseReading | null = null;
  private consecutiveErrorCount: number = 0;
  private maxConsecutiveErrors: number = 3;
  private appState: AppStateStatus = 'active';
  private nextReadingTimeout: number | null = null;
  private nfcAvailable = false;
  private currentSensorType: SensorType = SensorType.RF430;
  
  // Service instances
  private nfcService: SensorNfcService;
  private glucoseCalculationService: GlucoseCalculationService;
  private libreService: FreeStyleLibreService;
  
  // Callbacks
  private onNewReadingCallback: ((reading: GlucoseReading) => void) | null = null;
  private onErrorCallback: ((error: Error) => void) | null = null;
  
  // App state subscription
  private appStateSubscription: { remove: () => void } | null = null;
  
  // Singleton pattern
  public static getInstance(): GlucoseMonitoringService {
    if (!GlucoseMonitoringService.instance) {
      GlucoseMonitoringService.instance = new GlucoseMonitoringService();
    }
    return GlucoseMonitoringService.instance;
  }
  
  private constructor() {
    console.log('GlucoseMonitoringService: Initializing');
    this.handleAppStateChange = this.handleAppStateChange.bind(this);
    
    // Check NFC availability during initialization
    SensorNfcService.isNfcAvailable()
      .then(available => {
        this.nfcAvailable = available;
        console.log(`GlucoseMonitoringService: NFC ${available ? 'is' : 'is not'} available`);
      })
      .catch(error => {
        console.error('GlucoseMonitoringService: Failed to check NFC availability', error);
        this.nfcAvailable = false;
      });
    
    this.nfcService = SensorNfcService.getInstance();
    this.glucoseCalculationService = GlucoseCalculationService.getInstance();
    this.libreService = FreeStyleLibreService.getInstance();
    
    // Initialize NFC service asynchronously - don't wait or check result here
    // This prevents blocking the constructor and allows initialization to proceed independently
    if (this.nfcService && typeof this.nfcService.initialize === 'function') {
      console.log('GlucoseMonitoringService: Starting NFC initialization');
      this.nfcService.initialize().catch(error => {
        console.error('GlucoseMonitoringService: Failed to initialize NFC service:', error);
      });
    } else {
      console.warn('GlucoseMonitoringService: NFC service initialize method not available');
    }
    
    // Setup app state monitoring to pause/resume readings when app goes to background/foreground
    this.appStateSubscription = AppState.addEventListener('change', this.handleAppStateChange);
  }
  
  /**
   * Set the current sensor type
   */
  public setSensorType(type: SensorType): void {
    this.currentSensorType = type;
    console.log(`GlucoseMonitoringService: Sensor type set to ${type}`);
  }
  
  /**
   * Get the current sensor type
   */
  public getSensorType(): SensorType {
    return this.currentSensorType;
  }
  
  /**
   * Handle app state changes (active, background, inactive)
   */
  private handleAppStateChange = (nextAppState: AppStateStatus) => {
    // Store the previous app state
    const previousAppState = this.appState;
    this.appState = nextAppState;
    
    // If coming back to foreground and monitoring was active
    if (previousAppState !== 'active' && nextAppState === 'active' && this.monitoringActive) {
      console.log('App returned to foreground, resuming monitoring');
      this.resumeMonitoring();
    }
    
    // If going to background and monitoring is active
    if (previousAppState === 'active' && nextAppState !== 'active' && this.monitoringActive) {
      console.log('App going to background, pausing active monitoring');
      this.pauseMonitoring();
      
      // On iOS we might need to schedule local notifications for reminders
      if (Platform.OS === 'ios') {
        this.scheduleReadingReminder();
      }
    }
  };
  
  /**
   * Start continuous glucose monitoring
   * @param userId - User ID for storing readings
   * @param interval - Monitoring interval in milliseconds (optional)
   * @returns Promise resolving to true if monitoring started successfully or error code string if it failed
   */
  public async startMonitoring(
    userId: string,
    interval: number = DEFAULT_INTERVAL,
    onNewReading?: (reading: GlucoseReading) => void,
    onError?: (error: Error) => void
  ): Promise<boolean | string> {
    console.log('GlucoseMonitoringService: Starting monitoring');
    
    // If monitoring is already active, don't restart it
    if (this.monitoringActive) {
      console.log('GlucoseMonitoringService: Already monitoring, not starting again');
      return 'ALREADY_MONITORING';
    }
    
    // Check if NFC is available
    try {
      const nfcAvailable = await SensorNfcService.isNfcAvailable();
      if (!nfcAvailable) {
        console.error('GlucoseMonitoringService: NFC not available, cannot start monitoring');
        if (onError) {
          onError(new Error('NFC_NOT_AVAILABLE'));
        }
        return 'NFC_NOT_AVAILABLE';
      }
    } catch (error) {
      console.error('GlucoseMonitoringService: Error checking NFC availability:', error);
      if (onError) {
        onError(error instanceof Error ? error : new Error('NFC_CHECK_FAILED'));
      }
      return 'NFC_CHECK_FAILED';
    }
    
    // Validate interval
    if (interval < MINIMUM_INTERVAL) {
      interval = MINIMUM_INTERVAL;
    } else if (interval > MAXIMUM_INTERVAL) {
      interval = MAXIMUM_INTERVAL;
    }
    
    // Store configuration
    this.userId = userId;
    this.monitoringInterval = interval;
    this.onNewReadingCallback = onNewReading || null;
    this.onErrorCallback = onError || null;
    
    try {
      // Initialize NFC if needed
      if (!this.nfcService.isNfcInitialized()) {
        console.log('GlucoseMonitoringService: NFC not initialized, attempting initialization');
        await this.nfcService.initialize();
      }
      
      // Try to detect if a sensor is present before starting monitoring
      try {
        console.log('GlucoseMonitoringService: Checking for sensor presence...');
        // Attempt a quick sensor detection without full reading
        await this.nfcService.detectSensor();
        console.log('GlucoseMonitoringService: Sensor detected, proceeding with monitoring');
      } catch (sensorError) {
        console.error('GlucoseMonitoringService: No sensor detected:', sensorError);
        if (this.onErrorCallback) {
          this.onErrorCallback(new Error('SENSOR_NOT_FOUND'));
        }
        return 'SENSOR_NOT_FOUND';
      }
      
      // Start the monitoring process
      this.monitoringActive = true;
      this.consecutiveErrorCount = 0;
      
      // Set up app state change listener if not already set
      if (!this.appStateSubscription) {
        this.appStateSubscription = AppState.addEventListener('change', this.handleAppStateChange);
      }
      
      // Take initial reading
      try {
        await this.performReadingCycle();
      } catch (error) {
        console.error('GlucoseMonitoringService: Initial reading error:', error);
        
        // If this was a sensor not found error, don't continue with monitoring
        if (error instanceof Error && 
            (error.message.includes('TAG_NOT_FOUND') || 
             error.message.includes('NO_SENSOR'))) {
          console.log('GlucoseMonitoringService: Cannot start monitoring without a sensor');
          // Clean up the monitoring state since we're not continuing
          this.stopMonitoring();
          
          if (this.onErrorCallback) {
            this.onErrorCallback(new Error('SENSOR_NOT_FOUND'));
          }
          return 'SENSOR_NOT_FOUND';
        }
        
        if (this.onErrorCallback) {
          this.onErrorCallback(error instanceof Error ? error : new Error('INITIAL_READING_FAILED'));
        }
        // For other errors, continue with monitoring despite initial reading failure
      }
      
      // Schedule regular readings
      this.scheduleNextReading();
      
      return true;
    } catch (error) {
      console.error('GlucoseMonitoringService: Failed to start monitoring:', error);
      if (this.onErrorCallback) {
        this.onErrorCallback(error instanceof Error ? error : new Error('START_MONITORING_FAILED'));
      }
      
      // Cleanup partial start
      this.stopMonitoring();
      
      // Ensure we always return a string error code, not an Error object
      if (error instanceof Error) {
        return error.message;
      } else if (typeof error === 'string') {
        return error;
      } else {
        return 'START_MONITORING_FAILED';
      }
    }
  }
  
  /**
   * Stop continuous glucose monitoring
   */
  public stopMonitoring(): void {
    console.log('GlucoseMonitoringService: Stopping monitoring');
    
    // Clean up any scheduled tasks
    if (this.timerId) {
      clearTimeout(this.timerId);
      this.timerId = null;
    }
    
    // Remove app state change listener
    if (this.appStateSubscription) {
      this.appStateSubscription.remove();
      this.appStateSubscription = null;
    }
    
    // Reset state
    this.monitoringActive = false;
    this.userId = null;
    this.onNewReadingCallback = null;
    this.onErrorCallback = null;
    this.consecutiveErrorCount = 0;
  }
  
  /**
   * Check if monitoring is currently active
   */
  public isMonitoring(): boolean {
    return this.monitoringActive;
  }
  
  /**
   * Get the current monitoring interval
   */
  public getMonitoringInterval(): number {
    return this.monitoringInterval;
  }
  
  /**
   * Set a new monitoring interval
   * @param interval - Monitoring interval in milliseconds
   */
  public setMonitoringInterval(interval: number): void {
    // Validate interval
    if (interval < MINIMUM_INTERVAL) {
      interval = MINIMUM_INTERVAL;
    } else if (interval > MAXIMUM_INTERVAL) {
      interval = MAXIMUM_INTERVAL;
    }
    
    this.monitoringInterval = interval;
    
    // If monitoring is active, reschedule with new interval
    if (this.monitoringActive && this.timerId) {
      clearTimeout(this.timerId);
      this.scheduleNextReading();
    }
  }
  
  /**
   * Get the last glucose reading
   */
  public getLastReading(): GlucoseReading | null {
    return this.lastReading;
  }
  
  /**
   * Schedule the next reading
   */
  private scheduleNextReading(): void {
    // Only schedule if monitoring is active
    if (!this.monitoringActive) {
      return;
    }
    
    // Clear any existing timers
    if (this.timerId) {
      clearTimeout(this.timerId);
    }
    
    // Schedule the next reading based on the interval
    this.timerId = setTimeout(() => {
      // Only perform reading if app is in foreground
      if (this.appState === 'active') {
        this.performReadingCycle().catch(error => {
          console.error('Error in scheduled reading cycle:', error);
          this.consecutiveErrorCount++;
          
          // Notify of the error
          if (this.onErrorCallback) {
            this.onErrorCallback(error);
          }
          
          // Stop monitoring if too many consecutive errors
          if (this.consecutiveErrorCount >= this.maxConsecutiveErrors) {
            console.error('Too many consecutive errors, stopping monitoring');
            this.stopMonitoring();
            
            // Show an alert to the user
            Alert.alert(
              'Monitoring Stopped',
              'Glucose monitoring has been stopped due to multiple reading errors. Please check your sensor connection and try again.',
              [{ text: 'OK' }]
            );
          } else {
            // Schedule the next reading even after an error
            this.scheduleNextReading();
          }
        });
      } else {
        // Reschedule if app is in background
        this.scheduleNextReading();
      }
    }, this.monitoringInterval) as unknown as number;
  }
  
  /**
   * Pause monitoring (typically when app goes to background)
   */
  private pauseMonitoring(): void {
    if (this.timerId) {
      clearTimeout(this.timerId);
      this.timerId = null;
    }
  }
  
  /**
   * Resume monitoring (typically when app returns to foreground)
   */
  private resumeMonitoring(): void {
    if (this.monitoringActive) {
      // Take a reading immediately when resuming
      this.performReadingCycle().catch(error => {
        console.error('Error in resume reading cycle:', error);
        if (this.onErrorCallback) {
          this.onErrorCallback(error);
        }
      });
      
      // Schedule regular readings
      this.scheduleNextReading();
    }
  }
  
  /**
   * Schedule a reminder notification when the app is in background (iOS only)
   */
  private scheduleReadingReminder(): void {
    // This would use local notifications to remind the user
    // For a production app, you would implement this using a notification library
    console.log('Reading reminder scheduled for background mode');
    
    // Implementation would depend on notification library being used
    // Example: Notifications.scheduleNotificationAsync({ ... })
  }
  
  /**
   * Perform a complete glucose reading cycle
   * 1. Configure ADC
   * 2. Start sampling
   * 3. Wait appropriate time
   * 4. Read result
   * 5. Convert to glucose value
   * 6. Store reading
   */
  public async performReadingCycle(): Promise<GlucoseReading> {
    try {
      if (!this.userId) {
        throw new Error('User ID not set. Cannot store reading.');
      }
      
      let reading: GlucoseReading;
      
      // Use appropriate service based on sensor type
      if (this.currentSensorType === SensorType.LIBRE) {
        // Use FreeStyle Libre service
        console.log('GlucoseMonitoringService: Reading from FreeStyle Libre sensor');
        reading = await this.libreService.readGlucoseData();
      } else {
        // Use RF430 service (existing implementation)
        console.log('GlucoseMonitoringService: Reading from RF430 sensor');
        const adcValue = await this.nfcService.safeReadGlucoseSensor();
        
        // If adcValue is -1, it means another NFC operation was in progress, so skip this cycle
        if (adcValue === -1) {
          console.log('Skipping reading cycle - another NFC operation in progress');
          throw new Error('CONCURRENT_OPERATION: Another NFC operation is already in progress');
        }
        
        // Convert ADC value to glucose level
        const glucoseValue = this.glucoseCalculationService.adcToGlucose(adcValue);
        
        // Create reading object
        reading = {
          value: glucoseValue,
          timestamp: new Date(),
          source: ReadingSource.AUTO_MONITOR,
          isAlert: this.glucoseCalculationService.isGlucoseInAlertRange(glucoseValue)
        };
      }
      
      // Save reading to Firestore
      const readingId = await MeasurementService.addReading(this.userId, reading);
      
      // Update with ID
      const fullReading: GlucoseReading = {
        ...reading,
        id: readingId
      };
      
      // Store as last reading
      this.lastReading = fullReading;
      
      // Reset consecutive error count after successful reading
      this.consecutiveErrorCount = 0;
      
      // Notify of new reading
      if (this.onNewReadingCallback) {
        this.onNewReadingCallback(fullReading);
      }
      
      // Show alert notification for out-of-range readings
      if (reading.isAlert) {
        const alertType = reading.value < this.glucoseCalculationService.GLUCOSE_LOW ? 'low' : 'high';
        
        Alert.alert(
          'Glucose Alert',
          `Your glucose level is ${alertType} (${reading.value} mg/dL).`,
          [{ text: 'OK' }]
        );
      }
      
      return fullReading;
    } catch (error) {
      console.error('Error performing reading cycle:', error);
      
      // Don't increment error count for certain expected errors
      if (error instanceof Error) {
        const errorMessage = error.message;
        if (errorMessage.includes('CONCURRENT_OPERATION') || 
            errorMessage.includes('CANCELLED') ||
            errorMessage.includes('TAG_NOT_FOUND')) {
          // These are expected errors, don't increment the counter
          console.log(`Expected error during reading cycle: ${errorMessage}`);
        } else {
          this.consecutiveErrorCount++;
        }
      } else {
        this.consecutiveErrorCount++;
      }
      
      throw error;
    }
  }
  
  /**
   * Manual reading - forces an immediate glucose reading
   */
  public async takeManualReading(): Promise<GlucoseReading> {
    try {
      // Ensure NFC is initialized before attempting to read
      if (this.nfcService) {
        try {
          console.log('Ensuring NFC is initialized before manual reading...');
          await this.nfcService.initialize();
        } catch (initError) {
          console.error('Failed to initialize NFC before manual reading:', initError);
          // Continue anyway - readGlucoseSensor will also check initialization
        }
      }

      let reading: GlucoseReading;
      
      // Use appropriate service based on sensor type
      if (this.currentSensorType === SensorType.LIBRE) {
        // Use FreeStyle Libre service
        console.log('GlucoseMonitoringService: Taking manual reading from FreeStyle Libre sensor');
        reading = await this.libreService.readGlucoseData();
        reading.source = ReadingSource.MANUAL_SCAN;
      } else {
        // Use RF430 service (existing implementation)
        console.log('GlucoseMonitoringService: Taking manual reading from RF430 sensor');
        const adcValue = await this.nfcService.safeReadGlucoseSensor();
        
        // If adcValue is -1, it means another NFC operation was in progress, so skip this cycle
        if (adcValue === -1) {
          console.log('Manual reading aborted - another NFC operation in progress');
          throw new Error('CONCURRENT_OPERATION: Please wait for any ongoing NFC operations to complete');
        }
        
        // Convert ADC value to glucose level
        const glucoseValue = this.glucoseCalculationService.adcToGlucose(adcValue);

        // Create a reading object
        reading = {
          value: glucoseValue,
          timestamp: new Date(),
          source: ReadingSource.MANUAL_SCAN,
          userId: this.userId || 'unknown',
          isAlert: this.glucoseCalculationService.isGlucoseInAlertRange(glucoseValue)
        };
      }

      // Save reading to database
      if (this.userId) {
        const readingId = await MeasurementService.addReading(this.userId, reading);
        reading.id = readingId;
      }

      // Trigger the callback for a new reading (if monitoring is active)
      if (this.monitoringActive && this.onNewReadingCallback) {
        this.onNewReadingCallback(reading);
      }

      // Unlock the scanner for next reading
      this.consecutiveErrorCount = 0;

      return reading;
    } catch (error) {
      console.error('Error in takeManualReading:', error);
      
      // Don't increment error count for concurrent operation errors
      if (!(error instanceof Error && 
           error.message.includes('CONCURRENT_OPERATION'))) {
        this.consecutiveErrorCount++;
      }
      
      // Notify the error callback if available
      if (this.onErrorCallback) {
        this.onErrorCallback(error instanceof Error ? error : new Error('Unknown error taking reading'));
      }
      
      // Check if the error is related to NFC not being supported
      if (error instanceof Error) {
        const errorMessage = error.message.toLowerCase();
        if (errorMessage.includes('nfc not supported') || 
            errorMessage.includes('nfc is not available') ||
            errorMessage.includes('cannot convert null value')) {
          throw new Error('NOT_SUPPORTED: NFC is not available on this device');
        }
        
        // Handle concurrent operations with a user-friendly message
        if (errorMessage.includes('concurrent_operation')) {
          throw new Error('Please wait, another NFC operation is in progress');
        }
      }
      
      throw error;
    }
  }
  
  /**
   * Clean up resources when service is no longer needed
   */
  public cleanup(): void {
    this.stopMonitoring();
    
    // Remove app state change listener (already handled in stopMonitoring)
    if (this.appStateSubscription) {
      this.appStateSubscription.remove();
      this.appStateSubscription = null;
    }
    
    // Ensure we safely clean up NFC resources
    if (this.nfcService) {
      this.nfcService.cleanup();
    }
  }
  
  /**
   * Check if NFC is supported and available on this device
   * @returns Promise that resolves to boolean indicating NFC availability
   */
  public isNfcSupported(): Promise<boolean> {
    return SensorNfcService.isNfcAvailable();
  }
} 