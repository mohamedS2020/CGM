import { NativeEventEmitter } from 'react-native';
import { GlucoseReading } from './MeasurementService';
import AlertService from './AlertService';

/**
 * Simple event bus to notify components when new glucose readings are made
 */
class GlucoseReadingEvents {
  private static instance: GlucoseReadingEvents;
  private eventEmitter: NativeEventEmitter;
  private alertService: AlertService;
  private currentUserId: string | null = null;

  private constructor() {
    this.eventEmitter = new NativeEventEmitter();
    this.alertService = AlertService.getInstance();
  }

  /**
   * Get the singleton instance
   */
  public static getInstance(): GlucoseReadingEvents {
    if (!GlucoseReadingEvents.instance) {
      GlucoseReadingEvents.instance = new GlucoseReadingEvents();
    }
    return GlucoseReadingEvents.instance;
  }
  
  /**
   * Set the current user ID for proper alert handling
   */
  public setCurrentUserId(userId: string | null): void {
    this.currentUserId = userId;
    console.log(`[GlucoseReadingEvents] Current user ID set to: ${userId || 'null'}`);
  }

  /**
   * Emit an event when a new reading is made
   */
  public emitNewReading(reading: GlucoseReading): void {
    this.eventEmitter.emit('newGlucoseReading', reading);
    
    // Add userId to the reading if available
    const readingWithUserId = this.currentUserId ? 
      { ...reading, userId: this.currentUserId } : reading;
    
    // Process reading for potential alerts
    if (readingWithUserId && !readingWithUserId._isOffline) {
      // Only trigger alerts for online readings to prevent duplicate alerts
      this.alertService.processReading(readingWithUserId);
    }
  }

  /**
   * Emit an event when an offline reading is synced to Firebase
   */
  public emitReadingSynced(reading: GlucoseReading): void {
    this.eventEmitter.emit('readingSynced', reading);
  }

  /**
   * Add a listener for new readings
   */
  public addNewReadingListener(
    listener: (reading: GlucoseReading) => void
  ): { remove: () => void } {
    return this.eventEmitter.addListener('newGlucoseReading', listener);
  }

  /**
   * Add a listener for synced readings
   */
  public addReadingSyncedListener(
    listener: (reading: GlucoseReading) => void
  ): { remove: () => void } {
    return this.eventEmitter.addListener('readingSynced', listener);
  }

  /**
   * Remove all listeners
   */
  public removeAllListeners(): void {
    this.eventEmitter.removeAllListeners('newGlucoseReading');
    this.eventEmitter.removeAllListeners('readingSynced');
  }
}

export default GlucoseReadingEvents; 