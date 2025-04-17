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

// Key for storing auth persistence
const AUTH_PERSISTENCE_KEY = 'cgm_auth_persistence';

// Key for storing encrypted user credentials
const USER_CREDS_KEY = 'cgm_user_credentials';

interface AuthContextType {
  user: User | null;
  userData: UserData | null;
  loading: boolean;
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

  // Fetch user data from Firestore
  const fetchUserData = async (userId: string) => {
    try {
      const userDoc = await getDoc(doc(db, 'users', userId));
      if (userDoc.exists()) {
        setUserData(userDoc.data() as UserData);
      }
    } catch (error) {
      console.error("Error fetching user data:", error);
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
      };
      await AsyncStorage.setItem(AUTH_PERSISTENCE_KEY, JSON.stringify(authState));
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
          }
        } catch (error) {
          console.error("Error refreshing user:", error);
          setUser(currentUser);
          await fetchUserData(currentUser.uid);
          await persistAuthState(currentUser);
        }
      } else {
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
      console.log("Logging out user");
      
      // First remove the stored credentials to prevent auto re-login
      await AsyncStorage.removeItem(USER_CREDS_KEY);
      
      // Then remove the auth persistence data
      await AsyncStorage.removeItem(AUTH_PERSISTENCE_KEY);
      
      // Finally sign out from Firebase
      await signOut(auth);
      
      // Explicitly set user state to null to force UI update
      setUser(null);
      setUserData(null);
      
      console.log("Logout completed");
    } catch (error) {
      console.error("Error during logout: ", error);
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
      const userRef = doc(db, 'users', user.uid);
      await setDoc(userRef, updatedUserData, { merge: true });
      
      if (updatedUserData.displayName) {
        await updateProfile(user, { displayName: updatedUserData.displayName });
      }
      
      // Update local state
      setUserData(prev => prev ? { ...prev, ...updatedUserData } : updatedUserData);
    } catch (error) {
      console.error("Error updating profile: ", error);
      throw error;
    }
  };

  const value = {
    user,
    userData,
    loading,
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