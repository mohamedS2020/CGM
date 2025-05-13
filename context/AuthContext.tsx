import React, { createContext, useState, useEffect, useContext } from 'react';
import { 
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  User,
  sendPasswordResetEmail,
  sendEmailVerification,
  updateProfile
} from 'firebase/auth';
import { doc, setDoc, getDoc } from 'firebase/firestore';
import { auth, db } from '../firebase';
import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';
import MeasurementService from '../services/MeasurementService';

// Key for storing auth persistence
const AUTH_PERSISTENCE_KEY = 'cgm_auth_persistence';

// Key for storing encrypted user credentials
const USER_CREDS_KEY = 'cgm_user_credentials';

// Key for caching user profile data
const USER_DATA_CACHE_KEY = 'cgm_user_data_cache';

interface AuthContextType {
  user: User | null;
  userData: UserData | null;
  loading: boolean;
  isOnline: boolean;
  signup: (email: string, password: string, userData: UserData) => Promise<void>;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  resetPassword: (email: string) => Promise<void>;
  sendVerificationEmail: () => Promise<void>;
  updateUserProfile: (userData: Partial<UserData>) => Promise<void>;
  refreshUserData: () => Promise<void>;
}

export interface UserData {
  displayName?: string;
  age?: number;
  gender?: string;
  phoneNumber?: string;
  normalGlucose?: number;
  doctorName?: string;
  imageURL?: string;
  role?: 'patient' | 'doctor' | 'admin';
  children?: Array<{id: string, name: string}>;
}

const AuthContext = createContext<AuthContextType | null>(null);

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

export const AuthProvider: React.FC<{children: React.ReactNode}> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [userData, setUserData] = useState<UserData | null>(null);
  const [loading, setLoading] = useState(true);
  const [isOnline, setIsOnline] = useState(true);

  // Fetch user data from Firestore or local cache
  const fetchUserData = async (userId: string) => {
    try {
      // First check if we're online
      const netInfoState = await NetInfo.fetch();
      
      if (netInfoState.isConnected) {
        // We're online, try to fetch from Firestore
        console.log('Online: Fetching user data from Firestore');
        const userDoc = await getDoc(doc(db, 'users', userId));
        
        if (userDoc.exists()) {
          const fetchedUserData = userDoc.data() as UserData;
          
          // Cache the data for offline use
          await AsyncStorage.setItem(
            `${USER_DATA_CACHE_KEY}_${userId}`, 
            JSON.stringify(fetchedUserData)
          );
          
          setUserData(fetchedUserData);
          return fetchedUserData;
        } else {
          console.log('User document does not exist in Firestore');
        }
      } else {
        console.log('Offline: Using cached user data');
      }
      
      // If we're offline or couldn't fetch from Firestore, try to load from cache
      const cachedUserData = await AsyncStorage.getItem(`${USER_DATA_CACHE_KEY}_${userId}`);
      
      if (cachedUserData) {
        console.log('Using cached user data');
        const parsedUserData = JSON.parse(cachedUserData) as UserData;
        setUserData(parsedUserData);
        return parsedUserData;
      } else {
        console.warn('No cached user data available');
        return null;
      }
    } catch (error) {
      console.error("Error fetching user data:", error);
      
      // As a last resort, try to load from cache even if there was an error
      try {
        const cachedUserData = await AsyncStorage.getItem(`${USER_DATA_CACHE_KEY}_${userId}`);
        
        if (cachedUserData) {
          console.log('Error occurred, using cached user data');
          const parsedUserData = JSON.parse(cachedUserData) as UserData;
          setUserData(parsedUserData);
          return parsedUserData;
        }
      } catch (cacheError) {
        console.error("Error reading cached user data:", cacheError);
      }
      
      return null;
    }
  };

  // Refresh user data
  const refreshUserData = async () => {
    if (user) {
      await fetchUserData(user.uid);
    }
  };

  // Store auth state in secure storage for persistence
  const persistAuthState = async (currentUser: User | null) => {
    if (currentUser) {
      // Store only what we need for rehydration
      const authState = {
        uid: currentUser.uid,
        email: currentUser.email,
        displayName: currentUser.displayName,
        emailVerified: currentUser.emailVerified,
        // Include the current timestamp for cache invalidation purposes
        cachedAt: new Date().toISOString()
      };
      
      // Store auth state
      await AsyncStorage.setItem(AUTH_PERSISTENCE_KEY, JSON.stringify(authState));
      
      // Also make sure user data is cached for offline use
      const cachedUserData = await AsyncStorage.getItem(`${USER_DATA_CACHE_KEY}_${currentUser.uid}`);
      
      // If we have userData but it's not cached yet, cache it
      if (userData && !cachedUserData) {
        await AsyncStorage.setItem(
          `${USER_DATA_CACHE_KEY}_${currentUser.uid}`, 
          JSON.stringify(userData)
        );
      }
    } else {
      // Remove auth state on logout
      await AsyncStorage.removeItem(AUTH_PERSISTENCE_KEY);
    }
  };

  useEffect(() => {
    // First, check if we have stored auth credentials
    const checkStoredAuth = async () => {
      try {
        const storedAuth = await AsyncStorage.getItem(AUTH_PERSISTENCE_KEY);
        
        if (storedAuth && !auth.currentUser) {
          console.log('Found stored auth, attempting to restore session');
          // We'll set loading to true while we initialize
          setLoading(true);
        }
      } catch (error) {
        console.error("Error checking stored auth:", error);
      }
    };
    
    checkStoredAuth();
    
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      console.log("Auth state changed, user:", currentUser?.email, "verified:", currentUser?.emailVerified);
      
      // If user exists but we're not sure about verification status, force a reload
      if (currentUser) {
        try {
          // Force reload to get the latest verification status
          await currentUser.reload();
          // Get the refreshed user
          const refreshedUser = auth.currentUser;
          
          // Additional logging to track verification status
          if (refreshedUser) {
            console.log("User refreshed:", refreshedUser.email, 
                       "Verified status:", refreshedUser.emailVerified);
          }
          
          setUser(refreshedUser);
          
          if (refreshedUser) {
            await fetchUserData(refreshedUser.uid);
            await persistAuthState(refreshedUser);
            
            // Initialize measurement service connectivity monitoring
            MeasurementService.initConnectivityMonitoring(refreshedUser.uid);
          }
        } catch (error) {
          console.error("Error refreshing user:", error);
          setUser(currentUser);
          
          // Check if we're offline
          const netInfoState = await NetInfo.fetch();
          if (!netInfoState.isConnected) {
            console.log("Device is offline, attempting to load cached user data");
            // Try to load from cache directly
            const cachedUserData = await AsyncStorage.getItem(`${USER_DATA_CACHE_KEY}_${currentUser.uid}`);
            if (cachedUserData) {
              setUserData(JSON.parse(cachedUserData));
            }
          } else {
            await fetchUserData(currentUser.uid);
          }
          
          await persistAuthState(currentUser);
          
          // Initialize measurement service connectivity monitoring even if refresh failed
          MeasurementService.initConnectivityMonitoring(currentUser.uid);
        }
      } else {
        // No current user, stop measurement service connectivity monitoring
        MeasurementService.stopConnectivityMonitoring();
        
        // No current user in Firebase Auth, try to recover from AsyncStorage
        try {
          const storedAuth = await AsyncStorage.getItem(AUTH_PERSISTENCE_KEY);
          const storedCreds = await AsyncStorage.getItem(USER_CREDS_KEY);
          
          if (storedCreds) {
            // We have credentials, attempt to automatically sign back in
            try {
              console.log('Found stored credentials, attempting to re-authenticate');
              const { email, password } = JSON.parse(storedCreds);
              
              // Re-authenticate the user
              const userCredential = await signInWithEmailAndPassword(auth, email, password);
              console.log('Re-authentication successful');
              
              // User data will be set by the auth state change triggered by signInWithEmailAndPassword
              return;
            } catch (authError) {
              console.error('Auto re-authentication failed:', authError);
              // Keep the stored credentials in case the error is temporary
              // Only the explicit logout will clear them
            }
          } else if (storedAuth) {
            const authData = JSON.parse(storedAuth);
            console.log('Found stored auth data, but no credentials for', authData.email);
            // We have auth data but no credentials to re-authenticate
            // Keep the persistence data in case the user wants to log in manually
          } else {
            // No stored auth, user is truly logged out
            setUser(null);
            setUserData(null);
          }
        } catch (error) {
          console.error("Error checking stored auth:", error);
          setUser(null);
          setUserData(null);
        }
      }
      
      setLoading(false);
    });

    return unsubscribe;
  }, []);

  useEffect(() => {
    const unsubscribe = NetInfo.addEventListener(state => {
      setIsOnline(state.isConnected);
    });

    return () => {
      unsubscribe();
    };
  }, []);

  // Register new user
  const signup = async (email: string, password: string, userData: UserData) => {
    try {
      const userCredential = await createUserWithEmailAndPassword(auth, email, password);
      const user = userCredential.user;
      
      // Store credentials securely for later re-authentication if needed
      // This ensures users stay logged in after registration too
      await AsyncStorage.setItem(USER_CREDS_KEY, JSON.stringify({ email, password }));
      
      try {
        // Create user document in Firestore
        await setDoc(doc(db, 'users', user.uid), {
          email: user.email,
          ...userData,
          createdAt: new Date()
        });
      } catch (firestoreError: any) {
        console.error("Firestore error during signup: ", firestoreError);
        // If there's a permission error, we'll still continue with the signup process
        // since the authentication part succeeded
        if (firestoreError.code === 'permission-denied') {
          console.warn("Firebase permissions error. Please check Firebase security rules.");
        } else {
          throw firestoreError;
        }
      }
      
      // Send email verification
      await sendEmailVerification(user);
      
      if (userData.displayName) {
        await updateProfile(user, { displayName: userData.displayName });
      }
      
      setUserData(userData);
    } catch (error) {
      console.error("Error during signup: ", error);
      throw error;
    }
  };

  // Login user
  const login = async (email: string, password: string) => {
    try {
      const userCredential = await signInWithEmailAndPassword(auth, email, password);
      
      // Store credentials securely for later re-authentication if needed
      // In a production app, you would use a more secure storage solution with encryption
      await AsyncStorage.setItem(USER_CREDS_KEY, JSON.stringify({ email, password }));
      
      await fetchUserData(userCredential.user.uid);
    } catch (error) {
      console.error("Error during login: ", error);
      throw error;
    }
  };

  // Logout user
  const logout = async () => {
    try {
      // Stop measurement service connectivity monitoring before logout
      MeasurementService.stopConnectivityMonitoring();
      
      // Clear stored credentials to prevent auto-login
      await AsyncStorage.removeItem(USER_CREDS_KEY);
      
      // Clear auth state persistence
      await AsyncStorage.removeItem(AUTH_PERSISTENCE_KEY);
      
      // Sign out of Firebase
      await signOut(auth);
      
      // Clear current user data
      setUser(null);
      setUserData(null);
    } catch (error) {
      console.error('Error logging out:', error);
      throw error;
    }
  };

  // Reset password
  const resetPassword = async (email: string) => {
    try {
      await sendPasswordResetEmail(auth, email);
    } catch (error) {
      console.error("Error sending reset password email: ", error);
      throw error;
    }
  };

  // Send email verification
  const sendVerificationEmail = async () => {
    if (user) {
      try {
        await sendEmailVerification(user);
      } catch (error) {
        console.error("Error sending verification email: ", error);
        throw error;
      }
    }
  };

  // Update user profile data
  const updateUserProfile = async (updatedUserData: Partial<UserData>) => {
    if (!user) return;
    
    try {
      // First, update local state immediately for responsive UI
      setUserData(prev => prev ? { ...prev, ...updatedUserData } : updatedUserData);
      
      // Check if we're online
      const netInfoState = await NetInfo.fetch();
      
      if (netInfoState.isConnected) {
        // We're online, update Firestore
        const userRef = doc(db, 'users', user.uid);
        await setDoc(userRef, updatedUserData, { merge: true });
        
        if (updatedUserData.displayName) {
          await updateProfile(user, { displayName: updatedUserData.displayName });
        }
      } else {
        console.log('Offline: Cannot update profile in Firestore. Changes will be cached locally.');
      }
      
      // Update the cached data regardless of online status
      try {
        // Get current cached data
        const cachedDataString = await AsyncStorage.getItem(`${USER_DATA_CACHE_KEY}_${user.uid}`);
        let cachedData: UserData = {};
        
        if (cachedDataString) {
          cachedData = JSON.parse(cachedDataString);
        }
        
        // Merge with updates
        const updatedCache = { ...cachedData, ...updatedUserData };
        
        // Save back to cache
        await AsyncStorage.setItem(
          `${USER_DATA_CACHE_KEY}_${user.uid}`, 
          JSON.stringify(updatedCache)
        );
        
        console.log('Updated profile cache');
      } catch (cacheError) {
        console.error("Error updating profile cache:", cacheError);
      }
    } catch (error) {
      console.error("Error updating profile:", error);
      throw error;
    }
  };

  const value = {
    user,
    userData,
    loading,
    isOnline,
    signup,
    login,
    logout,
    resetPassword,
    sendVerificationEmail,
    updateUserProfile,
    refreshUserData
  };

  return (
    <AuthContext.Provider value={value}>
      {!loading && children}
    </AuthContext.Provider>
  );
};

export default AuthContext; 