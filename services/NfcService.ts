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
  private operationTimeout: NodeJS.Timeout | null = null;
  
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
    const expoAppId = Constants.expoConfig?.appId;
    // If app ID starts with 'host.exp.exponent', we're in Expo Go
    return expoAppId === 'host.exp.exponent' || Constants.appOwnership === 'expo';
  }
  
  /**
   * Check if an NFC operation is currently in progress
   */
  public isOperationInProgress(): boolean {
    return this.operationInProgress;
  }
  
  /**
   * Set the operation state, with an optional automatic timeout
   * to prevent operations getting stuck in "in progress" state
   */
  public setOperationInProgress(inProgress: boolean, timeoutMs: number = 10000): void {
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
      }, timeoutMs);
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
        
        // Register event listener if supported
        if (isSupported && typeof NfcManager.setEventListener === 'function') {
          NfcManager.setEventListener(NfcEvents.DiscoverTag, (tag) => {
            console.log('[NfcService] Tag discovered:', tag);
          });
          console.log('[NfcService] NFC event listeners registered');
        }
        
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
}

export default NfcService; 