import { Alert, Platform, Vibration } from 'react-native';
import { Audio } from 'expo-av';
import { GlucoseReading } from './MeasurementService';
import MeasurementService from './MeasurementService';

export interface GlucoseAlert {
  reading: GlucoseReading;
  alertType: 'HIGH' | 'LOW';
  timestamp: Date;
  acknowledged: boolean;
}

export default class AlertService {
  private static instance: AlertService;
  private alarmSound: Audio.Sound | null = null;
  private isPlaying: boolean = false;
  private alertModalCallback: ((alert: GlucoseAlert) => void) | null = null;
  
  // Get singleton instance
  public static getInstance(): AlertService {
    if (!AlertService.instance) {
      AlertService.instance = new AlertService();
    }
    return AlertService.instance;
  }
  
  private constructor() {
    this.initializeSound();
  }
  
  // Initialize sound resources
  private async initializeSound(): Promise<void> {
    try {
      // Set audio mode to ensure sound plays even in silent mode
      await Audio.setAudioModeAsync({
        playsInSilentModeIOS: true,
        staysActiveInBackground: false,
        shouldDuckAndroid: true,
      });
      
      // Pre-load the sound to make it ready when needed
      this.loadSound();
    } catch (error) {
      console.error('[AlertService] Error initializing audio mode:', error);
    }
  }
  
  // Load the sound file
  private async loadSound(): Promise<void> {
    try {
      // Create a new sound object
      const sound = new Audio.Sound();
      
      try {
        // Try to load from assets
        await sound.loadAsync(require('../assets/sounds/alarm.mp3'));
        console.log('[AlertService] Successfully loaded alarm sound');
        this.alarmSound = sound;
      } catch (soundError) {
        console.error('[AlertService] Error loading main alarm sound:', soundError);
        
        // Try platform-specific fallback approach
        try {
          if (Platform.OS === 'android') {
            // For Android, try to use system notification sound
            await sound.loadAsync({ uri: 'system://notification' });
          } else {
            // For iOS, try a different approach or a simpler sound
            await sound.loadAsync({ uri: 'system://alert' });
          }
          console.log('[AlertService] Successfully loaded fallback system sound');
          this.alarmSound = sound;
        } catch (fallbackError) {
          console.error('[AlertService] Error loading fallback sound:', fallbackError);
          this.alarmSound = null;
        }
      }
    } catch (error) {
      console.error('[AlertService] Error creating sound object:', error);
      this.alarmSound = null;
    }
  }
  
  // Register callback function to show alert modal
  public registerAlertCallback(callback: (alert: GlucoseAlert) => void): void {
    this.alertModalCallback = callback;
  }
  
  // Unregister alert callback
  public unregisterAlertCallback(): void {
    this.alertModalCallback = null;
  }
  
  // Process a glucose reading and trigger alert if needed
  public processReading(reading: GlucoseReading): void {
    if (!reading || typeof reading.value !== 'number') return;
    
    // Define thresholds for alerts
    const LOW_THRESHOLD = 70;
    const HIGH_THRESHOLD = 180;
    
    let alertType: 'HIGH' | 'LOW' | null = null;
    
    // Check if reading is outside normal range
    if (reading.value < LOW_THRESHOLD) {
      alertType = 'LOW';
    } else if (reading.value > HIGH_THRESHOLD) {
      alertType = 'HIGH';
    }
    
    // If an alert is needed, trigger it
    if (alertType) {
      const alert: GlucoseAlert = {
        reading,
        alertType,
        timestamp: new Date(),
        acknowledged: false
      };
      
      this.triggerAlert(alert);
    }
  }
  
  // Trigger alert with sound and notification
  private triggerAlert(alert: GlucoseAlert): void {
    console.log(`[AlertService] Triggering ${alert.alertType} glucose alert: ${alert.reading.value} mg/dL`);
    
    // Start playing alarm sound
    this.playAlarm();
    
    // Show alert modal if callback is registered
    if (this.alertModalCallback) {
      this.alertModalCallback(alert);
    } else {
      // Fallback to native alert if no modal callback is registered
      const message = alert.alertType === 'HIGH' 
        ? `High glucose level detected: ${alert.reading.value} mg/dL`
        : `Low glucose level detected: ${alert.reading.value} mg/dL`;
      
      Alert.alert(
        'Glucose Alert',
        message,
        [
          {
            text: 'Acknowledge',
            onPress: () => this.stopAlarm()
          }
        ],
        { cancelable: false }
      );
    }
  }
  
  // Play alarm sound
  private async playAlarm(): Promise<void> {
    if (this.isPlaying) return;
    
    try {
      // First, trigger vibration for both audio and tactile feedback
      if (Platform.OS === 'android') {
        // Android supports vibration patterns
        Vibration.vibrate([500, 500, 500, 500], true); // Vibrate in pattern, repeat
      } else {
        // iOS has limited vibration support
        Vibration.vibrate(500);
        // Set up a repeating vibration using setInterval
        const vibrateIntervalId = setInterval(() => {
          Vibration.vibrate(500);
        }, 1500);
        
        // Store the interval ID to clear it later
        // @ts-ignore
        this.vibrateIntervalId = vibrateIntervalId;
      }
      
      // Then try to play sound, but don't let sound errors block the alert
      if (this.alarmSound) {
        try {
          // Make sure the sound is at the beginning
          await this.alarmSound.setPositionAsync(0);
          // Set volume to maximum
          await this.alarmSound.setVolumeAsync(1.0);
          // Make it loop
          await this.alarmSound.setIsLoopingAsync(true);
          // Play the sound
          await this.alarmSound.playAsync();
          this.isPlaying = true;
          console.log('[AlertService] Started playing alarm sound');
        } catch (soundError) {
          console.error('[AlertService] Error playing alarm sound:', soundError);
          
          // If playing fails, try to reload the sound
          this.loadSound().then(async () => {
            if (this.alarmSound) {
              try {
                await this.alarmSound.playAsync();
              } catch (retryError) {
                console.error('[AlertService] Retry play failed:', retryError);
              }
            }
          });
          
          // Still mark as playing for vibration to continue
          this.isPlaying = true;
        }
      } else {
        // If sound isn't available, reload it and still mark as "playing" so vibration continues
        this.loadSound();
        this.isPlaying = true;
        console.log('[AlertService] Using vibration only for alert (no sound available)');
      }
    } catch (error) {
      console.error('[AlertService] Error playing alarm:', error);
      // Still mark as playing so vibration is active
      this.isPlaying = true;
    }
  }
  
  // Stop alarm
  public async stopAlarm(): Promise<void> {
    if (!this.isPlaying) return;
    
    try {
      // Stop vibration first
      Vibration.cancel();
      
      // Clear iOS vibration interval if it exists
      // @ts-ignore
      if (this.vibrateIntervalId) {
        // @ts-ignore
        clearInterval(this.vibrateIntervalId);
        // @ts-ignore
        this.vibrateIntervalId = null;
      }
      
      // Then try to stop sound
      if (this.alarmSound) {
        try {
          await this.alarmSound.stopAsync();
        } catch (stopError) {
          console.error('[AlertService] Error stopping sound:', stopError);
        }
      }
      
      this.isPlaying = false;
      console.log('[AlertService] Stopped alarm sound');
    } catch (error) {
      console.error('[AlertService] Error stopping alarm sound:', error);
      this.isPlaying = false;
    }
  }
  
  // Save alert to history
  public async saveAlertToHistory(alert: GlucoseAlert): Promise<void> {
    if (!alert || !alert.reading) return;
    
    try {
      // Mark the alert as acknowledged
      alert.acknowledged = true;
      
      const reading = alert.reading;
      
      // Check if this is an offline reading (ID starts with "offline_")
      const isOfflineReading = reading.id && typeof reading.id === 'string' && reading.id.startsWith('offline_');
      
      // If reading has a valid non-offline ID, it's already in the database, just update it
      if (reading.id && reading.userId && !isOfflineReading) {
        // Update the existing reading to mark it as an alert
        try {
          await MeasurementService.updateReading(
            reading.userId, 
            reading.id, 
            { 
              isAlert: true,
              comment: reading.comment || `${alert.alertType === 'HIGH' ? 'High' : 'Low'} glucose alert - automatically detected`
            }
          );
          
          console.log(`[AlertService] Updated alert in history with id ${reading.id}`);
        } catch (updateError) {
          console.error(`[AlertService] Error updating reading with ID ${reading.id}:`, updateError);
          // If update fails, try adding as a new reading
          this.addNewAlertReading(reading, alert.alertType);
        }
      } 
      // If it's an offline reading or a new reading (no ID yet), but has userId, add it to database as new
      else if (reading.userId) {
        await this.addNewAlertReading(reading, alert.alertType);
      }
      // Otherwise, just log that we can't save without userId
      else {
        console.warn('[AlertService] Cannot save alert to history without userId');
      }
    } catch (error) {
      console.error('[AlertService] Error saving alert to history:', error);
    }
  }
  
  // Helper to add a new alert reading
  private async addNewAlertReading(reading: GlucoseReading, alertType: 'HIGH' | 'LOW'): Promise<void> {
    try {
      // Create a new reading object with alert flag set
      const readingWithAlert: GlucoseReading = {
        value: reading.value,
        timestamp: reading.timestamp,
        isAlert: true,
        comment: reading.comment || `${alertType === 'HIGH' ? 'High' : 'Low'} glucose alert - automatically detected`,
        userId: reading.userId,
        // Preserve additional metadata if present
        source: reading.source,
        _isSensorReading: reading._isSensorReading,
        _isManualReading: reading._isManualReading,
      };
      
      // Add the reading to the database
      const newId = await MeasurementService.addReading(reading.userId, readingWithAlert);
      console.log(`[AlertService] Saved new alert to history with id ${newId}`);
    } catch (error) {
      console.error('[AlertService] Error adding new alert reading:', error);
    }
  }
  
  // Clean up resources when the service is no longer needed
  public async releaseResources(): Promise<void> {
    try {
      if (this.alarmSound) {
        await this.alarmSound.unloadAsync();
        this.alarmSound = null;
      }
    } catch (error) {
      console.error('[AlertService] Error releasing resources:', error);
    }
  }
} 