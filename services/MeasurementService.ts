import { collection, doc, query, where, orderBy, limit, getDocs, getDoc, addDoc, updateDoc, deleteDoc, Timestamp, serverTimestamp } from 'firebase/firestore';
import { db } from '../firebase';

// Interface for glucose readings
export interface GlucoseReading {
  id?: string;
  value: number;
  timestamp: Date;
  comment?: string;
  isAlert?: boolean;
}

// Type for filtering options
interface ReadingFilterOptions {
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
  /**
   * Get multiple glucose readings for a user
   */
  static async getReadings(
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
      console.error('Error fetching readings:', error);
      throw error;
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
      const readingsRef = collection(db, 'users', userId, 'measurements');
      
      // Convert Date to Firestore Timestamp
      const readingData = {
        value: reading.value,
        timestamp: reading.timestamp,
        comment: reading.comment || '',
        isAlert: reading.isAlert || false,
        createdAt: serverTimestamp()
      };
      
      const docRef = await addDoc(readingsRef, readingData);
      return docRef.id;
    } catch (error) {
      console.error('Error adding reading:', error);
      throw error;
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
      const readings = await this.getReadings(userId, { limit: 1 });
      return readings.length > 0 ? readings[0] : null;
    } catch (error) {
      console.error('Error fetching latest reading:', error);
      throw error;
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
   * Get daily readings aggregated by hour
   * Returns 24 data points representing hourly averages
   */
  static async getDailyReadings(userId: string): Promise<GlucoseReading[]> {
    try {
      // Get all readings from the past 24 hours
      const readings = await this.getReadings(userId, {
        timeframe: 'day'
      });
      
      // Group readings by hour and calculate averages
      const hourlyAverages: GlucoseReading[] = [];
      const now = new Date();
      
      // For charting, we'll create data points at regular intervals
      // Create buckets for specific hours to avoid cluttering (every 2-3 hours)
      const significantHours = [0, 3, 6, 9, 12, 15, 18, 21]; // Every 3 hours
      
      // Create buckets for each of the past 24 hours
      for (let i = 0; i < 24; i++) {
        // Only include significant hours for a cleaner chart
        const isSignificantHour = significantHours.includes(now.getHours() - i >= 0 ? 
                                   (now.getHours() - i) : 
                                   (now.getHours() - i + 24));
        
        const hourStart = new Date(now);
        hourStart.setHours(now.getHours() - i);
        hourStart.setMinutes(0, 0, 0);
        
        const hourEnd = new Date(hourStart);
        hourEnd.setHours(hourStart.getHours() + 1);
        
        // Filter readings that fall within this hour
        const hourReadings = readings.filter(reading => {
          const timestamp = reading.timestamp;
          return timestamp >= hourStart && timestamp < hourEnd;
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
   * Get weekly readings aggregated by day
   * Returns 7 data points representing daily averages
   */
  static async getWeeklyReadings(userId: string): Promise<GlucoseReading[]> {
    try {
      // Get all readings from the past 7 days
      const readings = await this.getReadings(userId, {
        timeframe: 'week'
      });
      
      // Group readings by day and calculate averages
      const dailyAverages: GlucoseReading[] = [];
      const now = new Date();
      
      // Create buckets for each of the past 7 days
      for (let i = 0; i < 7; i++) {
        const dayStart = new Date(now);
        dayStart.setDate(now.getDate() - i);
        dayStart.setHours(0, 0, 0, 0);
        
        const dayEnd = new Date(dayStart);
        dayEnd.setDate(dayStart.getDate() + 1);
        
        // Filter readings that fall within this day
        const dayReadings = readings.filter(reading => {
          const timestamp = reading.timestamp;
          return timestamp >= dayStart && timestamp < dayEnd;
        });
        
        if (dayReadings.length > 0) {
          // Calculate average glucose for this day
          const totalGlucose = dayReadings.reduce((sum, reading) => sum + reading.value, 0);
          const averageGlucose = Math.round(totalGlucose / dayReadings.length);
          
          dailyAverages.push({
            value: averageGlucose,
            timestamp: dayStart,
            comment: `Average of ${dayReadings.length} readings`
          });
        } else {
          // No readings for this day - add placeholder
          dailyAverages.push({
            value: 0, // Use 0 as placeholder for no data
            timestamp: dayStart,
            comment: 'No data for this day'
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
   * Create a mock reading for testing
   */
  static createMockReading(): GlucoseReading {
    // Generate a random value between 70 and 170
    const value = Math.floor(Math.random() * 100) + 70;
    
    return {
      value: Number.isFinite(value) ? value : 120, // Fallback to 120 if somehow we get an invalid value
      timestamp: new Date(),
      comment: Math.random() > 0.7 ? 'This is a mock reading' : undefined, // 30% chance to have a comment
      isAlert: value < 70 || value > 180 // Mark as alert if outside normal range
    };
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
      
      console.log(`Cleared ${batch.length} readings for user ${userId}`);
    } catch (error) {
      console.error('Error clearing readings:', error);
      throw error;
    }
  }
}

export default MeasurementService; 