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
}

export default MeasurementService; 