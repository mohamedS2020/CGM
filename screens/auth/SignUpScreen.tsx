import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  Alert,
  ScrollView,
  ActivityIndicator,
  Image,
  Modal,
  TouchableWithoutFeedback,
  Animated,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList } from '../../navigation';
import { useAuth } from '../../context/AuthContext';
import { UserData } from '../../context/AuthContext';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as ImagePicker from 'expo-image-picker';
import { Ionicons } from '@expo/vector-icons';
import { storage } from '../../firebase';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { uploadToCloudinary } from '../../services/cloudinaryService';

// Key for temp password storage
const TEMP_PASSWORD_KEY = 'cgm_temp_password';

type SignUpScreenNavigationProp = NativeStackNavigationProp<RootStackParamList, 'SignUp'>;

const SignUpScreen = () => {
  const [step, setStep] = useState(1);
  const [userData, setUserData] = useState<UserData>({
    displayName: '',
    role: 'patient',
  });
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<{[key: string]: string}>({});
  const [profileImage, setProfileImage] = useState<string | null>(null);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [showPhotoDrawer, setShowPhotoDrawer] = useState(false);
  const drawerAnimation = useRef(new Animated.Value(0)).current;
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  const navigation = useNavigation<SignUpScreenNavigationProp>();
  const { signup } = useAuth();

  const validateEmail = (email: string) => {
    const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return re.test(email);
  };

  const validateStep1 = () => {
    const newErrors: {[key: string]: string} = {};
    
    if (!userData.displayName?.trim()) {
      newErrors.displayName = 'Full name is required';
    }
    
    if (!email.trim()) {
      newErrors.email = 'Email is required';
    } else if (!validateEmail(email)) {
      newErrors.email = 'Please enter a valid email address';
    }
    
    if (!password) {
      newErrors.password = 'Password is required';
    } else if (password.length < 6) {
      newErrors.password = 'Password must be at least 6 characters long';
    }
    
    if (password !== confirmPassword) {
      newErrors.confirmPassword = 'Passwords do not match';
    }
    
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const validateStep2 = () => {
    const newErrors: {[key: string]: string} = {};
    
    if (userData.age !== undefined && userData.age <= 0) {
      newErrors.age = 'Please enter a valid age';
    }
    
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleNextStep = () => {
    if (step === 1) {
      if (validateStep1()) {
        setStep(2);
      }
    } else if (step === 2) {
      if (validateStep2()) {
        setStep(3);
      }
    }
  };

  // Add a function to request permissions only when needed
  const requestPhotoPermissions = async (type: 'camera' | 'library'): Promise<boolean> => {
    if (Platform.OS === 'web') return true;
    
    try {
      // This will trigger the system's permission dialog automatically
      if (type === 'camera' && ImagePicker.requestCameraPermissionsAsync) {
        const { status } = await ImagePicker.requestCameraPermissionsAsync();
        return status === 'granted';
      } else if (type === 'library' && ImagePicker.requestMediaLibraryPermissionsAsync) {
        const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
        return status === 'granted';
      }
      return false;
    } catch (error) {
      console.error(`Error requesting ${type} permissions:`, error);
      return false;
    }
  };

  // Show the photo drawer
  const handleImagePick = () => {
    setShowPhotoDrawer(true);
    Animated.timing(drawerAnimation, {
      toValue: 1,
      duration: 300,
      useNativeDriver: true,
    }).start();
  };

  // Hide the photo drawer
  const hidePhotoDrawer = () => {
    Animated.timing(drawerAnimation, {
      toValue: 0,
      duration: 300,
      useNativeDriver: true,
    }).start(() => {
      setShowPhotoDrawer(false);
    });
  };

  // Bottom drawer for photo selection
  const renderPhotoDrawer = () => {
    const translateY = drawerAnimation.interpolate({
      inputRange: [0, 1],
      outputRange: [300, 0],
    });

    return (
      <Modal
        visible={showPhotoDrawer}
        transparent
        animationType="none"
        onRequestClose={hidePhotoDrawer}
      >
        <TouchableWithoutFeedback onPress={hidePhotoDrawer}>
          <View style={styles.drawerOverlay}>
            <Animated.View
              style={[
                styles.photoDrawer,
                {
                  transform: [{ translateY }],
                },
              ]}
            >
              <View style={styles.drawerHandle} />
              <Text style={styles.drawerTitle}>Choose Photo Source</Text>
              
              <TouchableOpacity
                style={styles.drawerOption}
                onPress={() => {
                  hidePhotoDrawer();
                  setTimeout(() => {
                    launchCamera();
                  }, 300);
                }}
              >
                <Ionicons name="camera" size={24} color="#4361EE" />
                <Text style={styles.drawerOptionText}>Take Photo</Text>
              </TouchableOpacity>
              
              <TouchableOpacity
                style={styles.drawerOption}
                onPress={() => {
                  hidePhotoDrawer();
                  setTimeout(() => {
                    launchImageLibrary();
                  }, 300);
                }}
              >
                <Ionicons name="images" size={24} color="#4361EE" />
                <Text style={styles.drawerOptionText}>Choose from Library</Text>
              </TouchableOpacity>
              
              <TouchableOpacity
                style={styles.drawerCancelButton}
                onPress={hidePhotoDrawer}
              >
                <Text style={styles.drawerCancelText}>Cancel</Text>
              </TouchableOpacity>
            </Animated.View>
          </View>
        </TouchableWithoutFeedback>
      </Modal>
    );
  };

  // Update the camera and image library functions to request permissions when needed
  const launchCamera = async () => {
    try {
      // This triggers the system permission dialog if not already granted
      const permissionGranted = await requestPhotoPermissions('camera');
      
      if (!permissionGranted) {
        // Only show this if permissions were denied - helps user find settings
        Alert.alert(
          'Permission Denied', 
          'Camera access is required to take a profile photo. Please enable it in your device settings.',
          [{ text: 'OK' }]
        );
        return;
      }
      
      // Proceed with camera if permission is granted
      const result = await ImagePicker.launchCameraAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.8,
      });
      
      if (!result.canceled && result.assets && result.assets.length > 0) {
        setProfileImage(result.assets[0].uri);
      }
    } catch (error) {
      console.error('Error taking photo:', error);
      Alert.alert('Error', 'Failed to take photo. Please try again.');
    }
  };

  const launchImageLibrary = async () => {
    try {
      // This triggers the system permission dialog if not already granted
      const permissionGranted = await requestPhotoPermissions('library');
      
      if (!permissionGranted) {
        // Only show this if permissions were denied - helps user find settings
        Alert.alert(
          'Permission Denied', 
          'Photo library access is required to select a profile picture. Please enable it in your device settings.',
          [{ text: 'OK' }]
        );
        return;
      }
      
      // Proceed with photo library if permission is granted
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.8,
      });
      
      if (!result.canceled && result.assets && result.assets.length > 0) {
        setProfileImage(result.assets[0].uri);
      }
    } catch (error) {
      console.error('Error picking image:', error);
      Alert.alert('Error', 'Failed to pick image. Please try again.');
    }
  };

  // Upload image to Firebase Storage
  const uploadProfileImage = async (): Promise<string | null> => {
    if (!profileImage) return null;
    
    setUploadingImage(true);
    
    try {
      // Upload to Cloudinary
      const cloudinaryUrl = await uploadToCloudinary(profileImage);
      
      if (!cloudinaryUrl) {
        throw new Error('Failed to upload image to Cloudinary');
      }
      
      console.log('Cloudinary URL obtained:', cloudinaryUrl);
      
      return cloudinaryUrl;
    } catch (error: any) {
      console.error('Error uploading image:', error);
      
      let errorMessage = 'Failed to upload profile image. Your account will be created without a profile photo.';
      
      // Handle specific error messages
      if (error.message) {
        if (error.message.includes('network')) {
          errorMessage = 'Network connection unstable. Your account will be created without a profile photo.';
        }
      }
      
      Alert.alert('Image Upload Error', errorMessage);
      return null;
    } finally {
      setUploadingImage(false);
    }
  };

  const handleSignUp = async () => {
    if (!validateStep1()) {
      setStep(1);
      return;
    }

    setLoading(true);

    try {
      // Upload profile image if selected
      let imageURL = null;
      if (profileImage) {
        imageURL = await uploadProfileImage();
      }

      // Store password temporarily for re-authentication after email verification
      await AsyncStorage.setItem(TEMP_PASSWORD_KEY, password);
      
      // Add image URL to user data if available
      const userDataWithImage = { ...userData };
      if (imageURL) {
        userDataWithImage.imageURL = imageURL;
      }
      
      await signup(email, password, userDataWithImage);
      navigation.navigate('EmailVerification');
    } catch (error: any) {
      let errorMessage = 'Failed to create account';
      
      // Parse Firebase error messages
      if (error.code === 'auth/email-already-in-use') {
        errorMessage = 'This email is already registered. Please use a different email or try signing in.';
      } else if (error.code === 'auth/invalid-email') {
        errorMessage = 'Please enter a valid email address.';
      } else if (error.code === 'auth/weak-password') {
        errorMessage = 'Your password is too weak. Please choose a stronger password.';
      } else if (error.message?.includes('permissions')) {
        errorMessage = 'Firebase permissions issue. Account created but profile data could not be saved. Please continue to verification and contact support if issues persist.';
        // Even with the error, navigate to verification since auth worked
        navigation.navigate('EmailVerification');
        return;
      } else if (error.message) {
        errorMessage = error.message;
      }
      
      Alert.alert('Sign Up Error', errorMessage);
    } finally {
      setLoading(false);
    }
  };

  const renderStep1 = () => (
    <>
      <View style={styles.inputContainer}>
        <Text style={styles.inputLabel}>Full Name*</Text>
        <TextInput
          style={[styles.input, errors.displayName ? styles.inputError : null]}
          placeholder="Your full name"
          value={userData.displayName}
          onChangeText={(text) => {
            setUserData({...userData, displayName: text});
            if (errors.displayName) {
              const { displayName, ...rest } = errors;
              setErrors(rest);
            }
          }}
        />
        {errors.displayName ? (
          <Text style={styles.errorText}>{errors.displayName}</Text>
        ) : null}
      </View>

      <View style={styles.inputContainer}>
        <Text style={styles.inputLabel}>Email*</Text>
        <TextInput
          style={[styles.input, errors.email ? styles.inputError : null]}
          placeholder="your@email.com"
          value={email}
          onChangeText={(text) => {
            setEmail(text);
            if (errors.email) {
              const { email, ...rest } = errors;
              setErrors(rest);
            }
          }}
          keyboardType="email-address"
          autoCapitalize="none"
        />
        {errors.email ? (
          <Text style={styles.errorText}>{errors.email}</Text>
        ) : null}
      </View>

      <View style={styles.inputContainer}>
        <Text style={styles.inputLabel}>Password*</Text>
        <View style={styles.passwordContainer}>
          <TextInput
            style={[styles.passwordInput, errors.password ? styles.inputError : null]}
            placeholder="Choose a password"
            value={password}
            onChangeText={(text) => {
              setPassword(text);
              if (errors.password) {
                const { password, ...rest } = errors;
                setErrors(rest);
              }
            }}
            secureTextEntry={!showPassword}
          />
          <TouchableOpacity 
            style={styles.eyeIcon} 
            onPress={() => setShowPassword(!showPassword)}
          >
            <Ionicons 
              name={showPassword ? "eye-outline" : "eye-off-outline"} 
              size={22} 
              color="#666" 
            />
          </TouchableOpacity>
        </View>
        {errors.password ? (
          <Text style={styles.errorText}>{errors.password}</Text>
        ) : null}
      </View>

      <View style={styles.inputContainer}>
        <Text style={styles.inputLabel}>Confirm Password*</Text>
        <View style={styles.passwordContainer}>
          <TextInput
            style={[styles.passwordInput, errors.confirmPassword ? styles.inputError : null]}
            placeholder="Confirm your password"
            value={confirmPassword}
            onChangeText={(text) => {
              setConfirmPassword(text);
              if (errors.confirmPassword) {
                const { confirmPassword, ...rest } = errors;
                setErrors(rest);
              }
            }}
            secureTextEntry={!showConfirmPassword}
          />
          <TouchableOpacity 
            style={styles.eyeIcon} 
            onPress={() => setShowConfirmPassword(!showConfirmPassword)}
          >
            <Ionicons 
              name={showConfirmPassword ? "eye-outline" : "eye-off-outline"} 
              size={22} 
              color="#666" 
            />
          </TouchableOpacity>
        </View>
        {errors.confirmPassword ? (
          <Text style={styles.errorText}>{errors.confirmPassword}</Text>
        ) : null}
      </View>
    </>
  );

  const renderStep2 = () => (
    <>
      <View style={styles.inputContainer}>
        <Text style={styles.inputLabel}>Age</Text>
        <TextInput
          style={[styles.input, errors.age ? styles.inputError : null]}
          placeholder="Your age"
          value={userData.age?.toString() || ''}
          onChangeText={(text) => {
            setUserData({...userData, age: text ? parseInt(text) : undefined});
            if (errors.age) {
              const { age, ...rest } = errors;
              setErrors(rest);
            }
          }}
          keyboardType="number-pad"
        />
        {errors.age ? (
          <Text style={styles.errorText}>{errors.age}</Text>
        ) : null}
      </View>

      <View style={styles.inputContainer}>
        <Text style={styles.inputLabel}>Gender</Text>
        <View style={styles.radioGroup}>
          <TouchableOpacity
            style={[
              styles.radioButton,
              userData.gender === 'male' && styles.radioButtonSelected,
            ]}
            onPress={() => setUserData({...userData, gender: 'male'})}
          >
            <Text style={styles.radioText}>Male</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[
              styles.radioButton,
              userData.gender === 'female' && styles.radioButtonSelected,
            ]}
            onPress={() => setUserData({...userData, gender: 'female'})}
          >
            <Text style={styles.radioText}>Female</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[
              styles.radioButton,
              userData.gender === 'other' && styles.radioButtonSelected,
            ]}
            onPress={() => setUserData({...userData, gender: 'other'})}
          >
            <Text style={styles.radioText}>Other</Text>
          </TouchableOpacity>
        </View>
      </View>

      <View style={styles.inputContainer}>
        <Text style={styles.inputLabel}>Phone Number</Text>
        <TextInput
          style={styles.input}
          placeholder="Your phone number"
          value={userData.phoneNumber}
          onChangeText={(text) => setUserData({...userData, phoneNumber: text})}
          keyboardType="phone-pad"
        />
      </View>
    </>
  );

  const renderStep3 = () => (
    <>
      <View style={styles.imageUploadContainer}>
        <Text style={styles.photoSectionTitle}>Profile Photo</Text>
        <Text style={styles.photoSectionSubtitle}>Add a photo to personalize your account</Text>
        
        <View style={styles.profileImageContainer}>
          {uploadingImage ? (
            <View style={styles.profileImagePlaceholder}>
              <ActivityIndicator size="large" color="#fff" />
            </View>
          ) : profileImage ? (
            <Image 
              source={{ uri: profileImage }}
              style={styles.profileImage}
            />
          ) : (
            <View style={styles.profileImagePlaceholder}>
              <Text style={styles.profileImagePlaceholderText}>
                {userData.displayName ? userData.displayName.charAt(0).toUpperCase() : 'U'}
              </Text>
            </View>
          )}
          
          <TouchableOpacity 
            style={styles.changePhotoButton}
            onPress={handleImagePick}
          >
            <Ionicons name="camera" size={18} color="#4361EE" />
            <Text style={styles.changePhotoText}>
              {profileImage ? 'Change Photo' : 'Add Photo'}
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      <View style={styles.inputContainer}>
        <Text style={styles.inputLabel}>Normal Glucose Level (mg/dL)</Text>
        <TextInput
          style={styles.input}
          placeholder="Normal glucose level"
          value={userData.normalGlucose?.toString() || ''}
          onChangeText={(text) =>
            setUserData({...userData, normalGlucose: text ? parseInt(text) : undefined})
          }
          keyboardType="number-pad"
        />
      </View>

      <View style={styles.inputContainer}>
        <Text style={styles.inputLabel}>Doctor's Name</Text>
        <TextInput
          style={styles.input}
          placeholder="Your doctor's name"
          value={userData.doctorName}
          onChangeText={(text) => setUserData({...userData, doctorName: text})}
        />
      </View>
    </>
  );

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={styles.container}
    >
      <ScrollView contentContainerStyle={styles.scrollContainer}>
        <View style={styles.formContainer}>
          <View style={styles.logoContainer}>
            <Image
              source={require('../../assets/logo.png')}
              style={styles.logo}
              defaultSource={require('../../assets/logo.png')}
            />
          </View>
          
          <Text style={styles.title}>Create Account</Text>
          <Text style={styles.subtitle}>Step {step} of 3</Text>

          <View style={styles.stepIndicator}>
            <View
              style={[styles.stepDot, step >= 1 && styles.stepDotActive]}
            />
            <View style={styles.stepLine} />
            <View
              style={[styles.stepDot, step >= 2 && styles.stepDotActive]}
            />
            <View style={styles.stepLine} />
            <View
              style={[styles.stepDot, step >= 3 && styles.stepDotActive]}
            />
          </View>

          {step === 1 && renderStep1()}
          {step === 2 && renderStep2()}
          {step === 3 && renderStep3()}

          <View style={styles.buttonContainer}>
            {step > 1 && (
              <TouchableOpacity
                style={styles.backButton}
                onPress={() => setStep(step - 1)}
                disabled={loading}
              >
                <Text style={styles.backButtonText}>Back</Text>
              </TouchableOpacity>
            )}

            {step < 3 ? (
              <TouchableOpacity
                style={styles.nextButton}
                onPress={handleNextStep}
              >
                <Text style={styles.buttonText}>Next</Text>
              </TouchableOpacity>
            ) : (
              <TouchableOpacity
                style={[styles.button, loading && styles.buttonDisabled]}
                onPress={handleSignUp}
                disabled={loading}
              >
                {loading ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Text style={styles.buttonText}>Create Account</Text>
                )}
              </TouchableOpacity>
            )}
          </View>

          <View style={styles.signinContainer}>
            <Text style={styles.signinText}>Already have an account? </Text>
            <TouchableOpacity onPress={() => navigation.navigate('SignIn')}>
              <Text style={styles.signinLink}>Sign In</Text>
            </TouchableOpacity>
          </View>
        </View>
      </ScrollView>
      {renderPhotoDrawer()}
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f8f9fa',
  },
  scrollContainer: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: 24,
    paddingBottom: 40,
  },
  formContainer: {
    width: '100%',
    maxWidth: 400,
    alignSelf: 'center',
  },
  title: {
    fontSize: 32,
    fontWeight: 'bold',
    marginBottom: 8,
    color: '#333',
  },
  subtitle: {
    fontSize: 16,
    marginBottom: 20,
    color: '#666',
  },
  stepIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 30,
    justifyContent: 'center',
  },
  stepDot: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: '#ddd',
  },
  stepDotActive: {
    backgroundColor: '#4361EE',
  },
  stepLine: {
    height: 2,
    width: 40,
    backgroundColor: '#ddd',
  },
  inputContainer: {
    marginBottom: 20,
  },
  inputLabel: {
    marginBottom: 8,
    fontSize: 14,
    color: '#333',
    fontWeight: '500',
  },
  input: {
    backgroundColor: '#fff',
    height: 50,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#ddd',
    paddingHorizontal: 16,
    fontSize: 16,
  },
  inputError: {
    borderColor: '#FF0000',
    borderWidth: 1,
  },
  errorText: {
    color: '#FF0000',
    fontSize: 12,
    marginTop: 5,
  },
  radioGroup: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  radioButton: {
    flex: 1,
    height: 50,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#ddd',
    justifyContent: 'center',
    alignItems: 'center',
    marginHorizontal: 4,
    backgroundColor: '#fff',
  },
  radioButtonSelected: {
    backgroundColor: '#E0E7FF',
    borderColor: '#4361EE',
  },
  radioText: {
    fontSize: 14,
    color: '#333',
  },
  buttonContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 20,
  },
  button: {
    backgroundColor: '#4361EE',
    height: 50,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
    flex: 1,
  },
  nextButton: {
    backgroundColor: '#4361EE',
    height: 50,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
    flex: 1,
  },
  backButton: {
    backgroundColor: '#fff',
    height: 50,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 10,
    borderWidth: 1,
    borderColor: '#ddd',
    flex: 1,
  },
  backButtonText: {
    color: '#333',
    fontSize: 16,
    fontWeight: '500',
  },
  buttonDisabled: {
    backgroundColor: '#B8C1EC',
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },
  signinContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    marginTop: 24,
  },
  signinText: {
    color: '#666',
    fontSize: 14,
  },
  signinLink: {
    color: '#4361EE',
    fontSize: 14,
    fontWeight: 'bold',
  },
  logoContainer: {
    alignItems: 'center',
    marginBottom: 25,
  },
  logo: {
    width: 180,
    height: 180,
    resizeMode: 'contain',
  },
  imageUploadContainer: {
    marginBottom: 32,
    alignItems: 'center',
  },
  profileImageContainer: {
    alignItems: 'center',
    marginTop: 16,
  },
  profileImage: {
    width: 150,
    height: 150,
    borderRadius: 75,
    marginBottom: 16,
    borderWidth: 2,
    borderColor: '#4361EE',
  },
  profileImagePlaceholder: {
    width: 150,
    height: 150,
    borderRadius: 75,
    backgroundColor: '#4361EE',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 4,
  },
  profileImagePlaceholderText: {
    fontSize: 48,
    fontWeight: 'bold',
    color: 'white',
  },
  changePhotoButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    paddingHorizontal: 16,
    backgroundColor: '#EEF2FF',
    borderRadius: 25,
    borderWidth: 1,
    borderColor: '#4361EE',
    marginTop: 5,
  },
  changePhotoText: {
    color: '#4361EE',
    marginLeft: 8,
    fontSize: 16,
    fontWeight: '600',
  },
  photoSectionTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 8,
    color: '#333',
  },
  photoSectionSubtitle: {
    fontSize: 16,
    marginBottom: 20,
    color: '#666',
  },
  drawerOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'flex-end',
  },
  photoDrawer: {
    backgroundColor: 'white',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: 30,
  },
  drawerHandle: {
    width: 40,
    height: 5,
    backgroundColor: '#ccc',
    borderRadius: 3,
    alignSelf: 'center',
    marginBottom: 10,
  },
  drawerTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#333',
    marginVertical: 15,
    textAlign: 'center',
  },
  drawerOption: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#efefef',
  },
  drawerOptionText: {
    fontSize: 16,
    marginLeft: 15,
    color: '#333',
  },
  drawerCancelButton: {
    marginTop: 15,
    paddingVertical: 12,
    backgroundColor: '#f8f9fa',
    borderRadius: 8,
    alignItems: 'center',
  },
  drawerCancelText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#F72585',
  },
  passwordContainer: {
    flexDirection: 'row',
    position: 'relative',
    alignItems: 'center',
  },
  passwordInput: {
    backgroundColor: '#fff',
    height: 50,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#ddd',
    paddingHorizontal: 16,
    fontSize: 16,
    flex: 1,
  },
  eyeIcon: {
    position: 'absolute',
    right: 16,
    height: 50,
    justifyContent: 'center',
  },
});

export default SignUpScreen; 