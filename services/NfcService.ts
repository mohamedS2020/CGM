import NfcManager, { NfcTech, NfcEvents } from 'react-native-nfc-manager';
import { Platform } from 'react-native';
import Constants from 'expo-constants';

class NfcService {
  private static instance: NfcService;
  private isNfcSupported: boolean = false;
  private isInitialized: boolean = false;
  private initializationPromise: Promise<boolean> | null = null;
  // Add a lock to track ongoing NFC operations
  private operationInProgress: boolean = false;
  private operationTimeout: number | null = null;
  
  /**
   * Get singleton instance
   */
  public static getInstance(): NfcService {
    if (!NfcService.instance) {
      NfcService.instance = new NfcService();
    }
    return NfcService.instance;
  }
  
  private constructor() {}
  
  /**
   * Check if running in Expo Go
   * NFC modules aren't fully available in Expo Go
   */
  public isRunningInExpoGo(): boolean {
    // Check if running in Expo Go environment
    // Constants.expoConfig?.appId is deprecated, use Constants.appOwnership instead
    return Constants.appOwnership === 'expo';
  }
  
  /**
   * Check if an NFC operation is currently in progress
   * @param resetIfStuck If true, will attempt to reset the NFC system if an operation appears stuck
   */
  public isOperationInProgress(resetIfStuck: boolean = false): boolean {
    // If operation has been in progress for a long time, it might be stuck
    if (resetIfStuck && this.operationInProgress && this.operationTimeout) {
      console.log('[NfcService] NFC operation may be stuck, attempting to reset...');
      this.resetNfcSystem();
      return false;
    }
    return this.operationInProgress;
  }
  
  /**
   * Set the operation state, with an optional automatic timeout
   * to prevent operations getting stuck in "in progress" state
   */
  public setOperationInProgress(inProgress: boolean, timeoutMs: number = 30000): void {
    this.operationInProgress = inProgress;
    
    // Clear any existing timeout
    if (this.operationTimeout) {
      clearTimeout(this.operationTimeout);
      this.operationTimeout = null;
    }
    
    // If starting an operation, set a timeout to automatically clear it
    if (inProgress && timeoutMs > 0) {
      this.operationTimeout = setTimeout(() => {
        console.log('[NfcService] Operation timeout reached, forcing state to not in progress');
        this.operationInProgress = false;
        this.operationTimeout = null;
      }, timeoutMs) as unknown as number;
    }
  }
  
  /**
   * Initialize NFC service safely, accounting for Expo Go and potential null references
   */
  public async initialize(): Promise<boolean> {
    // If already initialized or initialization is in progress, return existing state or promise
    if (this.isInitialized) {
      return this.isNfcSupported;
    }
    
    if (this.initializationPromise) {
      return this.initializationPromise;
    }
    
    // Create new initialization promise
    this.initializationPromise = this._safeInitialize();
    
    try {
      // Wait for initialization to complete
      this.isNfcSupported = await this.initializationPromise;
      this.isInitialized = true;
      
      // DON'T enable foreground dispatch yet - we'll do this only when explicitly requested
      // This prevents auto-scanning for NFC tags when the app starts
      
      return this.isNfcSupported;
    } catch (error) {
      console.error('[NfcService] Initialization failed:', error);
      this.isNfcSupported = false;
      this.isInitialized = false;
      return false;
    } finally {
      // Clear promise to allow future initialization attempts
      this.initializationPromise = null;
    }
  }
  
  /**
   * Enable foreground dispatch to prevent Android system from handling NFC tags
   * This makes our app the preferred handler for NFC tags while it's in the foreground
   * 
   * IMPORTANT: Only call this when you're about to scan, not during app initialization
   * to prevent automatic scanning
   */
  public async enableForegroundDispatch(): Promise<void> {
    try {
      if (Platform.OS !== 'android' || !this.isNfcSupported) {
        return;
      }
      
      if (typeof NfcManager.setEventListener !== 'function') {
        console.warn('[NfcService] NfcManager.setEventListener is not available, can\'t enable foreground dispatch');
        return;
      }
      
      // Set a null event listener to prevent the system from auto-handling tags
      NfcManager.setEventListener(NfcEvents.DiscoverTag, null);
      
      // For Android, also register to get raw tag discovery events
      if (typeof NfcManager.registerTagEvent === 'function') {
        try {
          await NfcManager.registerTagEvent();
          console.log('[NfcService] Android foreground dispatch enabled - app will now handle NFC tags automatically');
        } catch (error) {
          console.error('[NfcService] Error registering tag event:', error);
        }
      } else {
        console.warn('[NfcService] NfcManager.registerTagEvent is not available');
      }
    } catch (error) {
      console.error('[NfcService] Error enabling foreground dispatch:', error);
    }
  }
  
  /**
   * Disable foreground dispatch to return to normal NFC handling
   * Call this after scanning is complete to prevent automatic tag reading
   */
  public async disableForegroundDispatch(): Promise<void> {
    try {
      if (Platform.OS !== 'android' || !this.isNfcSupported) {
        return;
      }
      
      if (typeof NfcManager.unregisterTagEvent === 'function') {
        try {
          await NfcManager.unregisterTagEvent();
          console.log('[NfcService] Android foreground dispatch disabled');
        } catch (error) {
          console.error('[NfcService] Error unregistering tag event:', error);
        }
      }
    } catch (error) {
      console.error('[NfcService] Error disabling foreground dispatch:', error);
    }
  }
  
  /**
   * Internal initialization with safety checks
   */
  private async _safeInitialize(): Promise<boolean> {
    try {
      // Check if in Expo Go
      if (this.isRunningInExpoGo()) {
        console.log('[NfcService] Running in Expo Go - NFC functionality will be limited');
        return false;
      }
      
      // Check if on a platform that supports NFC
      if (Platform.OS !== 'android' && Platform.OS !== 'ios') {
        console.log(`[NfcService] Platform ${Platform.OS} does not support NFC`);
        return false;
      }

      // Check if NfcManager is defined globally
      if (typeof NfcManager === 'undefined') {
        console.error('[NfcService] NfcManager is undefined');
        return false;
      }
      
      // Safety check for null NfcManager (prevents "Cannot convert null value to object" error)
      if (NfcManager === null) {
        console.error('[NfcService] NfcManager is null');
        return false;
      }
      
      // Check if required methods exist
      if (typeof NfcManager.start !== 'function') {
        console.error('[NfcService] NfcManager.start is not a function');
        return false;
      }
      
      // Make sure any pending operations are cancelled before starting
      await this.forceCancelTechnologyRequest();
      
      // Safely start NFC manager with error handling
      try {
        console.log('[NfcService] Starting NFC Manager...');
        await NfcManager.start();
        console.log('[NfcService] NFC Manager started successfully');
      } catch (startError) {
        console.error('[NfcService] Failed to start NFC Manager:', startError);
        return false;
      }
      
      // Check if NFC is supported on device
      try {
        if (typeof NfcManager.isSupported !== 'function') {
          console.error('[NfcService] NfcManager.isSupported is not a function');
          return false;
        }
        
        const isSupported = await NfcManager.isSupported();
        console.log(`[NfcService] NFC is ${isSupported ? 'supported' : 'not supported'} on this device`);
        
        // For Android, we want to use registerTagEvent later instead of setEventListener
        // to handle NFC tags properly and prevent system from intercepting them
        
        return !!isSupported;
      } catch (error) {
        console.error('[NfcService] Error checking NFC support:', error);
        return false;
      }
    } catch (error) {
      console.error('[NfcService] Unexpected error during NFC initialization:', error);
      return false;
    }
  }
  
  /**
   * Get NFC support status
   */
  public isNfcEnabled(): boolean {
    return this.isInitialized && this.isNfcSupported;
  }
  
  /**
   * Force cancel any ongoing NFC technology request
   * This is a more aggressive cleanup that ignores errors
   */
  public async forceCancelTechnologyRequest(): Promise<void> {
    if (typeof NfcManager === 'undefined' || NfcManager === null) {
      return;
    }
    
    if (typeof NfcManager.cancelTechnologyRequest !== 'function') {
      return;
    }
    
    try {
      await NfcManager.cancelTechnologyRequest().catch(() => {
        // Ignore errors during force cancel
      });
      this.setOperationInProgress(false);
    } catch (error) {
      // Ignore any errors in force cancel mode
    }
  }
  
  /**
   * Clean up NFC resources
   */
  public async cleanup(): Promise<void> {
    try {
      if (this.isNfcSupported && typeof NfcManager !== 'undefined' && NfcManager !== null) {
        console.log('[NfcService] Cleaning up NFC resources...');
        
        // Disable foreground dispatch on Android if enabled
        if (Platform.OS === 'android') {
          await this.disableForegroundDispatch();
        }
        
        // Cancel any ongoing operations
        if (typeof NfcManager.cancelTechnologyRequest === 'function') {
          try {
            await NfcManager.cancelTechnologyRequest();
          } catch (error) {
            console.error('[NfcService] Error cancelling technology request:', error);
          }
        }
        
        // Unregister event listeners
        if (typeof NfcManager.setEventListener === 'function') {
          try {
            NfcManager.setEventListener(NfcEvents.DiscoverTag, null);
          } catch (error) {
            console.error('[NfcService] Error removing event listeners:', error);
          }
        }
        
        // Reset operation state
        this.setOperationInProgress(false);
      }
    } catch (error) {
      console.error('[NfcService] Error during NFC cleanup:', error);
    }
  }
  
  /**
   * Reset the NFC system if it appears to be stuck
   * This will force cancel any pending operations and reset the state
   */
  public async resetNfcSystem(): Promise<void> {
    console.log('[NfcService] Resetting NFC system...');
    
    // Clear any operation timeout
    if (this.operationTimeout) {
      clearTimeout(this.operationTimeout);
      this.operationTimeout = null;
    }
    
    // Reset the operation state
    this.operationInProgress = false;
    
    // Force cancel any technology request
    await this.forceCancelTechnologyRequest();
    
    // More aggressive cleanup - try multiple methods
    try {
      // Cancel tech request first 
      if (typeof NfcManager.cancelTechnologyRequest === 'function') {
        try {
          await NfcManager.cancelTechnologyRequest();
        } catch (e) {
          // Ignore errors
        }
      }
      
      // Remove all event listeners
      if (typeof NfcManager.setEventListener === 'function') {
        try {
          NfcManager.setEventListener(NfcEvents.DiscoverTag, null);
          NfcManager.setEventListener(NfcEvents.SessionClosed, null);
          NfcManager.setEventListener(NfcEvents.StateChanged, null);
        } catch (e) {
          // Ignore errors
        }
      }
      
      // For Android, ensure tag events are unregistered
      if (Platform.OS === 'android' && typeof NfcManager.unregisterTagEvent === 'function') {
        try {
          await NfcManager.unregisterTagEvent();
        } catch (e) {
          // Ignore errors
        }
      }
      
      // Wait a small amount of time for the system to settle
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // For iOS, try to invalidate the session if possible
      if (Platform.OS === 'ios' && typeof NfcManager.invalidateSessionWithErrorIOS === 'function') {
        try {
          await NfcManager.invalidateSessionWithErrorIOS('Session invalidated due to reset');
        } catch (e) {
          // Ignore errors
        }
      }
    } catch (cleanupError) {
      console.error('[NfcService] Error during aggressive NFC cleanup:', cleanupError);
      // Continue with reset process regardless of errors
    }
    
    if (Platform.OS === 'android') {
      try {
        // Disable and re-enable foreground dispatch
        await this.disableForegroundDispatch();
        // Don't automatically re-enable foreground dispatch
        // Only enable it when explicitly requested
        console.log('[NfcService] NFC system reset complete');
      } catch (error) {
        console.error('[NfcService] Error resetting NFC system:', error);
      }
    }
  }
}

export default NfcService; 