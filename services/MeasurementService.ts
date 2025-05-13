import { collection, doc, query, where, orderBy, limit, getDocs, getDoc, addDoc, updateDoc, deleteDoc, Timestamp, serverTimestamp } from 'firebase/firestore';
import { db } from '../firebase';
import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo, { NetInfoState, NetInfoSubscription } from '@react-native-community/netinfo';
import GlucoseReadingEvents from './GlucoseReadingEvents';

// Key for storing offline readings
const OFFLINE_READINGS_KEY = 'cgm_offline_readings';

// Interface for glucose readings
export interface GlucoseReading {
  id?: string;
  value: number;
  timestamp: Date;
  comment?: string;
  isAlert?: boolean;
  isSensorActivationReading?: boolean;
  _isSensorReading?: boolean;
  _isManualReading?: boolean;
}

// Reading filter options
export interface ReadingFilterOptions {
  timeframe?: 'hour' | 'day' | 'week' | 'month' | 'all';
  startDate?: Date;
  endDate?: Date;
  limit?: number;
  onlyAlerts?: boolean;
}

/**
 * Service for handling glucose measurements
 */
class MeasurementService {
  private static netInfoUnsubscribe: NetInfoSubscription | null = null;
  private static isFirstConnect: boolean = true;
  private static activeUserId: string | null = null;
  private static syncInProgress: boolean = false;
  private static syncLock: { [userId: string]: boolean } = {};
  private static lastSyncTimestamp: { [userId: string]: number } = {};
  private static syncThrottleTimeout: ReturnType<typeof setTimeout> | null = null;
  
  // Minimum time between syncs (30 seconds)
  private static readonly MIN_SYNC_INTERVAL = 30000;

  /**
   * Initialize the connectivity monitoring to auto-sync readings when online
   * Call this when the app starts or when a user logs in
   */
  static initConnectivityMonitoring(userId: string) {
    // If we already have an active connection, clean it up first
    if (this.netInfoUnsubscribe) {
      this.netInfoUnsubscribe();
      this.netInfoUnsubscribe = null;
    }
    
    // Make sure any existing sync throttle timeouts are cleared
    if (this.syncThrottleTimeout) {
      clearTimeout(this.syncThrottleTimeout);
      this.syncThrottleTimeout = null;
    }
    
    // Reset sync locks when reinitializing
    this.syncLock = {};
    
    // Store the active user ID
    this.activeUserId = userId;
    this.isFirstConnect = true;
    
    // Start monitoring network state
    this.netInfoUnsubscribe = NetInfo.addEventListener(this.handleConnectivityChange);
    
    console.log(`[MeasurementService] Started connectivity monitoring for user: ${userId}`);
    
    // Check current connectivity state - don't need to sync immediately
    // as HomeScreen already handles initial sync
    NetInfo.fetch().then(state => {
      // Only update the isFirstConnect flag without running sync
      if (state.isConnected && state.isInternetReachable !== false) {
        this.isFirstConnect = false;
      }
    });
  }
  
  /**
   * Stop connectivity monitoring - call when user logs out
   */
  static stopConnectivityMonitoring() {
    if (this.netInfoUnsubscribe) {
      this.netInfoUnsubscribe();
      this.netInfoUnsubscribe = null;
    }
    this.activeUserId = null;
    console.log('[MeasurementService] Stopped connectivity monitoring');
  }
  
  /**
   * Handle connectivity status changes
   */
  private static handleConnectivityChange = async (state: NetInfoState) => {
    // Skip the very first connect event to avoid duplicate syncing when app starts
    if (this.isFirstConnect) {
      this.isFirstConnect = false;
      console.log('[MeasurementService] Skipping initial connectivity event to prevent duplicate syncs');
      return;
    }
    
    // Clear any pending sync throttle timeouts
    if (this.syncThrottleTimeout) {
      clearTimeout(this.syncThrottleTimeout);
      this.syncThrottleTimeout = null;
    }
    
    if (state.isConnected && state.isInternetReachable !== false && this.activeUserId) {
      // Check if we're already syncing for this user or synced too recently
      if (this.syncLock[this.activeUserId]) {
        console.log(`[MeasurementService] Skipping connectivity sync because one is already in progress for user ${this.activeUserId}`);
        return;
      }
      
      // Check if we've synced too recently
      const now = Date.now();
      const lastSync = this.lastSyncTimestamp[this.activeUserId] || 0;
      if (now - lastSync < this.MIN_SYNC_INTERVAL) {
        console.log(`[MeasurementService] Skipping connectivity sync - last sync was only ${(now - lastSync) / 1000} seconds ago`);
        return;
      }
      
      console.log('[MeasurementService] Internet connectivity restored - syncing offline readings');
      
      // Use throttle to prevent multiple syncs close together
      this.syncThrottleTimeout = setTimeout(async () => {
        try {
          // Double-check connectivity before attempting sync
          const currentState = await NetInfo.fetch();
          if (currentState.isConnected && currentState.isInternetReachable !== false && this.activeUserId) {
            console.log('[MeasurementService] Executing delayed sync after connectivity restored');
            await this.syncOfflineReadingsForUser(this.activeUserId);
          } else {
            console.log('[MeasurementService] Skipping delayed sync - connection lost again');
          }
        } catch (error) {
          console.error('[MeasurementService] Error in throttled connectivity sync:', error);
        } finally {
          this.syncThrottleTimeout = null;
        }
      }, 3000); // 3 second delay
    }
  }

  /**
   * Manually trigger a sync of offline readings
   */
  static async syncOfflineReadingsForUser(userId: string): Promise<boolean> {
    // Check if a sync is already in progress for this user
    if (this.syncLock[userId]) {
      console.log(`[MeasurementService] Sync already in progress for user ${userId}, skipping duplicate request`);
      return false;
    }
    
    // Check if we've synced too recently
    const now = Date.now();
    const lastSync = this.lastSyncTimestamp[userId] || 0;
    if (now - lastSync < this.MIN_SYNC_INTERVAL) {
      console.log(`[MeasurementService] Skipping manual sync - last sync was only ${(now - lastSync) / 1000} seconds ago`);
      return false;
    }
    
    try {
      // Set sync lock for this user
      this.syncLock[userId] = true;
      
      // Check if we have offline readings before proceeding
      const offlineReadingsStr = await AsyncStorage.getItem(`${OFFLINE_READINGS_KEY}_${userId}`);
      if (!offlineReadingsStr) {
        console.log(`[MeasurementService] No offline readings to sync for user ${userId}`);
        this.syncLock[userId] = false;
        this.lastSyncTimestamp[userId] = now;
        return false;
      }
      
      const offlineReadings = JSON.parse(offlineReadingsStr);
      if (offlineReadings.length === 0) {
        console.log(`[MeasurementService] No offline readings to sync for user ${userId}`);
        this.syncLock[userId] = false;
        this.lastSyncTimestamp[userId] = now;
        return false;
      }
      
      await this.syncOfflineReadings(userId);
      
      // Update last sync timestamp
      this.lastSyncTimestamp[userId] = Date.now();
      
      // Release sync lock
      this.syncLock[userId] = false;
      
      console.log(`[MeasurementService] Offline readings successfully synced`);
      return true;
    } catch (error) {
      console.error('[MeasurementService] Manual sync error:', error);
      
      // Release sync lock even on error
      this.syncLock[userId] = false;
      
      // Still update timestamp to prevent rapid retries
      this.lastSyncTimestamp[userId] = Date.now();
      return false;
    }
  }

  /**
   * Get multiple glucose readings for a user
   */
  static async getReadings(
    userId: string,
    options: ReadingFilterOptions = {}
  ): Promise<GlucoseReading[]> {
    try {
      // Get both online and offline readings
      const onlineReadings = await this.getOnlineReadings(userId, options);
      const offlineReadings = await this.getOfflineReadings(userId);
      
      // Combine and sort them
      const allReadings = [...onlineReadings, ...offlineReadings].sort(
        (a, b) => b.timestamp.getTime() - a.timestamp.getTime()
      );
      
      // Apply any limits from options
      if (options.limit && allReadings.length > options.limit) {
        return allReadings.slice(0, options.limit);
      }
      
      return allReadings;
    } catch (error) {
      console.error('Error fetching readings:', error);
      
      // If online reading fails, return just offline readings
      try {
        const offlineReadings = await this.getOfflineReadings(userId);
        return offlineReadings;
      } catch (offlineError) {
        console.error('Error fetching offline readings:', offlineError);
        return [];
      }
    }
  }

  /**
   * Get readings from Firestore
   */
  private static async getOnlineReadings(
    userId: string,
    options: ReadingFilterOptions = {}
  ): Promise<GlucoseReading[]> {
    try {
      const readingsRef = collection(db, 'users', userId, 'measurements');
      
      // Start building the query
      let queryConstraints: any[] = [];
      queryConstraints.push(orderBy('timestamp', 'desc'));

      // Apply timeframe filter if specified
      if (options.timeframe && options.timeframe !== 'all') {
        const now = new Date();
        let startTime: Date;
        
        switch (options.timeframe) {
          case 'hour':
            startTime = new Date(now.getTime() - 60 * 60 * 1000); // 1 hour ago
            break;
          case 'day':
            startTime = new Date(now.getTime() - 24 * 60 * 60 * 1000); // 24 hours ago
            break;
          case 'week':
            startTime = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000); // 7 days ago
            break;
          case 'month':
            startTime = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000); // 30 days ago
            break;
        }
        
        // Convert JavaScript Date to Firestore Timestamp before adding to query
        const firestoreTimestamp = Timestamp.fromDate(startTime);
        queryConstraints.push(where('timestamp', '>=', firestoreTimestamp));
        
        console.log(`Filtering by timeframe: ${options.timeframe}, date: ${startTime.toISOString()}`);
      }

      // Apply date range if specified
      if (options.startDate) {
        const startTimestamp = Timestamp.fromDate(options.startDate);
        queryConstraints.push(where('timestamp', '>=', startTimestamp));
      }
      
      if (options.endDate) {
        const endTimestamp = Timestamp.fromDate(options.endDate);
        queryConstraints.push(where('timestamp', '<=', endTimestamp));
      }
      
      // Apply filter for alerts if specified
      if (options.onlyAlerts) {
        queryConstraints.push(where('isAlert', '==', true));
      }
      
      // Apply limit if specified
      if (options.limit) {
        queryConstraints.push(limit(options.limit));
      }
      
      // Execute the query
      const q = query(readingsRef, ...queryConstraints);
      const querySnapshot = await getDocs(q);
      
      // Process the results
      const readings: GlucoseReading[] = [];
      querySnapshot.forEach((doc) => {
        const data = doc.data();
        readings.push({
          id: doc.id,
          value: data.value,
          timestamp: data.timestamp.toDate(),
          comment: data.comment,
          isAlert: data.isAlert
        });
      });
      
      return readings;
    } catch (error) {
      console.error('Error fetching online readings:', error);
      throw error;
    }
  }

  /**
   * Get readings stored offline
   */
  private static async getOfflineReadings(userId: string): Promise<GlucoseReading[]> {
    try {
      const offlineReadingsStr = await AsyncStorage.getItem(`${OFFLINE_READINGS_KEY}_${userId}`);
      if (!offlineReadingsStr) return [];
      
      // Parse stored readings
      const offlineReadings = JSON.parse(offlineReadingsStr);
      
      // Convert string timestamps back to Date objects
      return offlineReadings.map((reading: any) => ({
        ...reading,
        timestamp: new Date(reading.timestamp)
      }));
    } catch (error) {
      console.error('Error fetching offline readings:', error);
      return [];
    }
  }

  /**
   * Get a single reading by ID
   */
  static async getReading(userId: string, readingId: string): Promise<GlucoseReading | null> {
    try {
      const readingDocRef = doc(db, 'users', userId, 'measurements', readingId);
      const readingDoc = await getDoc(readingDocRef);
      
      if (!readingDoc.exists()) {
        return null;
      }
      
      const data = readingDoc.data();
      return {
        id: readingDoc.id,
        value: data.value,
        timestamp: data.timestamp.toDate(),
        comment: data.comment,
        isAlert: data.isAlert
      };
    } catch (error) {
      console.error('Error fetching reading:', error);
      throw error;
    }
  }

  /**
   * Add a new glucose reading
   */
  static async addReading(userId: string, reading: GlucoseReading): Promise<string> {
    try {
      // First check for any offline readings and try to sync them BEFORE adding a new reading
      // This prevents the issue where we sync after adding and might create duplicates
      const netInfo = await NetInfo.fetch();
      
      if (netInfo.isConnected) {
        // Handle any pending offline readings first - only if no other sync is in progress
        if (!this.syncLock[userId]) {
          const now = Date.now();
          const lastSync = this.lastSyncTimestamp[userId] || 0;
          const timeSinceLastSync = now - lastSync;
          
          // Only sync if it's been more than MIN_SYNC_INTERVAL since last sync
          if (timeSinceLastSync >= this.MIN_SYNC_INTERVAL) {
            try {
              await this.syncOfflineReadingsForUser(userId);
              console.log('[MeasurementService] Pre-emptively synced offline readings before adding new reading');
            } catch (syncError) {
              console.error('[MeasurementService] Error syncing offline readings before new reading:', syncError);
              // Continue with the current operation even if sync fails
            }
          } else {
            console.log(`[MeasurementService] Skipped pre-emptive sync - last sync was only ${timeSinceLastSync / 1000} seconds ago`);
          }
        } else {
          console.log('[MeasurementService] Skipped pre-emptive sync since another sync is already in progress');
        }
        
        // Mark all user-initiated readings as sensor readings to bypass strict duplicate detection
        // This is important to ensure manually entered readings are never considered duplicates
        const isSensorOrManualReading = reading.isSensorActivationReading === true || 
                                        reading._isSensorReading === true || 
                                        reading._isManualReading === true;
                                        
        // Reference to Firestore collection
        const readingsRef = collection(db, 'users', userId, 'measurements');
        
        // Determine if we need to do minimal duplicate protection
        // This only protects against rapid double-tap submissions within a 3-second window
        let skipDuplicateCheck = true; // Default to skipping strict checks
        
        if (!isSensorOrManualReading) {
          // Only do a very basic duplicate check for multi-tap prevention (3 seconds)
          // This is just to prevent UI double-submission issues
          const threeSecondsAgo = new Date(Date.now() - 3000);
          const q = query(
            readingsRef,
            where('timestamp', '>=', Timestamp.fromDate(threeSecondsAgo)),
            orderBy('timestamp', 'desc'),
            limit(3) // Just check the most recent 3 readings
          );
          
          const recentSnapshot = await getDocs(q);
          
          // Only check exact value and almost exact time (double-submission protection)
          recentSnapshot.forEach(doc => {
            const data = doc.data();
            if (data.value === reading.value && 
                Math.abs(data.timestamp.toDate().getTime() - reading.timestamp.getTime()) < 3000) {
              console.log('[MeasurementService] Preventing duplicate submission within 3 seconds');
              skipDuplicateCheck = false;
            }
          });
        }
        
        if (skipDuplicateCheck) {
          // Store reading in Firebase
          const readingData = {
            value: reading.value,
            timestamp: reading.timestamp,
            comment: reading.comment || '',
            isAlert: reading.isAlert || false,
            createdAt: serverTimestamp(),
            // Store source flags
            isSensorReading: isSensorOrManualReading,
            isSensorActivationReading: reading.isSensorActivationReading === true,
            isManualReading: reading._isManualReading === true
          };
          
          const docRef = await addDoc(readingsRef, readingData);
          console.log(`[MeasurementService] Saved reading: ${reading.value} mg/dL`);
          
          // Emit event
          const readingWithId = { ...reading, id: docRef.id };
          GlucoseReadingEvents.getInstance().emitNewReading(readingWithId);
          
          return docRef.id;
        } else {
          // This is a UI double-submission prevention only
          console.log('[MeasurementService] Prevented duplicate submission (UI double tap protection)');
          const fakeId = `prevented_duptap_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
          
          // Still emit the event for UI, but mark it with special flag
          const readingWithId = { 
            ...reading, 
            id: fakeId,
            _isPreventedDoubleTap: true
          };
          
          GlucoseReadingEvents.getInstance().emitNewReading(readingWithId);
          return fakeId;
        }
      } else {
        // Offline - store locally
        return await this.storeOfflineReading(userId, reading);
      }
    } catch (error) {
      console.error('Error adding reading:', error);
      
      // If Firebase fails, store locally
      try {
        return await this.storeOfflineReading(userId, reading);
      } catch (offlineError) {
        console.error('Error storing offline reading:', offlineError);
        throw error;
      }
    }
  }

  /**
   * Store a reading offline
   */
  private static async storeOfflineReading(userId: string, reading: GlucoseReading): Promise<string> {
    try {
      // Create a temporary ID
      const tempId = `offline_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
      
      // Get existing offline readings
      const existingReadingsStr = await AsyncStorage.getItem(`${OFFLINE_READINGS_KEY}_${userId}`);
      const existingReadings = existingReadingsStr ? JSON.parse(existingReadingsStr) : [];
      
      // Determine the correct flags based on reading source
      const isManualReading = reading._isManualReading === true;
      const isSensorReading = reading._isSensorReading === true || reading.isSensorActivationReading === true;
      
      // Check if reading should trigger an alert
      const isAlert = reading.isAlert || this.shouldTriggerAlert(reading.value);
      
      // Add auto comment for alert readings if no existing comment
      let comment = reading.comment;
      if (isAlert && !comment) {
        const alertType = reading.value < 70 ? 'Low' : 'High';
        comment = `${alertType} glucose alert - automatically detected (offline)`;
      }
      
      // Add new reading with all properties preserved
      const readingWithId = {
        ...reading,
        id: tempId,
        _isOffline: true,
        // Make sure alert flag is set correctly
        isAlert: isAlert,
        // Add the auto comment if applicable
        comment: comment,
        // Preserve these critical flags for sync
        isSensorActivationReading: reading.isSensorActivationReading || false,
        // Mark all readings as appropriate type
        isSensorReading: isSensorReading || false,
        isManualReading: isManualReading || true // Default to true if not explicitly set
      };
      
      // Store in array (convert Date to string first)
      const readingToStore = {
        ...readingWithId,
        timestamp: reading.timestamp.toISOString()
      };
      
      // Only check for extreme duplicates (exact timestamp and value) within 1-second window
      // This only prevents multiple rapid submissions of the exact same reading
      let isDuplicate = false;
      const lastSecond = new Date(reading.timestamp.getTime() - 1000);
      
      for (const existingReading of existingReadings) {
        const existingTimestamp = new Date(existingReading.timestamp).getTime();
        const newTimestamp = reading.timestamp.getTime();
        
        // Consider a duplicate ONLY if exact same value and within 1 second (double-submission protection)
        if (existingReading.value === reading.value && 
            Math.abs(existingTimestamp - newTimestamp) <= 1000) {
          isDuplicate = true;
          console.log(`[MeasurementService] Preventing duplicate offline submission: ${reading.value} mg/dL`);
          break;
        }
      }
      
      // Add reading to storage unless it's a double-submission
      if (!isDuplicate) {
        existingReadings.push(readingToStore);
        
        // Save back to AsyncStorage
        await AsyncStorage.setItem(
          `${OFFLINE_READINGS_KEY}_${userId}`,
          JSON.stringify(existingReadings)
        );
        
        console.log(`[MeasurementService] Stored reading offline (${reading.value} mg/dL)`);
      } else {
        console.log(`[MeasurementService] Skipped storing duplicate offline submission`);
      }
      
      // Always emit event for the UI
      GlucoseReadingEvents.getInstance().emitNewReading(readingWithId);
      
      return tempId;
    } catch (error) {
      console.error('Error storing offline reading:', error);
      throw error;
    }
  }

  /**
   * Check if a reading should be considered a duplicate based on various criteria
   * @param value The glucose value to check
   * @param timestamp The timestamp to check
   * @param existingReadings Map of existing readings with combined timestamp+value keys
   * @param existingReadingsByValue Map of existing readings grouped by value
   * @returns boolean True if this appears to be a duplicate
   */
  private static isDuplicateReading(
    value: number,
    timestamp: Date,
    existingReadings: Map<string, boolean>,
    existingReadingsByValue: Map<number, Date[]>
  ): boolean {
    // Check exact key
    const exactKey = `${timestamp.getTime()}_${value}`;
    if (existingReadings.has(exactKey)) {
      return true;
    }
    
    // Check minute-precision key (being exact on the minute is still a clear duplicate)
    const minuteTimestamp = new Date(
      timestamp.getFullYear(),
      timestamp.getMonth(),
      timestamp.getDate(),
      timestamp.getHours(),
      timestamp.getMinutes()
    ).getTime();
    const minuteKey = `${minuteTimestamp}_${value}`;
    if (existingReadings.has(minuteKey)) {
      return true;
    }
    
    // Check for time proximity for this exact value only, with a tight window
    // This will find readings with exact same value that are very close in time
    const timestamps = existingReadingsByValue.get(value);
    
    if (timestamps) {
      for (const existingTime of timestamps) {
        // Check if within 1 minute
        const timeDiff = Math.abs(existingTime.getTime() - timestamp.getTime());
        if (timeDiff <= 60 * 1000) { // 1 minute in milliseconds
          return true;
        }
      }
    }
    
    // Much less aggressive checking for similar values
    // Only check exact +/- 1 value with very tight time window (30 seconds)
    for (let offset = -1; offset <= 1; offset++) {
      if (offset === 0) continue;
      const checkValue = value + offset;
      const timestamps = existingReadingsByValue.get(checkValue);
      
      if (timestamps) {
        for (const existingTime of timestamps) {
          // Check if within 30 seconds
          const timeDiff = Math.abs(existingTime.getTime() - timestamp.getTime());
          if (timeDiff <= 30 * 1000) { // 30 seconds in milliseconds
            return true;
          }
        }
      }
    }
    
    // Not a duplicate
    return false;
  }

  /**
   * Sync offline readings to Firebase when online
   */
  private static async syncOfflineReadings(userId: string): Promise<void> {
    try {
      // Check if we're online first
      const netInfo = await NetInfo.fetch();
      if (!netInfo.isConnected || netInfo.isInternetReachable === false) {
        console.log('[MeasurementService] Cannot sync - no internet connection');
        return;
      }
      
      // Get offline readings
      const offlineReadingsStr = await AsyncStorage.getItem(`${OFFLINE_READINGS_KEY}_${userId}`);
      if (!offlineReadingsStr) return;
      
      const offlineReadings = JSON.parse(offlineReadingsStr);
      if (offlineReadings.length === 0) return;
      
      console.log(`[MeasurementService] Syncing ${offlineReadings.length} offline readings`);
      
      // Reference to Firestore collection
      const readingsRef = collection(db, 'users', userId, 'measurements');
      
      // Track readings that were synced vs failed
      let syncedCount = 0;
      let failedCount = 0;
      
      // Prepare a new array to store only offline readings that failed to sync
      const failedToSyncReadings: any[] = [];
      
      // Create a set to track readings already processed in this sync batch
      // This prevents syncing the same reading multiple times if there are duplicates in offline storage
      const processedReadingsInBatch = new Set<string>();
      
      // Upload each reading, avoiding only exact duplicates
      const uploadPromises = offlineReadings.map(async (offlineReading: any) => {
        try {
          // Convert string timestamp back to Date
          const readingTimestamp = new Date(offlineReading.timestamp);
          const readingValue = offlineReading.value;
          
          // Create a unique key for this reading to prevent duplicate syncing in the same batch
          const readingKey = `${readingTimestamp.getTime()}_${readingValue}`;
          
          // Skip if we've already processed this exact reading in this batch
          if (processedReadingsInBatch.has(readingKey)) {
            console.log(`[MeasurementService] Skipping duplicate in offline batch: ${readingValue} mg/dL`);
            syncedCount++; // Count as "handled"
            return { success: true, isDuplicate: true };
          }
          
          // Mark as processed in this batch
          processedReadingsInBatch.add(readingKey);
          
          // Save to Firebase with minimal validation
          const readingData = {
            value: readingValue,
            timestamp: readingTimestamp,
            comment: offlineReading.comment || '',
            isAlert: offlineReading.isAlert || false,
            createdAt: serverTimestamp(),
            fromOfflineSync: true,
            // Copy these exact flags from the offline reading
            isSensorReading: offlineReading.isSensorReading === true || true, // Default to true for backwards compatibility
            isSensorActivationReading: offlineReading.isSensorActivationReading === true,
            isManualReading: offlineReading.isManualReading === true
          };
          
          const docRef = await addDoc(readingsRef, readingData);
          console.log(`[MeasurementService] Synced offline reading: ${readingValue} mg/dL`);
          syncedCount++;
          
          // Send event for the UI to update with Firebase ID
          const syncedReading = {
            ...offlineReading,
            id: docRef.id,
            _isOffline: false,
            _wasSynced: true
          };
          
          // Try to notify any open UIs that this reading was synced
          try {
            GlucoseReadingEvents.getInstance().emitReadingSynced(syncedReading);
          } catch (eventError) {
            console.error('[MeasurementService] Error emitting sync event:', eventError);
          }
          
          return { success: true };
        } catch (error) {
          console.error('[MeasurementService] Error uploading offline reading:', error);
          // Add this reading to the failed list
          failedToSyncReadings.push(offlineReading);
          failedCount++;
          return { success: false };
        }
      });
      
      // Wait for all uploads to complete
      await Promise.all(uploadPromises);
      
      // Update offline storage to only keep readings that failed to sync
      await AsyncStorage.setItem(`${OFFLINE_READINGS_KEY}_${userId}`, JSON.stringify(failedToSyncReadings));
      
      console.log(`[MeasurementService] Offline readings sync complete. Synced: ${syncedCount}, Failed: ${failedCount}`);
      
      // If we have any remaining failed readings, we'll leave them for next time
      if (failedCount > 0) {
        console.log(`[MeasurementService] ${failedCount} readings failed to sync and will be retried later`);
      }
    } catch (error) {
      console.error('Error syncing offline readings:', error);
    }
  }

  /**
   * Update an existing glucose reading
   */
  static async updateReading(
    userId: string,
    readingId: string,
    updates: Partial<GlucoseReading>
  ): Promise<void> {
    try {
      const readingDocRef = doc(db, 'users', userId, 'measurements', readingId);
      
      // Remove id from updates if it exists since it's not a field in Firestore
      const { id, ...updateData } = updates;
      
      await updateDoc(readingDocRef, updateData);
    } catch (error) {
      console.error('Error updating reading:', error);
      throw error;
    }
  }

  /**
   * Delete a glucose reading
   */
  static async deleteReading(userId: string, readingId: string): Promise<void> {
    try {
      const readingDocRef = doc(db, 'users', userId, 'measurements', readingId);
      await deleteDoc(readingDocRef);
    } catch (error) {
      console.error('Error deleting reading:', error);
      throw error;
    }
  }

  /**
   * Get the latest reading for a user
   */
  static async getLatestReading(userId: string): Promise<GlucoseReading | null> {
    try {
      // Get both online and offline readings
      const onlineReadings = await this.getOnlineReadings(userId, { limit: 1 });
      const offlineReadings = await this.getOfflineReadings(userId);
      
      // Combine and sort them
      const allReadings = [...onlineReadings, ...offlineReadings].sort(
        (a, b) => b.timestamp.getTime() - a.timestamp.getTime()
      );
      
      return allReadings.length > 0 ? allReadings[0] : null;
    } catch (error) {
      console.error('Error fetching latest reading:', error);
      
      // If online fails, try offline
      try {
        const offlineReadings = await this.getOfflineReadings(userId);
        if (offlineReadings.length === 0) return null;
        
        // Sort by timestamp descending and return first
        offlineReadings.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
        return offlineReadings[0];
      } catch (offlineError) {
        console.error('Error fetching offline latest reading:', offlineError);
        return null;
      }
    }
  }

  /**
   * Get all alerts for a user
   */
  static async getAlerts(userId: string, options: ReadingFilterOptions = {}): Promise<GlucoseReading[]> {
    return this.getReadings(userId, { ...options, onlyAlerts: true });
  }

  /**
   * Get hourly readings from the past 60 minutes
   * Returns individual readings at their exact timestamps
   */
  static async getHourlyReadings(userId: string): Promise<GlucoseReading[]> {
    try {
      // First get the latest reading
      const latestReading = await this.getLatestReading(userId);
      
      if (!latestReading) {
        return []; // No readings available
      }
      
      // Calculate the time 60 minutes before the latest reading
      const latestTime = latestReading.timestamp;
      const sixtyMinutesAgo = new Date(latestTime.getTime() - 60 * 60 * 1000);
      
      // Custom options to get readings between sixtyMinutesAgo and latestTime
      const readings = await this.getReadings(userId, {
        startDate: sixtyMinutesAgo,
        endDate: latestTime,
        limit: 60 // Up to 60 readings (one per minute)
      });
      
      return readings.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
    } catch (error) {
      console.error('Error fetching hourly readings:', error);
      throw error;
    }
  }

  /**
   * Get daily readings from the past 24 hours
   * Calculates average glucose per hour
   */
  static async getDailyReadings(userId: string): Promise<GlucoseReading[]> {
    try {
      // Get the latest reading
      const latestReading = await this.getLatestReading(userId);
      
      if (!latestReading) {
        return []; // No readings available
      }
      
      // Calculate the time 24 hours before the latest reading
      const latestTime = latestReading.timestamp;
      const twentyFourHoursAgo = new Date(latestTime.getTime() - 24 * 60 * 60 * 1000);
      
      // Get all readings in the past 24 hours
      const allReadings = await this.getReadings(userId, {
        startDate: twentyFourHoursAgo,
        endDate: latestTime
      });
      
      // Group by hour and calculate averages
      const hourlyAverages: GlucoseReading[] = [];
      
      // Create 24 hour slots and calculate average for each
      for (let i = 0; i < 24; i++) {
        // Only include significant hours for a cleaner chart
        const isSignificantHour = i % 3 === 0; // Show every 3 hours
        
        // Calculate the hour start and end times
        const hourStart = new Date(latestTime);
        hourStart.setHours(latestTime.getHours() - i, 0, 0, 0);
        
        const hourEnd = new Date(hourStart);
        hourEnd.setHours(hourStart.getHours() + 1, 0, 0, 0);
        
        // Find readings within this hour
        const hourReadings = allReadings.filter(reading => {
          const readingTime = reading.timestamp;
          return readingTime >= hourStart && readingTime < hourEnd;
        });
        
        if (hourReadings.length > 0) {
          // Calculate average glucose for this hour
          const totalGlucose = hourReadings.reduce((sum, reading) => sum + reading.value, 0);
          const averageGlucose = Math.round(totalGlucose / hourReadings.length);
          
          hourlyAverages.push({
            value: averageGlucose,
            timestamp: hourStart,
            comment: `Average of ${hourReadings.length} readings`
          });
        } 
        // Only add empty placeholders for significant hours to avoid cluttering
        else if (isSignificantHour) {
          hourlyAverages.push({
            value: 0, // Use 0 as placeholder for no data
            timestamp: hourStart,
            comment: 'No data for this hour'
          });
        }
      }
      
      // Return sorted by timestamp (oldest to newest)
      return hourlyAverages.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
    } catch (error) {
      console.error('Error calculating daily readings:', error);
      throw error;
    }
  }

  /**
   * Get weekly readings
   * Returns daily averages for the past 7 days
   */
  static async getWeeklyReadings(userId: string): Promise<GlucoseReading[]> {
    try {
      // Get the latest reading
      const latestReading = await this.getLatestReading(userId);
      
      if (!latestReading) {
        return []; // No readings available
      }
      
      // Calculate the time 7 days before the latest reading
      const latestTime = latestReading.timestamp;
      const sevenDaysAgo = new Date(latestTime.getTime() - 7 * 24 * 60 * 60 * 1000);
      
      // Get all readings in the past 7 days
      const allReadings = await this.getReadings(userId, {
        startDate: sevenDaysAgo,
        endDate: latestTime
      });
      
      // Group by day and calculate averages
      const dailyAverages: GlucoseReading[] = [];
      
      // Create 7 day slots and calculate average for each
      for (let i = 0; i < 7; i++) {
        // Calculate the day start and end times
        const dayStart = new Date(latestTime);
        dayStart.setDate(latestTime.getDate() - i);
        dayStart.setHours(0, 0, 0, 0);
        
        const dayEnd = new Date(dayStart);
        dayEnd.setDate(dayStart.getDate() + 1);
        
        // Find readings within this day
        const dayReadings = allReadings.filter(reading => {
          const readingTime = reading.timestamp;
          return readingTime >= dayStart && readingTime < dayEnd;
        });
        
        // Always add a data point for each day
        if (dayReadings.length > 0) {
          // Calculate average glucose for this day
          const totalGlucose = dayReadings.reduce((sum, reading) => sum + reading.value, 0);
          const averageGlucose = Math.round(totalGlucose / dayReadings.length);
          
          dailyAverages.push({
            value: averageGlucose,
            timestamp: dayStart,
            comment: `Average of ${dayReadings.length} readings for ${dayStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`
          });
        } else {
          // No data for this day - add placeholder
          dailyAverages.push({
            value: 0, // Use 0 as placeholder for no data
            timestamp: dayStart,
            comment: `No data for ${dayStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`
          });
        }
      }
      
      // Return sorted by timestamp (oldest to newest)
      return dailyAverages.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
    } catch (error) {
      console.error('Error calculating weekly readings:', error);
      throw error;
    }
  }

  /**
   * Clear all readings for a user (for development/testing only)
   * USE WITH CAUTION - this permanently deletes data
   */
  static async clearReadings(userId: string): Promise<void> {
    try {
      const readingsRef = collection(db, 'users', userId, 'measurements');
      const querySnapshot = await getDocs(readingsRef);
      
      const batch: Promise<void>[] = [];
      querySnapshot.forEach((doc) => {
        batch.push(deleteDoc(doc.ref));
      });
      
      // Execute all delete operations
      await Promise.all(batch);
      
      // Also clear offline readings
      await AsyncStorage.setItem(`${OFFLINE_READINGS_KEY}_${userId}`, JSON.stringify([]));
      
      console.log(`Cleared ${batch.length} readings for user ${userId}`);
    } catch (error) {
      console.error('Error clearing readings:', error);
      throw error;
    }
  }

  /**
   * Determine if a glucose reading should trigger an alert
   */
  private static shouldTriggerAlert(value: number): boolean {
    // Define standard thresholds for alerts
    const LOW_THRESHOLD = 70;
    const HIGH_THRESHOLD = 180;
    
    // Check if value is outside normal range
    return value < LOW_THRESHOLD || value > HIGH_THRESHOLD;
  }
}

export default MeasurementService; 