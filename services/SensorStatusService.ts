import { NativeEventEmitter } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { doc, getDoc, updateDoc } from 'firebase/firestore';
import { db } from '../firebase';
import SensorNfcService, { NfcErrorType, ISensorInfo } from './SensorNfcService';

// Constants
const SENSOR_EXPIRATION_DAYS = 14; // Typical CGM sensor lasts 14 days
const SENSOR_STATUS_KEY = 'cgm_sensor_status';
const BATTERY_LEVEL_LOW_THRESHOLD = 15; // 15% battery level warning

// Types
export type SensorStatus = {
  isConnected: boolean;
  batteryLevel: number | null;
  serialNumber: string | null;
  activationDate: Date | null;
  expirationDate: Date | null;
  lastScanTime: Date | null;
  isExpired: boolean;
  isExpiringSoon: boolean; // Within 24 hours
  hasLowBattery: boolean;
  userId: string | null;
};

export type SensorAlert = {
  type: 'DISCONNECTED' | 'LOW_BATTERY' | 'EXPIRING_SOON' | 'EXPIRED';
  message: string;
  timestamp: Date;
  isRead: boolean;
  id: string;
};

class SensorStatusServiceClass {
  private status: SensorStatus;
  private nfcService: SensorNfcService;
  private eventEmitter: NativeEventEmitter;
  private alerts: SensorAlert[] = [];
  
  constructor() {
    this.nfcService = SensorNfcService.getInstance();
    this.eventEmitter = new NativeEventEmitter();
    
    // Initialize with default values
    this.status = {
      isConnected: false,
      batteryLevel: null,
      serialNumber: null,
      activationDate: null,
      expirationDate: null,
      lastScanTime: null,
      isExpired: false,
      isExpiringSoon: false,
      hasLowBattery: false,
      userId: null
    };
    
    // Load status from storage on initialization
    this.loadStatus();
  }
  
  // Load sensor status from AsyncStorage
  private async loadStatus(): Promise<void> {
    try {
      const storedStatus = await AsyncStorage.getItem(SENSOR_STATUS_KEY);
      if (storedStatus) {
        const parsedStatus = JSON.parse(storedStatus);
        
        // Convert string dates back to Date objects
        if (parsedStatus.activationDate) {
          parsedStatus.activationDate = new Date(parsedStatus.activationDate);
        }
        if (parsedStatus.expirationDate) {
          parsedStatus.expirationDate = new Date(parsedStatus.expirationDate);
        }
        if (parsedStatus.lastScanTime) {
          parsedStatus.lastScanTime = new Date(parsedStatus.lastScanTime);
        }
        
        this.status = parsedStatus;
        
        // Update status calculations
        this.updateStatusCalculations();
      }
    } catch (error) {
      console.error('Error loading sensor status:', error);
    }
  }
  
  // Save current status to AsyncStorage
  private async saveStatus(): Promise<void> {
    try {
      await AsyncStorage.setItem(SENSOR_STATUS_KEY, JSON.stringify(this.status));
    } catch (error) {
      console.error('Error saving sensor status:', error);
    }
  }
  
  // Update Firestore with the latest sensor status
  private async updateFirestore(): Promise<void> {
    if (!this.status.userId || !this.status.serialNumber) return;
    
    try {
      const userRef = doc(db, 'users', this.status.userId);
      const userDoc = await getDoc(userRef);
      
      if (userDoc.exists()) {
        const sensorRef = doc(db, 'sensors', this.status.serialNumber);
        
        await updateDoc(sensorRef, {
          lastScanTime: this.status.lastScanTime,
          isConnected: this.status.isConnected,
          batteryLevel: this.status.batteryLevel,
          isExpired: this.status.isExpired,
          isExpiringSoon: this.status.isExpiringSoon,
          hasLowBattery: this.status.hasLowBattery
        });
      }
    } catch (error) {
      console.error('Error updating Firestore sensor status:', error);
    }
  }
  
  // Calculate derived status properties
  private updateStatusCalculations(): void {
    const now = new Date();
    
    // Check if sensor is expired
    if (this.status.expirationDate) {
      this.status.isExpired = now > this.status.expirationDate;
      
      // Check if expiring within 24 hours
      const msIn24Hours = 24 * 60 * 60 * 1000;
      const timeUntilExpiration = this.status.expirationDate.getTime() - now.getTime();
      this.status.isExpiringSoon = !this.status.isExpired && timeUntilExpiration < msIn24Hours;
    }
    
    // Check battery level
    if (this.status.batteryLevel !== null) {
      this.status.hasLowBattery = this.status.batteryLevel < BATTERY_LEVEL_LOW_THRESHOLD;
    }
    
    // Generate alerts if needed
    this.checkAndCreateAlerts();
  }
  
  // Create alerts based on status
  private checkAndCreateAlerts(): void {
    const createAlert = (type: SensorAlert['type'], message: string): SensorAlert => ({
      type,
      message,
      timestamp: new Date(),
      isRead: false,
      id: `${type}_${Date.now()}`
    });
    
    // Connection alert
    if (!this.status.isConnected && this.status.serialNumber) {
      const message = 'Sensor disconnected. Please scan to reconnect.';
      this.addAlert(createAlert('DISCONNECTED', message));
    }
    
    // Battery alert
    if (this.status.hasLowBattery && this.status.batteryLevel !== null) {
      const message = `Sensor battery low (${this.status.batteryLevel}%). Please prepare for replacement.`;
      this.addAlert(createAlert('LOW_BATTERY', message));
    }
    
    // Expiration alerts
    if (this.status.isExpired) {
      const message = 'Sensor has expired. Please replace the sensor.';
      this.addAlert(createAlert('EXPIRED', message));
    } else if (this.status.isExpiringSoon) {
      const message = 'Sensor expiring soon. Please prepare a new sensor.';
      this.addAlert(createAlert('EXPIRING_SOON', message));
    }
  }
  
  // Add a new alert if not already present
  private addAlert(alert: SensorAlert): void {
    // Avoid duplicate alerts of the same type
    const existingAlert = this.alerts.find(a => 
      a.type === alert.type && !a.isRead && 
      (new Date().getTime() - a.timestamp.getTime()) < 3600000 // 1 hour
    );
    
    if (!existingAlert) {
      this.alerts.push(alert);
      this.emitAlertEvent(alert);
    }
  }
  
  // Emit event when alert is created
  private emitAlertEvent(alert: SensorAlert): void {
    this.eventEmitter.emit('sensorAlert', alert);
  }
  
  // Public methods
  
  // Activate a new sensor
  public async activateSensor(serialNumber: string, userId: string): Promise<void> {
    const now = new Date();
    const expirationDate = new Date(now);
    expirationDate.setDate(now.getDate() + SENSOR_EXPIRATION_DAYS);
    
    this.status = {
      ...this.status,
      serialNumber,
      userId,
      activationDate: now,
      expirationDate,
      isConnected: true,
      lastScanTime: now,
      isExpired: false,
      isExpiringSoon: false
    };
    
    // Try to read battery level if available
    await this.fetchBatteryLevel();
    
    // Save changes
    await this.saveStatus();
    await this.updateFirestore();
    
    // Notify listeners
    this.eventEmitter.emit('sensorActivated', this.status);
  }
  
  // Update sensor connection status
  public async updateConnectionStatus(isConnected: boolean): Promise<void> {
    if (this.status.isConnected !== isConnected) {
      this.status.isConnected = isConnected;
      this.status.lastScanTime = isConnected ? new Date() : this.status.lastScanTime;
      
      // Update derived properties
      this.updateStatusCalculations();
      
      // Save changes
      await this.saveStatus();
      await this.updateFirestore();
      
      // Notify listeners
      this.eventEmitter.emit('connectionStatusChanged', isConnected);
    }
  }
  
  // Get current sensor status
  public getStatus(): SensorStatus {
    this.updateStatusCalculations();
    return { ...this.status };
  }
  
  // Get all unread alerts
  public getUnreadAlerts(): SensorAlert[] {
    return this.alerts.filter(alert => !alert.isRead);
  }
  
  // Mark alert as read
  public markAlertAsRead(alertId: string): void {
    const alert = this.alerts.find(a => a.id === alertId);
    if (alert) {
      alert.isRead = true;
      this.eventEmitter.emit('alertRead', alertId);
    }
  }
  
  // Clear all alerts
  public clearAlerts(): void {
    this.alerts = [];
    this.eventEmitter.emit('alertsCleared');
  }
  
  // Try to read battery level from the sensor
  private async fetchBatteryLevel(): Promise<void> {
    try {
      // This would be replaced with actual NFC reading of battery level
      // For now, we'll simulate it based on days since activation
      if (this.status.activationDate) {
        const daysSinceActivation = Math.floor(
          (new Date().getTime() - this.status.activationDate.getTime()) / (24 * 60 * 60 * 1000)
        );
        
        // Simple calculation - starts at 100%, decreases by ~6% per day
        const estimatedBattery = Math.max(0, 100 - (daysSinceActivation * 6));
        this.status.batteryLevel = estimatedBattery;
        this.status.hasLowBattery = estimatedBattery < BATTERY_LEVEL_LOW_THRESHOLD;
      }
    } catch (error) {
      console.error('Error fetching battery level:', error);
    }
  }
  
  // Check if there's an active sensor
  public hasActiveSensor(): boolean {
    return !!this.status.serialNumber && 
      !!this.status.activationDate && 
      !this.status.isExpired;
  }
  
  // Add event listener
  public addEventListener(
    eventType: 'sensorAlert' | 'sensorActivated' | 'connectionStatusChanged' | 'alertRead' | 'alertsCleared',
    listener: (data: any) => void
  ): { remove: () => void } {
    return this.eventEmitter.addListener(eventType, listener);
  }
  
  // Remove all listeners
  public removeAllListeners(): void {
    this.eventEmitter.removeAllListeners('sensorAlert');
    this.eventEmitter.removeAllListeners('sensorActivated');
    this.eventEmitter.removeAllListeners('connectionStatusChanged');
    this.eventEmitter.removeAllListeners('alertRead');
    this.eventEmitter.removeAllListeners('alertsCleared');
  }
}

// Export as singleton
export const SensorStatusService = new SensorStatusServiceClass(); 