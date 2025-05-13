import { collection, doc, query, where, orderBy, getDocs, getDoc, addDoc, updateDoc, deleteDoc, serverTimestamp, Timestamp } from 'firebase/firestore';
import { db } from '../firebase/firebaseconfig';
import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo, { NetInfoState, NetInfoSubscription } from '@react-native-community/netinfo';

// Key for storing offline notes
const OFFLINE_NOTES_KEY = 'cgm_offline_notes';

// Interface for note object
export interface Note {
  id?: string;
  title: string;
  body: string;
  timestamp: Date;
  createdAt?: Date;
  _isOffline?: boolean;
}

/**
 * Service for handling notes with offline capability
 */
class NotesService {
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
   * Initialize the connectivity monitoring to auto-sync notes when online
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
    
    console.log(`[NotesService] Started connectivity monitoring for user: ${userId}`);
    
    // Check current connectivity state
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
    console.log('[NotesService] Stopped connectivity monitoring');
  }
  
  /**
   * Handle connectivity status changes
   */
  private static handleConnectivityChange = async (state: NetInfoState) => {
    // Skip the very first connect event to avoid duplicate syncing when app starts
    if (this.isFirstConnect) {
      this.isFirstConnect = false;
      console.log('[NotesService] Skipping initial connectivity event to prevent duplicate syncs');
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
        console.log(`[NotesService] Skipping connectivity sync because one is already in progress for user ${this.activeUserId}`);
        return;
      }
      
      // Check if we've synced too recently
      const now = Date.now();
      const lastSync = this.lastSyncTimestamp[this.activeUserId] || 0;
      if (now - lastSync < this.MIN_SYNC_INTERVAL) {
        console.log(`[NotesService] Skipping connectivity sync - last sync was only ${(now - lastSync) / 1000} seconds ago`);
        return;
      }
      
      console.log('[NotesService] Internet connectivity restored - syncing offline notes');
      
      // Use throttle to prevent multiple syncs close together
      this.syncThrottleTimeout = setTimeout(async () => {
        try {
          // Double-check connectivity before attempting sync
          const currentState = await NetInfo.fetch();
          if (currentState.isConnected && currentState.isInternetReachable !== false && this.activeUserId) {
            console.log('[NotesService] Executing delayed sync after connectivity restored');
            await this.syncOfflineNotesForUser(this.activeUserId);
          } else {
            console.log('[NotesService] Skipping delayed sync - connection lost again');
          }
        } catch (error) {
          console.error('[NotesService] Error in throttled connectivity sync:', error);
        } finally {
          this.syncThrottleTimeout = null;
        }
      }, 3000); // 3 second delay
    }
  }

  /**
   * Get all notes for a user (combining online and offline notes)
   */
  static async getNotes(userId: string): Promise<Note[]> {
    try {
      // Get online notes first
      let notes: Note[] = [];
      
      // Check if we're online
      const netInfo = await NetInfo.fetch();
      if (netInfo.isConnected && netInfo.isInternetReachable !== false) {
        // We're online - get from Firebase
        notes = await this.getOnlineNotes(userId);
      }
      
      // Get offline notes
      const offlineNotes = await this.getOfflineNotes(userId);
      
      // Combine and deduplicate
      const combinedNotes = [...notes];
      
      // Only add offline notes that aren't already in the online notes
      // (based on ID matching)
      const existingIds = new Set(notes.map(note => note.id));
      
      for (const offlineNote of offlineNotes) {
        if (!offlineNote.id || !existingIds.has(offlineNote.id)) {
          combinedNotes.push(offlineNote);
        }
      }
      
      // Sort by timestamp (newest first)
      return combinedNotes.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
    } catch (error) {
      console.error('Error getting notes:', error);
      throw error;
    }
  }

  /**
   * Get online notes from Firestore
   */
  private static async getOnlineNotes(userId: string): Promise<Note[]> {
    try {
      const notesRef = collection(db, 'users', userId, 'notes');
      const q = query(notesRef, orderBy('timestamp', 'desc'));
      const querySnapshot = await getDocs(q);
      
      const notes: Note[] = [];
      querySnapshot.forEach((doc) => {
        const data = doc.data();
        notes.push({
          id: doc.id,
          title: data.title,
          body: data.body,
          timestamp: data.timestamp.toDate(),
          createdAt: data.createdAt?.toDate()
        });
      });
      
      return notes;
    } catch (error) {
      console.error('Error getting online notes:', error);
      throw error;
    }
  }

  /**
   * Get cached offline notes
   */
  private static async getOfflineNotes(userId: string): Promise<Note[]> {
    try {
      const offlineNotesStr = await AsyncStorage.getItem(`${OFFLINE_NOTES_KEY}_${userId}`);
      if (!offlineNotesStr) return [];
      
      const offlineNotes = JSON.parse(offlineNotesStr);
      
      // Convert string timestamps back to Date objects
      return offlineNotes.map((note: any) => ({
        ...note,
        timestamp: new Date(note.timestamp),
        createdAt: note.createdAt ? new Date(note.createdAt) : undefined
      }));
    } catch (error) {
      console.error('Error getting offline notes:', error);
      return [];
    }
  }

  /**
   * Add a new note
   */
  static async addNote(userId: string, note: Note): Promise<string> {
    try {
      // Check if we're online
      const netInfo = await NetInfo.fetch();
      if (netInfo.isConnected && netInfo.isInternetReachable !== false) {
        // We're online - save to Firebase
        try {
          const notesRef = collection(db, 'users', userId, 'notes');
          const newNote = {
            title: note.title,
            body: note.body,
            timestamp: serverTimestamp(),
            createdAt: serverTimestamp()
          };
          
          const docRef = await addDoc(notesRef, newNote);
          return docRef.id;
        } catch (error) {
          console.error('Error adding note to Firebase:', error);
          // If Firebase fails, store locally
          return await this.storeOfflineNote(userId, note);
        }
      } else {
        // Offline - store locally
        return await this.storeOfflineNote(userId, note);
      }
    } catch (error) {
      console.error('Error adding note:', error);
      
      // If anything fails, try to store locally
      try {
        return await this.storeOfflineNote(userId, note);
      } catch (offlineError) {
        console.error('Error storing offline note:', offlineError);
        throw error;
      }
    }
  }

  /**
   * Store a note offline
   */
  private static async storeOfflineNote(userId: string, note: Note): Promise<string> {
    try {
      // Create a temporary ID
      const tempId = `offline_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
      
      // Get existing offline notes
      const existingNotesStr = await AsyncStorage.getItem(`${OFFLINE_NOTES_KEY}_${userId}`);
      const existingNotes = existingNotesStr ? JSON.parse(existingNotesStr) : [];
      
      // Add new note with all properties preserved
      const noteWithId = {
        ...note,
        id: tempId,
        _isOffline: true,
        timestamp: note.timestamp || new Date(),
        createdAt: note.createdAt || new Date()
      };
      
      // Store in array (convert Date to string first)
      const noteToStore = {
        ...noteWithId,
        timestamp: noteWithId.timestamp.toISOString(),
        createdAt: noteWithId.createdAt.toISOString()
      };
      
      // Add note to storage
      existingNotes.push(noteToStore);
      
      // Save back to AsyncStorage
      await AsyncStorage.setItem(
        `${OFFLINE_NOTES_KEY}_${userId}`,
        JSON.stringify(existingNotes)
      );
      
      console.log(`[NotesService] Stored note offline (${note.title})`);
      
      return tempId;
    } catch (error) {
      console.error('Error storing offline note:', error);
      throw error;
    }
  }

  /**
   * Update an existing note
   */
  static async updateNote(userId: string, noteId: string, updates: Partial<Note>): Promise<void> {
    try {
      // Check if this is an offline note (starts with 'offline_')
      const isOfflineNote = noteId.startsWith('offline_');
      
      // Check if we're online
      const netInfo = await NetInfo.fetch();
      if (netInfo.isConnected && netInfo.isInternetReachable !== false && !isOfflineNote) {
        // We're online and this is not an offline note - update in Firebase
        try {
          const noteRef = doc(db, 'users', userId, 'notes', noteId);
          await updateDoc(noteRef, {
            ...updates,
            timestamp: serverTimestamp()
          });
          return;
        } catch (error) {
          console.error('Error updating note in Firebase:', error);
          // If Firebase fails, update locally
          await this.updateOfflineNote(userId, noteId, updates);
        }
      } else {
        // Offline or this is an offline note - update locally
        await this.updateOfflineNote(userId, noteId, updates);
      }
    } catch (error) {
      console.error('Error updating note:', error);
      throw error;
    }
  }

  /**
   * Update a note in offline storage
   */
  private static async updateOfflineNote(userId: string, noteId: string, updates: Partial<Note>): Promise<void> {
    try {
      // Get existing offline notes
      const existingNotesStr = await AsyncStorage.getItem(`${OFFLINE_NOTES_KEY}_${userId}`);
      if (!existingNotesStr) {
        throw new Error('No offline notes found');
      }
      
      const existingNotes = JSON.parse(existingNotesStr);
      
      // Find the note to update
      const updatedNotes = existingNotes.map((note: any) => {
        if (note.id === noteId) {
          return {
            ...note,
            ...updates,
            timestamp: new Date().toISOString(),
            _isOffline: true
          };
        }
        return note;
      });
      
      // Save back to AsyncStorage
      await AsyncStorage.setItem(
        `${OFFLINE_NOTES_KEY}_${userId}`,
        JSON.stringify(updatedNotes)
      );
      
      console.log(`[NotesService] Updated note offline (${noteId})`);
    } catch (error) {
      console.error('Error updating offline note:', error);
      throw error;
    }
  }

  /**
   * Delete a note
   */
  static async deleteNote(userId: string, noteId: string): Promise<void> {
    try {
      // Check if this is an offline note (starts with 'offline_')
      const isOfflineNote = noteId.startsWith('offline_');
      
      // Check if we're online
      const netInfo = await NetInfo.fetch();
      if (netInfo.isConnected && netInfo.isInternetReachable !== false && !isOfflineNote) {
        // We're online and this is not an offline note - delete from Firebase
        try {
          const noteRef = doc(db, 'users', userId, 'notes', noteId);
          await deleteDoc(noteRef);
        } catch (error) {
          console.error('Error deleting note from Firebase:', error);
          // If Firebase fails, we'll still delete from local storage if the note exists there
        }
      }
      
      // Delete from offline storage if it exists there
      await this.deleteOfflineNote(userId, noteId);
    } catch (error) {
      console.error('Error deleting note:', error);
      throw error;
    }
  }

  /**
   * Delete a note from offline storage
   */
  private static async deleteOfflineNote(userId: string, noteId: string): Promise<void> {
    try {
      // Get existing offline notes
      const existingNotesStr = await AsyncStorage.getItem(`${OFFLINE_NOTES_KEY}_${userId}`);
      if (!existingNotesStr) return;
      
      const existingNotes = JSON.parse(existingNotesStr);
      
      // Filter out the note to delete
      const updatedNotes = existingNotes.filter((note: any) => note.id !== noteId);
      
      // Save back to AsyncStorage
      await AsyncStorage.setItem(
        `${OFFLINE_NOTES_KEY}_${userId}`,
        JSON.stringify(updatedNotes)
      );
      
      console.log(`[NotesService] Deleted note from offline storage (${noteId})`);
    } catch (error) {
      console.error('Error deleting offline note:', error);
      throw error;
    }
  }

  /**
   * Manually trigger a sync of offline notes
   */
  static async syncOfflineNotesForUser(userId: string): Promise<boolean> {
    // Check if a sync is already in progress for this user
    if (this.syncLock[userId]) {
      console.log(`[NotesService] Sync already in progress for user ${userId}, skipping duplicate request`);
      return false;
    }
    
    // Check if we've synced too recently
    const now = Date.now();
    const lastSync = this.lastSyncTimestamp[userId] || 0;
    if (now - lastSync < this.MIN_SYNC_INTERVAL) {
      console.log(`[NotesService] Skipping manual sync - last sync was only ${(now - lastSync) / 1000} seconds ago`);
      return false;
    }
    
    try {
      // Set sync lock for this user
      this.syncLock[userId] = true;
      
      // Check if we have offline notes before proceeding
      const offlineNotesStr = await AsyncStorage.getItem(`${OFFLINE_NOTES_KEY}_${userId}`);
      if (!offlineNotesStr) {
        console.log(`[NotesService] No offline notes to sync for user ${userId}`);
        this.syncLock[userId] = false;
        this.lastSyncTimestamp[userId] = now;
        return false;
      }
      
      const offlineNotes = JSON.parse(offlineNotesStr);
      if (offlineNotes.length === 0) {
        console.log(`[NotesService] No offline notes to sync for user ${userId}`);
        this.syncLock[userId] = false;
        this.lastSyncTimestamp[userId] = now;
        return false;
      }
      
      await this.syncOfflineNotes(userId);
      
      // Update last sync timestamp
      this.lastSyncTimestamp[userId] = Date.now();
      
      // Release sync lock
      this.syncLock[userId] = false;
      
      console.log(`[NotesService] Offline notes successfully synced`);
      return true;
    } catch (error) {
      console.error('Error syncing offline notes:', error);
      
      // Release the lock in case of error
      this.syncLock[userId] = false;
      
      throw error;
    }
  }

  /**
   * Sync offline notes to Firebase when online
   */
  private static async syncOfflineNotes(userId: string): Promise<void> {
    try {
      // Check if we're online first
      const netInfo = await NetInfo.fetch();
      if (!netInfo.isConnected || netInfo.isInternetReachable === false) {
        console.log('[NotesService] Cannot sync - no internet connection');
        return;
      }
      
      // Get offline notes
      const offlineNotesStr = await AsyncStorage.getItem(`${OFFLINE_NOTES_KEY}_${userId}`);
      if (!offlineNotesStr) return;
      
      const offlineNotes = JSON.parse(offlineNotesStr);
      if (offlineNotes.length === 0) return;
      
      console.log(`[NotesService] Syncing ${offlineNotes.length} offline notes`);
      
      // Reference to Firestore collection
      const notesRef = collection(db, 'users', userId, 'notes');
      
      // Track which notes have been synced so we can remove them from storage
      const syncedNoteIds: string[] = [];
      
      // Process each note
      for (const offlineNote of offlineNotes) {
        try {
          // Skip notes that don't appear to be offline (no _isOffline flag)
          // This is just a safety check in case non-offline notes got into storage
          if (!offlineNote._isOffline) {
            syncedNoteIds.push(offlineNote.id);
            continue;
          }
          
          // Prepare note data for Firestore (removing offline-specific fields)
          const { _isOffline, id, ...noteData } = offlineNote;
          
          // Convert string dates back to Firestore timestamps
          const firestoreNote = {
            ...noteData,
            timestamp: Timestamp.fromDate(new Date(offlineNote.timestamp)),
            createdAt: Timestamp.fromDate(new Date(offlineNote.createdAt || offlineNote.timestamp))
          };
          
          // Check if this is a temp ID (starts with 'offline_')
          const isNewNote = id.startsWith('offline_');
          
          if (isNewNote) {
            // This is a new note - add to Firestore
            await addDoc(notesRef, firestoreNote);
          } else {
            try {
              // This is an existing note - update in Firestore
              const noteRef = doc(db, 'users', userId, 'notes', id);
              await updateDoc(noteRef, firestoreNote);
            } catch (error) {
              // If update fails (note might have been deleted), try to add it as new
              console.warn(`[NotesService] Failed to update note ${id}, treating as new note:`, error);
              await addDoc(notesRef, firestoreNote);
            }
          }
          
          // Mark as synced
          syncedNoteIds.push(id);
          console.log(`[NotesService] Synced note ${id}`);
        } catch (error) {
          console.error(`[NotesService] Error syncing note ${offlineNote.id}:`, error);
          // Continue with other notes even if one fails
        }
      }
      
      // Remove synced notes from offline storage
      if (syncedNoteIds.length > 0) {
        const remainingNotes = offlineNotes.filter(
          (note: any) => !syncedNoteIds.includes(note.id)
        );
        
        await AsyncStorage.setItem(
          `${OFFLINE_NOTES_KEY}_${userId}`,
          JSON.stringify(remainingNotes)
        );
        
        console.log(`[NotesService] Removed ${syncedNoteIds.length} synced notes from offline storage`);
      }
    } catch (error) {
      console.error('Error syncing offline notes:', error);
      throw error;
    }
  }
}

export default NotesService; 